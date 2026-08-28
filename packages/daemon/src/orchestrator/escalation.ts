/**
 * Escalonamento por confiança (T3.1 de `docs/ARCHITECTURE-REVIEW.md`).
 *
 * O roteador escolhe o tier ANTES de ver a resposta. Aqui, DEPOIS da execução no
 * tier `local`, decidimos se a resposta é fraca o suficiente para valer uma
 * segunda tentativa num tier melhor (`zen`/`soul`).
 *
 * **Desligado por default** (`ROUTER_ESCALATION=on` liga) — mesma política do
 * reranker e do cache semântico: mecanismo pronto, ativação por env após medir.
 * Só sobe UM degrau, uma vez, e só a partir de `local`.
 */

export interface EscalationConfig {
  enabled: boolean;
  /** Abaixo deste score do 1º chunk de RAG, o contexto é considerado fraco. */
  minRagScore: number;
  /** Respostas mais curtas que isto (chars, trim) são consideradas fracas. */
  minAnswerChars: number;
}

export function escalationConfig(): EscalationConfig {
  const raw = (process.env.ROUTER_ESCALATION ?? "off").toLowerCase();
  const enabled = raw === "on" || raw === "1" || raw === "true";
  const minRagScore = clamp(Number(process.env.ROUTER_ESCALATION_MIN_SCORE) || 0.55, 0, 1);
  const minAnswerChars = clamp(Math.floor(Number(process.env.ROUTER_ESCALATION_MIN_CHARS) || 40), 0, 10_000);
  return { enabled, minRagScore, minAnswerChars };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const REFUSAL_RE =
  /\b(n[ãa]o sei|n[ãa]o tenho (essa )?informa|n[ãa]o (consigo|posso) (responder|ajudar)|n[ãa]o encontrei|sem informa[çc][ãa]o suficiente|desculpe,? (mas )?n[ãa]o|i (don'?t|do not) know|i (can'?t|cannot) help)\b/i;

/** Heurística: a resposta é uma recusa / "não sei"? */
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return REFUSAL_RE.test(t);
}

export interface EscalationSignals {
  /** Execução no tier local falhou (código != 0 ou timeout). */
  localFailed: boolean;
  /** O RAG achou documentos relevantes (`verdict.ok`). */
  ragOk: boolean;
  /** Score do 1º chunk recuperado (0 quando não há). */
  ragTopScore: number;
  /** Tamanho da resposta do local (chars, já trim). */
  answerChars: number;
  /** A resposta do local parece uma recusa. */
  answerRefusalLike: boolean;
}

export interface EscalationVerdict {
  escalate: boolean;
  reason: string;
}

/**
 * Decide se escala. Conservador: só em sinal CLARO de baixa confiança.
 *  - local falhou → escala (sempre)
 *  - resposta vazia/curta → escala
 *  - resposta parece recusa E (RAG não achou nada OU score do topo baixo) → escala
 */
export function shouldEscalate(sig: EscalationSignals, cfg: EscalationConfig): EscalationVerdict {
  if (sig.localFailed) return { escalate: true, reason: "local_failed" };
  if (sig.answerChars < cfg.minAnswerChars) return { escalate: true, reason: "answer_too_short" };
  if (sig.answerRefusalLike) {
    if (!sig.ragOk) return { escalate: true, reason: "refusal_no_rag" };
    if (sig.ragTopScore < cfg.minRagScore) return { escalate: true, reason: "refusal_weak_rag" };
  }
  return { escalate: false, reason: "confident" };
}

/** Próximo tier depois de `fromTier` na lista configurada; undefined se for o último. */
export function nextEscalationTier(routerTiers: string[], fromTier: string): string | undefined {
  const i = routerTiers.indexOf(fromTier);
  if (i < 0 || i + 1 >= routerTiers.length) return undefined;
  return routerTiers[i + 1];
}
