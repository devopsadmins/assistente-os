import type { ServerResponse } from "node:http";

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

/** Cabeçalhos de resposta SSE. Chamar uma única vez, antes de qualquer writeSSEEvent/heartbeat. */
export function startSSE(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    // Desliga buffering de proxies reversos (nginx) que, por padrão, esperam
    // a resposta fechar antes de repassar bytes — quebraria streaming de verdade.
    "x-accel-buffering": "no",
  });
}

export function writeSSEEvent(res: ServerResponse, event: StreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Comentário SSE periódico (`: ping\n\n`) na PRÓPRIA conexão do /stream — não
 * o hub WS (decisão já resolvida na spec: WS vivo não prova que esta conexão
 * segue viva; proxy/timeout/aba em background podem matar uma sem a outra notar).
 * Devolve uma função de parada; chamador é responsável por chamá-la quando o
 * stream terminar (sucesso ou erro), senão o interval vaza.
 */
export function startHeartbeat(res: ServerResponse, intervalMs: number): () => void {
  const id = setInterval(() => {
    res.write(": ping\n\n");
  }, intervalMs);
  return () => clearInterval(id);
}
