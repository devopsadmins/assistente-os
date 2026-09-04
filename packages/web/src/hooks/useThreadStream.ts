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
    void getThreadMessages(config, soulId, threadId).then((history) => {
      if (cancelled) return;
      // If send() already started before this (mount-time) history load
      // resolved, don't clobber what it already put on screen — a slow
      // initial GET racing a fast first message would otherwise wipe out
      // the in-flight/just-finished turn the instant it resolves.
      setMessages((prev) =>
        prev.length > 0 ? prev : history.map((m) => ({ kind: "persisted" as const, id: m.id, role: m.role, content: m.content })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [config, soulId, threadId]);

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
      } finally {
        setSending(false);
      }
    },
    [config, soulId, threadId],
  );

  return { messages, sending, send };
}
