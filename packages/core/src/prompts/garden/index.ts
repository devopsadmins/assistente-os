/**
 * Prompt Garden — registro central. Ver `./types.ts` para o contrato.
 */
export * from "./types.js";
export { conciseOutput, CONCISE_OUTPUT_DIRECTIVE } from "./concise-output.js";
export { emailIngestExtraction } from "./email-ingest-extraction.js";
export { meetingIngestExtraction } from "./meeting-ingest-extraction.js";
export { specGrillAnalyst } from "./spec-grill-analyst.js";
export { entityExtraction } from "./entity-extraction.js";
export { guardianAudit } from "./guardian-audit.js";
export { ragRerankScorer } from "./rag-rerank-scorer.js";
export { agentReactSystem } from "./agent-react-system.js";
export { ragAnswer, RAG_ANSWER_SUFFIXES, type RagAnswerStyle } from "./rag-answer.js";

import type { PromptSpec } from "./types.js";
import { promptHash } from "./types.js";
import { conciseOutput } from "./concise-output.js";
import { emailIngestExtraction } from "./email-ingest-extraction.js";
import { meetingIngestExtraction } from "./meeting-ingest-extraction.js";
import { specGrillAnalyst } from "./spec-grill-analyst.js";
import { entityExtraction } from "./entity-extraction.js";
import { guardianAudit } from "./guardian-audit.js";
import { ragRerankScorer } from "./rag-rerank-scorer.js";
import { agentReactSystem } from "./agent-react-system.js";
import { ragAnswer } from "./rag-answer.js";

/** Todos os prompts do jardim. */
export const GARDEN: ReadonlyArray<PromptSpec<never>> = [
  conciseOutput,
  emailIngestExtraction,
  meetingIngestExtraction,
  specGrillAnalyst,
  entityExtraction,
  guardianAudit,
  ragRerankScorer,
  agentReactSystem,
  ragAnswer,
] as ReadonlyArray<PromptSpec<never>>;

export interface PromptManifestEntry {
  id: string;
  versao: number;
  hash: string;
}

/** Linha do manifesto de execução: `{id, versao, hash}` por prompt, ordenada por id. */
export function gardenManifest(): PromptManifestEntry[] {
  return GARDEN.map((p) => ({ id: p.id, versao: p.versao, hash: promptHash(p) })).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}
