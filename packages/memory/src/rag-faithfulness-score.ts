/**
 * Score de fidelidade da resposta ao contexto recuperado (E12).
 *
 * "Baixa taxa de alucinação" só é uma alegação defensável se for um número
 * medido. Aqui, uma heurística sem ML: cada frase da resposta é comparada com o
 * conjunto de tokens das fontes recuperadas; uma frase-afirmação com pouca
 * sobreposição é marcada como **não sustentada pelo contexto**.
 *
 * `supported = 1 − (frases não sustentadas / frases-afirmação)`.
 *
 * Envs:
 *  - `AOS_RAG_FAITHFULNESS_MIN_OVERLAP` (default 0.35) — sobreposição mínima
 *    (tokens da frase ∩ tokens das fontes / tokens da frase) para "sustentada".
 *  - `AOS_RAG_FAITHFULNESS_MIN_TOKENS`  (default 4)    — abaixo disso a frase não
 *    conta como afirmação (ex.: "Sim.", "Não sei.").
 */
import { tokenize, STOPWORDS_PT } from "./relevance.js";

export interface UnsupportedSentence {
  sentence: string;
  overlap: number;
}

export interface FaithfulnessResult {
  /** 0..1 — fração das frases-afirmação sustentadas pelo contexto. */
  supported: number;
  /** Nº de frases que contaram como afirmação. */
  claims: number;
  unsupported: UnsupportedSentence[];
  method: "heuristic";
}

export interface FaithfulnessOpts {
  minOverlap?: number;
  minTokens?: number;
}

function num(env: string | undefined, def: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const contentTokens = (text: string): string[] =>
  tokenize(text).filter((t) => t.length >= 3 && !STOPWORDS_PT.has(t));

/** Divide em frases por `. ! ? ; \n` mantendo só as com algum conteúdo. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function scoreAnswerFaithfulness(
  answer: string,
  sourceSnippets: string[],
  opts: FaithfulnessOpts = {},
): FaithfulnessResult {
  const minOverlap = opts.minOverlap ?? num(process.env.AOS_RAG_FAITHFULNESS_MIN_OVERLAP, 0.35);
  const minTokens = opts.minTokens ?? num(process.env.AOS_RAG_FAITHFULNESS_MIN_TOKENS, 4);

  const srcBag = new Set<string>();
  for (const s of sourceSnippets) for (const t of contentTokens(s)) srcBag.add(t);

  const unsupported: UnsupportedSentence[] = [];
  let claims = 0;

  for (const sent of sentences(answer)) {
    const toks = contentTokens(sent);
    if (toks.length < minTokens) continue; // não é afirmação factual
    claims++;
    // Sem fontes: nada sustenta nada.
    const hits = srcBag.size === 0 ? 0 : toks.filter((t) => srcBag.has(t)).length;
    const overlap = hits / toks.length;
    if (overlap < minOverlap) unsupported.push({ sentence: sent, overlap: Number(overlap.toFixed(3)) });
  }

  const supported = claims === 0 ? 1 : 1 - unsupported.length / claims;
  return { supported: Number(supported.toFixed(3)), claims, unsupported, method: "heuristic" };
}
