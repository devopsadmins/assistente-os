/**
 * Estimativa barata de tokens quando o provider não devolve a contagem real.
 *
 * Heurística `chars / 4` — a mesma já usada no inspector de buffer da UI
 * (`tokenEstimate: Math.ceil(contextChars / 4)`). Não substitui a contagem
 * do provider (Ollama expõe `prompt_eval_count`/`eval_count`; LangChain
 * expõe `usage_metadata`); serve só de fallback declarado (`tokenSource:
 * "estimate"`) para o tier opencode, que não expõe uso estruturado.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
