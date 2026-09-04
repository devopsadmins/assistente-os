import { useCallback, useEffect, useRef, useState } from "react";
import { getThreadMessages, type ApiClientConfig } from "../api/client";
import { streamThreadMessage, type StreamEvent } from "../api/stream";

export type DisplayMessage =
  // `id` is a real server row id for assistant turns (`done.messageId`),
  // but the user's own row id is never sent back over SSE — only its
  // local id is available once its `pending` entry graduates to
  // `persisted` on `done`. Consumers only use `id` as a React `key`, so
  // `number | string` costs nothing downstream.
  | { kind: "persisted"; id: number | string; role: "user" | "assistant"; content: string }
  | { kind: "streaming"; id: string; role: "assistant"; chunks: string[] }
  | { kind: "pending"; id: string; role: "user"; content: string }
  | { kind: "error"; id: string; message: string };

export interface UseThreadStreamResult {
  messages: DisplayMessage[];
  sending: boolean;
  send: (prompt: string) => Promise<void>;
}

let nextLocalId = 0;

export function useThreadStream(config: ApiClientConfig, soulId: string, threadId: number | null): UseThreadStreamResult {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    if (threadId === null) return;
    let cancelled = false;
    void getThreadMessages(config, soulId, threadId)
      .then((history) => {
        if (cancelled) return;
        // Merge, never replace: `send()` may already have added local
        // (pending/streaming/persisted) messages by the time this
        // mount-time GET resolves — a `prev.length > 0` guard would treat
        // that as "history already loaded" and silently drop a thread's
        // real prior messages the instant a user sends a fast follow-up
        // before the GET returns. Prepending keeps chronological order
        // regardless of which resolves first: if history wins the race,
        // `prev` is still `[]` here and this is a no-op difference; if
        // send() wins, its local entries are correctly appended after the
        // real history instead of being clobbered by it.
        setMessages((prev) => [
          ...history.map((m) => ({ kind: "persisted" as const, id: m.id, role: m.role, content: m.content })),
          ...prev,
        ]);
      })
      .catch((err: unknown) => {
        // Sem isso, uma GET que falha (thread apagada, 401, daemon fora do
        // ar) renderiza uma thread vazia — indistinguível de uma thread
        // genuinamente sem histórico. Igual ao resto do hook: erro sempre
        // visível, nunca silencioso.
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "falha ao carregar histórico da thread";
        setMessages((prev) => [...prev, { kind: "error", id: `local-${nextLocalId++}`, message }]);
      });
    return () => {
      cancelled = true;
    };
  }, [config.baseUrl, config.token, soulId, threadId]);

  const send = useCallback(
    async (prompt: string) => {
      if (threadId === null) return;
      const userId = `local-${nextLocalId++}`;
      const streamId = `local-${nextLocalId++}`;
      setMessages((prev) => [
        ...prev,
        { kind: "pending", id: userId, role: "user", content: prompt },
        { kind: "streaming", id: streamId, role: "assistant", chunks: [] },
      ]);
      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamThreadMessage(config, soulId, threadId, prompt, {
          signal: controller.signal,
          onEvent: (event: StreamEvent) => {
            if (event.type === "token") {
              setMessages((prev) =>
                prev.map((m) => (m.id === streamId && m.kind === "streaming" ? { ...m, chunks: [...m.chunks, event.text] } : m)),
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id === streamId && m.kind === "streaming") {
                    return { kind: "persisted" as const, id: event.messageId, role: "assistant" as const, content: m.chunks.join("") };
                  }
                  if (m.id === userId && m.kind === "pending") {
                    return { kind: "persisted" as const, id: userId, role: "user" as const, content: m.content };
                  }
                  return m;
                }),
              );
            } else if (event.type === "error") {
              setMessages((prev) => prev.map((m) => (m.id === streamId ? { kind: "error" as const, id: streamId, message: event.message } : m)));
            }
          },
        });
      } catch (err) {
        // `streamThreadMessage` only synthesizes {type:"error"} for non-2xx
        // HTTP responses — it never catches a REJECTED fetch()/reader.read()
        // (daemon down, connection refused, socket dropped mid-body). Without
        // this catch, that rejection propagates uncaught and the `streaming`
        // message never resolves — its caret blinks forever, exactly the
        // failure the plan's Global Constraints warn against. An AbortError
        // is the one exception: that's `send()` being deliberately cancelled
        // (switching threads unmounts and calls `abortRef.current?.abort()`
        // in the next effect run), not a real failure — nothing to surface.
        if (!(err instanceof Error && err.name === "AbortError")) {
          const message = err instanceof Error ? err.message : "falha de rede";
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { kind: "error" as const, id: streamId, message } : m)));
        }
      } finally {
        setSending(false);
      }
    },
    [config.baseUrl, config.token, soulId, threadId],
  );

  return { messages, sending, send };
}
