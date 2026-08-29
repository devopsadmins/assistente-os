/**
 * Estágio de reranking do RAG (E10).
 *
 * Depois da busca híbrida, reordena um top-N amplo por relevância par
 * (query, trecho) e corta no top-K. Modos (env `RAG_RERANK`):
 *  - "off"            — comportamento atual (ordena pelo score existente).
 *  - "cross-encoder"  — modelo local via @xenova/transformers, sem custo.
 *  - "llm"            — pergunta 0–3 ao Ollama por trecho (mais lento).
 *
 * Qualquer falha de modelo → auto-skip com log, cai para "off". Default "off"
 * até validação — ligar com `RAG_RERANK=cross-encoder`.
 */
import { logger, ragRerankScorer } from "@assistente-os/core";

export type RerankMode = "off" | "llm" | "cross-encoder";

export interface RerankConfig {
  mode: RerankMode;
  topN: number;
  topK: number;
  /**
   * Orçamento de tempo (ms) para reordenar UMA consulta. Estourou → abandona o
   * rerank e volta à ordem por score original (mesmo efeito de "modelo
   * indisponível"). Protege a latência em hardware limitado — o cross-encoder
   * roda inferência local em CPU e não é abortável no meio de um par.
   */
  budgetMs: number;
}

// Default é um cross-encoder MS MARCO só-inglês — degrada corpora não-ingleses
// (medido: -17pp de hit@1 no corpus PT-BR de `consultoria_ia`, ADR-RAG-001 §6).
// Para PT-BR, apontar `RAG_RERANK_CE_MODEL` para um CE multilíngue, ex.:
// `Xenova/bge-reranker-base`. Lido a cada carga do modelo (não no load do
// módulo) — assim `RAG_RERANK_CE_MODEL` vale sem reimportar e o teste guardado
// consegue trocar o modelo.
const DEFAULT_CROSS_ENCODER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
function crossEncoderModel(): string {
  return process.env.RAG_RERANK_CE_MODEL || DEFAULT_CROSS_ENCODER_MODEL;
}

export function rerankConfig(fallbackTopK = 5): RerankConfig {
  const raw = (process.env.RAG_RERANK ?? "off").toLowerCase();
  const mode: RerankMode = raw === "llm" || raw === "cross-encoder" ? raw : "off";
  const topN = Number(process.env.RAG_RERANK_TOPN) || 20;
  const topK = Number(process.env.RAG_RERANK_TOPK) || fallbackTopK;
  // Default 30s: bem abaixo do teto de UX (≈180s/consulta em hardware limitado,
  // Etapa 4 do refino) mas suficiente p/ TOPN=20 numa máquina folgada (~2,5s medido).
  // `RAG_RERANK_BUDGET_MS=0` desliga o teto explicitamente.
  const rawBudget = process.env.RAG_RERANK_BUDGET_MS;
  const parsedBudget = rawBudget !== undefined ? Number(rawBudget) : NaN;
  const budgetMs = Number.isFinite(parsedBudget) && parsedBudget >= 0 ? parsedBudget : 30_000;
  return { mode, topN, topK, budgetMs };
}

export interface Rerankable {
  body: string;
  score: number;
}

/** Score de teste/injeção: recebe (query, body) e devolve relevância (maior = melhor). */
export type PairScorer = (query: string, body: string) => Promise<number> | number;

// O pipeline "text-classification" do @xenova/transformers (2.x) não aceita
// entrada de par (query, doc) — `{ text, text_pair }` dispara "text.split is not
// a function". Cross-encoders de ranking (ms-marco-MiniLM) são
// SequenceClassification de 1 logit; a forma correta é tokenizar o par à mão e
// ler o logit do modelo.
/* eslint-disable @typescript-eslint/no-explicit-any */
let ceTokenizer: any = null;
let ceModel: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let crossEncoderFailed = false;

async function getCrossEncoderScorer(): Promise<PairScorer | null> {
  if (crossEncoderFailed) return null;
  if (!ceTokenizer || !ceModel) {
    try {
      const t = await import("@xenova/transformers");
      const name = crossEncoderModel();
      [ceTokenizer, ceModel] = await Promise.all([
        t.AutoTokenizer.from_pretrained(name),
        t.AutoModelForSequenceClassification.from_pretrained(name),
      ]);
    } catch (err) {
      crossEncoderFailed = true;
      logger.warn(`[rerank] cross-encoder indisponível, usando ordem por score: ${(err as Error).message}`);
      return null;
    }
  }
  return async (query: string, body: string) => {
    const inputs = ceTokenizer(query, { text_pair: body, padding: true, truncation: true });
    const { logits } = await ceModel(inputs);
    const data = logits.data as Float32Array;
    // 1 logit (ms-marco) → data[0]; 2 logits ([irrelevante, relevante]) → o último.
    return data.length > 0 ? data[data.length - 1] : 0;
  };
}

async function getLlmScorer(): Promise<PairScorer | null> {
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || "qwen2.5-coder:3b";
  return async (query: string, body: string) => {
    try {
      const resp = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: "user", content: ragRerankScorer.render({ pergunta: query, trecho: body.slice(0, 800) }) },
          ],
        }),
      });
      if (!resp.ok) return -1;
      const data = (await resp.json()) as { message?: { content?: string } };
      const n = Number((data.message?.content ?? "").match(/[0-3]/)?.[0]);
      return Number.isFinite(n) ? n : -1;
    } catch {
      return -1; // -1 sinaliza "não pontuado" — o caller cai para score original
    }
  };
}

/**
 * Reordena `candidates` e corta no `topK`. `scoreFn` (teste) sobrepõe o modo.
 * Sem rerank efetivo (mode "off" ou modelo indisponível), só ordena pelo
 * `score` já presente e corta.
 */
export async function rerank<T extends Rerankable>(
  query: string,
  candidates: T[],
  cfg: RerankConfig,
  scoreFn?: PairScorer,
): Promise<T[]> {
  const pool = candidates.slice(0, Math.max(cfg.topN, cfg.topK));
  const byOriginal = () => [...pool].sort((a, b) => b.score - a.score).slice(0, cfg.topK);

  let scorer: PairScorer | null = scoreFn ?? null;
  if (!scorer && cfg.mode === "cross-encoder") scorer = await getCrossEncoderScorer();
  if (!scorer && cfg.mode === "llm") scorer = await getLlmScorer();
  if (!scorer) return byOriginal();

  const budgetMs = cfg.budgetMs > 0 ? cfg.budgetMs : Infinity;
  const startedAt = Date.now();
  const scored: Array<{ item: T; s: number }> = [];
  for (const item of pool) {
    if (Date.now() - startedAt > budgetMs) {
      // Estourou o orçamento no meio: nada de resultado parcial meio-ordenado —
      // volta à ordem por score original, previsível (== "modelo indisponível").
      logger.warn(
        `[rerank] orçamento de ${cfg.budgetMs}ms estourado após ${scored.length}/${pool.length} pares; ordem por score original`,
      );
      return byOriginal();
    }
    let s: number;
    try {
      s = await scorer(query, item.body);
    } catch {
      s = -1;
    }
    // -1 = não pontuado: preserva a posição relativa via score original (normalizado baixo)
    scored.push({ item, s: s < 0 ? item.score - 1000 : s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, cfg.topK).map((x) => x.item);
}

/** Só para testes: limpa o cache do modelo cross-encoder e o flag de falha grudada. */
export function __resetRerankState(): void {
  ceTokenizer = null;
  ceModel = null;
  crossEncoderFailed = false;
}
