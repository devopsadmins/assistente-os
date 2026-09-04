import type { ApiClientConfig } from "./client";

// Re-exported only so `./stream` can stand in for `./client` in an existing
// test import path — not an intentional public re-export barrel. Import
// `ApiClientConfig` from `./client` directly in new code.
export type { ApiClientConfig };

export type StreamEvent =
  | { type: "step"; step: string; message?: string; tool?: string }
  | { type: "token"; text: string }
  | {
      type: "done";
      messageId: number;
      usage: { promptTokens: number; completionTokens: number; source: "provider" | "estimate" };
      sources?: Array<{ title: string; url?: string; snippet?: string }>;
    }
  | { type: "error"; message: string };

/**
 * Parsing incremental de um corpo SSE (frames "data: {...}\n\n"; comentários
 * de heartbeat como ": ping\n\n" são ignorados) em StreamEvents, tolerando
 * frames partidos entre chunks de rede — mesmo tipo de robustez que
 * ollamaChatStream (lado servidor) já tem pro NDJSON do Ollama.
 */
export class SSEFrameParser {
  #buffer = "";

  /**
   * Bytes recebidos mas ainda não fechados por um `\n\n` — um frame SSE
   * partido que nunca se completou. Não-vazio (ignorando espaço em branco)
   * depois que o corpo da resposta termina significa que o stream foi
   * cortado no meio de um frame (ex.: conexão derrubada) — o chamador trata
   * isso como erro em vez de descartar silenciosamente (o mesmo tipo de
   * falha do achado principal desta revisão: um `done` perdido deixa o
   * cursor de streaming piscando pra sempre).
   */
  get pendingIncompleteFrame(): string {
    return this.#buffer;
  }

  push(chunk: string): StreamEvent[] {
    this.#buffer += chunk;
    const events: StreamEvent[] = [];
    let sep: number;
    while ((sep = this.#buffer.indexOf("\n\n")) !== -1) {
      const frame = this.#buffer.slice(0, sep);
      this.#buffer = this.#buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          events.push(JSON.parse(line.slice("data: ".length)) as StreamEvent);
        }
        // Linhas ": ping" (heartbeat) ou vazias são ignoradas.
      }
    }
    return events;
  }
}

export interface StreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Abre o stream de uma mensagem numa thread. Uma resposta não-2xx (soul/
 * thread não encontrada, prompt vazio, 429 de limite de turnos) chega ANTES
 * de qualquer byte de SSE — vira um único evento sintético {type:"error"},
 * pra quem chama ter um único caminho de exibição de erro, streaming ou não.
 */
export async function streamThreadMessage(
  config: ApiClientConfig,
  soulId: string,
  threadId: number,
  prompt: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/souls/${encodeURIComponent(soulId)}/threads/${threadId}/messages/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
    signal: callbacks.signal,
  });

  if (!res.ok || !res.body) {
    let message = `stream falhou (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corpo não é JSON — mantém a mensagem genérica
    }
    callbacks.onEvent({ type: "error", message });
    return;
  }

  const parser = new SSEFrameParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      callbacks.onEvent(event);
    }
  }

  // O corpo terminou (EOF limpo, sem rejeição) mas sobrou um frame partido
  // no buffer — o servidor fechou a conexão no meio de um `data: ...\n\n`.
  // Silenciar isso equivaleria a um `done` perdido: quem chama nunca saberia
  // que o stream não terminou de verdade (mesma classe de falha do caso em
  // que `fetch`/`reader.read()` rejeita — ver o `try/catch` em `send()`).
  if (parser.pendingIncompleteFrame.trim().length > 0) {
    callbacks.onEvent({ type: "error", message: "stream terminado com frame incompleto" });
  }
}
