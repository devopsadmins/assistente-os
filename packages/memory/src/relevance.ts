/**
 * Gate de relevância do RAG — port de `rag.py::relevancia` do SLC-OS.
 *
 * Avalia, dada uma pergunta e os resultados recuperados, se há contexto
 * suficiente (semântico e lexical) para responder. Regra parametrizável:
 *   min_score        — menor score semântico (cosseno) aceitável (default 0.35)
 *   min_term_matches — número mínimo de termos úteis da pergunta presentes no contexto (default 1)
 *   modo             — recusar | aviso | libre (default "recusar")
 *
 * Funciona tanto sobre resultados vetoriais (cosseno 0..1) quanto sobre o
 * fallback literal (score 1.0) do índice.
 */

import type { Pool } from "@assistente-os/core";
import type { Embedder } from "./embedders.js";
import type { SearchResult } from "./indexer.js";

export type RelevanceMode = "recusar" | "aviso" | "libre";

export interface RelevanceRule {
  min_score?: number;
  min_term_matches?: number;
  modo?: RelevanceMode;
}

export interface RelevanceVerdict {
  ok: boolean;
  score: number;
  termos: number;
  modo: RelevanceMode;
  motivo: string;
}

/** Tokens em minúsculas sem pontuação nem acentos.
 * 'everton.', 'dimastec,' participação' -> 'everton', 'dimastec', 'participacao'. */
export function tokenize(text: string): string[] {
  const t = text.toLocaleLowerCase("pt-BR");
  const nfd = t.normalize("NFD");
  const stripped = nfd.replace(/[\u0300-\u036f]/g, "");
  const matches = stripped.match(/[a-z0-9]+/g);
  return matches ?? [];
}

/** Conjunto de stopwords em português (mesmo critério do SLC-OS). */
export const STOPWORDS_PT = new Set<string>(
  ("a o e em na no nas nos um uma uns umas ao aos do da das dos de que como " +
    "qual quais com por para mas mais seu sua seus suas este esta isto isso " +
    "esse essa esses essas aquilo então não é são foi era se si").split(/\s+/),
);

/** Tokens úteis da pergunta (>=3 chars, sem stopwords). */
export function usefulTerms(query: string): string[] {
  return tokenize(query).filter((t) => t.length >= 3 && !STOPWORDS_PT.has(t));
}

export function relevancia(
  pergunta: string,
  results: SearchResult[],
  regra: RelevanceRule = {},
  minScore?: number
): RelevanceVerdict {
  const modo: RelevanceMode =
    regra.modo && ["recusar", "aviso", "libre"].includes(regra.modo) ? regra.modo : "recusar";

  let min_score: number;
  try {
    min_score = Number(regra.min_score) || 0.35;
  } catch {
    min_score = 0.35;
  }

  let min_termos: number;
  try {
    min_termos = Number(regra.min_term_matches) || 1;
  } catch {
    min_termos = 1;
  }

  // Usa o minScore explícito se fornecido; senão usa o da regra
  const effectiveMinScore = (minScore !== undefined && minScore > 0) ? minScore : min_score;

  if (results.length === 0) {
    return {
      ok: false,
      score: 0.0,
      termos: 0,
      modo,
      motivo: "Nenhum resultado recuperado do acervo.",
    };
  }

  const score = Math.max(...results.map((r) => r.score ?? 0));
  const uteis = usefulTerms(pergunta);
  const corpus = results.slice(0, 5).map((r) => r.body ?? "").join(" ");
  // tokeniza normaliza acentos/pontuação — mesmo critério usado na busca literal
  const corpusTokens = new Set(tokenize(corpus));
  const termos = uteis.reduce((acc, t) => (corpusTokens.has(t) ? acc + 1 : acc), 0);

  if (score < effectiveMinScore) {
    return {
      ok: false,
      score,
      termos,
      modo,
      motivo: `Semelhança semântica muito baixa (${score.toFixed(4)} < ${min_score.toFixed(2)}).`,
    };
  }

  if (uteis.length > 0 && termos < min_termos) {
    return {
      ok: false,
      score,
      termos,
      modo,
      motivo: "Nenhum termo da pergunta aparece no contexto recuperado.",
    };
  }

  return { ok: true, score, termos, modo, motivo: "" };
}

export interface SearchVerdict {
  results: SearchResult[];
  verdict: RelevanceVerdict;
}

/**
 * Variante de `search()` que aplica o gate de relevância ao resultado.
 * Útil em superfícies que precisam decidir se responde a partir do RAG
 * (ex.: chat). Mantém `search()` puro (sem gate) para quem não precisa.
 */
export async function searchWithVerdict(
  pool: Pool,
  soul: string,
  query: string,
  embedder: Embedder,
  rule: RelevanceRule,
  max = 5,
  minScore?: number
): Promise<SearchVerdict> {
  const { search } = await import("./indexer.js");
  const results = await search(pool, soul, query, embedder, max);
  return { results, verdict: relevancia(query, results, rule, minScore) };
}
