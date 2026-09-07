/**
 * Preço real (USD) por chamada LLM, hoje ausente de `cost_calls` (todo call-site
 * gravava `cost: 0` hardcoded — não por bug, mas por nunca ter existido tabela de
 * preço nenhuma). Ollama local não tem $/token (custo de infra, não de API) —
 * sempre 0. Zen hoje só expõe `nemotron-3-ultra-free`, free tier real (ver
 * docs/FREE_PROVIDERS.md) — 0 é o valor correto, não um placeholder esquecido.
 *
 * Ao colocar um provider/modelo pago em produção, adicionar aqui o preço real
 * (não inventar números comerciais).
 */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING_TABLE: Record<string, ModelPrice> = {
  "zen:nemotron-3-ultra-free": { inputPer1M: 0, outputPer1M: 0 },
};

export function calcCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  table: Record<string, ModelPrice> = PRICING_TABLE,
): number {
  if (provider === "ollama") return 0;
  const price = table[`${provider}:${model}`];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.inputPer1M + (outputTokens / 1_000_000) * price.outputPer1M;
}
