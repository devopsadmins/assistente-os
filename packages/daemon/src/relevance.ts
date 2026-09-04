import type { RelevanceRule, RelevanceMode } from "@assistente-os/memory";
import { resolveRelevanceGate } from "@assistente-os/core";

/** Gate de relevância configurável por env (default: modo "aviso"). */
export function relevanceRule(): RelevanceRule {
  const gate = resolveRelevanceGate();
  return {
    modo: gate.modo as RelevanceMode,
    min_score: gate.minScore,
    min_term_matches: gate.minTerms,
  };
}
