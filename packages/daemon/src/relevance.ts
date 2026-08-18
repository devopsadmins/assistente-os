import type { RelevanceRule, RelevanceMode } from "@assistente-os/memory";

/** Gate de relevância configurável por env (default: modo "aviso"). */
export function relevanceRule(): RelevanceRule {
  const modo = (process.env.ASSISTENTE_OS_RELEVANCE_MODO as RelevanceMode) || "aviso";
  return {
    modo: ["recusar", "aviso", "libre"].includes(modo) ? modo : "aviso",
    min_score: Number(process.env.ASSISTENTE_OS_RELEVANCE_MIN_SCORE) || 0.35,
    min_term_matches: Number(process.env.ASSISTENTE_OS_RELEVANCE_MIN_TERMS) || 1,
  };
}
