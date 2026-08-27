/**
 * Screening de indirect prompt injection em conteúdo recuperado pelo RAG.
 *
 * A heurística de `detectPromptInjection` (@assistente-os/core, 11 padrões PT/EN)
 * rodava só na entrada direta do usuário (`sanitizeUserPrompt`). Aqui ela é
 * reaplicada a cada chunk retornado pelo retrieval, ANTES do assembly do prompt
 * — um `.md`/`.txt` malicioso indexado numa soul podia carregar instruções que o
 * modelo trataria como comando.
 *
 * Lógica pura, sem I/O. O logging no audit trail / métrica / step fica com o
 * chamador (daemon), que tem `sessionId`.
 */
import { detectPromptInjection, type InjectionDetectionResult } from "@assistente-os/core";
import type { RagChunk } from "./rag-chain.js";

export type RagInjectionMode = "aviso" | "recusar";

/**
 * Política de screening de chunks de RAG. `RAG_INJECTION_MODO` tem prioridade;
 * cai para `PROMPT_INJECTION_MODO`; default `aviso`.
 * - `aviso`  — sinaliza no audit trail, o chunk entra no contexto normalmente.
 * - `recusar` — chunks com severidade `high` são descartados do contexto (a
 *   chamada NÃO é abortada — diferente da entrada do usuário, aqui é só uma
 *   fonte entre várias e um falso positivo custa contexto útil, não a resposta).
 */
export function ragInjectionMode(): RagInjectionMode {
  const v = (process.env.RAG_INJECTION_MODO || process.env.PROMPT_INJECTION_MODO || "aviso").toLowerCase();
  return v === "recusar" ? "recusar" : "aviso";
}

export interface RagInjectionFinding {
  /** RagChunk.doc (docKey) — chave estável do chunk. */
  doc: string;
  path: string;
  method: RagChunk["method"];
  severity: "low" | "medium" | "high";
  /** Nomes dos padrões de `INJECTION_PATTERNS` que casaram (deduplicados). */
  patterns: string[];
  /** true quando o chunk foi descartado do contexto (`recusar` + severidade alta). */
  excluded: boolean;
}

/** Chunk + o texto bruto a ser inspecionado (`SearchResult.body` / `observations.body`). */
export interface ScreenableChunk {
  chunk: RagChunk;
  body: string;
}

export interface ScreenResult {
  /** Chunks que seguem para o contexto (em `recusar`, sem os de severidade alta). */
  chunks: RagChunk[];
  /** Um finding por chunk que casou algum padrão (independente do modo). */
  findings: RagInjectionFinding[];
}

/**
 * Roda `detectPromptInjection` sobre o `body` de cada chunk. Em modo `recusar`,
 * chunks cuja `maxSeverity` é `high` ficam de fora de `chunks`, mas ainda geram
 * um finding com `excluded: true`.
 */
export function screenRetrievedChunks(items: ScreenableChunk[], mode: RagInjectionMode): ScreenResult {
  const chunks: RagChunk[] = [];
  const findings: RagInjectionFinding[] = [];
  for (const { chunk, body } of items) {
    const r: InjectionDetectionResult = detectPromptInjection(body ?? "");
    const drop = mode === "recusar" && r.maxSeverity === "high";
    if (r.detected) {
      findings.push({
        doc: chunk.doc,
        path: chunk.path,
        method: chunk.method,
        severity: r.maxSeverity === "none" ? "low" : r.maxSeverity,
        patterns: [...new Set(r.matches.map((m) => m.name))],
        excluded: drop,
      });
    }
    if (!drop) chunks.push(chunk);
  }
  return { chunks, findings };
}

/** Maior severidade entre um conjunto de findings (para métrica/log). */
export function maxFindingSeverity(findings: RagInjectionFinding[]): "low" | "medium" | "high" {
  for (const s of ["high", "medium", "low"] as const) {
    if (findings.some((f) => f.severity === s)) return s;
  }
  return "low";
}
