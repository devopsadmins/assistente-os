/**
 * Escalonamento por confiança (T3.1; endurecido na Etapa 8 do refino).
 *
 * O roteador escolhe o tier ANTES de ver a resposta. Aqui, DEPOIS da execução no
 * tier `local`, decidimos se a resposta é fraca o suficiente para valer uma
 * segunda tentativa num tier melhor (`zen`/`soul`).
 *
 * **Desligado por default** (`ROUTER_ESCALATION=on` liga). Só a partir de `local`,
 * só uma vez por turno, e — com os tetos da Etapa 8 — no máx. N por sessão com
 * cooldown, e (por default) só quando `mode === "fast"`.
 *
 * Sinal de confiança (Etapa 8, Q1): além das heurísticas baratas (falha /
 * resposta vazia-curta / recusa "não sei"), um **juiz LLM local** — chamada
 * SIM/NÃO curta — só quando o RAG foi fraco (senão confia na resposta).
 */

import { routerEscalationJudge } from "@assistente-os/core";

export interface EscalationConfig {
  enabled: boolean;
  /** Abaixo deste score do 1º chunk de RAG, vale acionar o juiz LLM. */
  minRagScore: number;
  /** Respostas mais curtas que isto (chars, trim) são fracas — escala sem juiz. */
  minAnswerChars: number;
  /** Máx. de escalonamentos por sessão. */
  maxPerSession: number;
  /** Minutos de cooldown entre escalonamentos da mesma sessão. */
  cooldownMin: number;
  /** Só escala quando `mode === "fast"` (pro já usa tier melhor). */
  fastModeOnly: boolean;
}

export function escalationConfig(): EscalationConfig {
  const raw = (process.env.ROUTER_ESCALATION ?? "off").toLowerCase();
  const enabled = raw === "on" || raw === "1" || raw === "true";
  return {
    enabled,
    minRagScore: clamp(Number(process.env.ROUTER_ESCALATION_MIN_SCORE) || 0.55, 0, 1),
    minAnswerChars: clamp(Math.floor(Number(process.env.ROUTER_ESCALATION_MIN_CHARS) || 40), 0, 10_000),
    maxPerSession: clamp(Math.floor(Number(process.env.ROUTER_ESCALATION_MAX_PER_SESSION) || 1), 0, 100),
    cooldownMin: clamp(Number(process.env.ROUTER_ESCALATION_COOLDOWN_MIN) || 10, 0, 1440),
    fastModeOnly: (process.env.ROUTER_ESCALATION_FAST_ONLY ?? "1") !== "0",
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// "evidência (in)suficiente" é a frase que o próprio system prompt instrui o
// modelo a usar quando o RAG está abaixo do piso de confiança (context.ts,
// AOS_RAG_MIN_CONFIDENCE) — sem esse pedaço, uma recusa seguindo exatamente
// a instrução que demos não era reconhecida como recusa aqui.
const REFUSAL_RE =
  /\b(n[ãa]o sei|n[ãa]o tenho (essa )?informa|n[ãa]o (consigo|posso) (responder|ajudar)|n[ãa]o encontrei|sem informa[çc][ãa]o suficiente|n[ãa]o h[áa] evid[êe]ncia suficiente|evid[êe]ncia insuficiente|desculpe,? (mas )?n[ãa]o|i (don'?t|do not) know|i (can'?t|cannot) help)\b/i;

/** Heurística barata: a resposta é uma recusa / "não sei"? Vazio conta como recusa. */
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return REFUSAL_RE.test(t);
}

/** Verdito do juiz LLM: SIM = ok, NÃO = fraca, resto = desconhecido (não escala por isto). */
export function parseJudgeVerdict(text: string): "ok" | "weak" | "unknown" {
  const t = text.trim().toLowerCase();
  if (/^\s*(sim|yes|s)\b/.test(t) || /\bsim\b/.test(t)) return "ok";
  if (/^\s*(n[ãa]o|no|n)\b/.test(t) || /\bn[ãa]o\b/.test(t)) return "weak";
  return "unknown";
}

/** Chamada de chat estilo Ollama (`ollamaChat` de `routes/chat.ts`) — injetável p/ teste. */
export type JudgeChatFn = (
  baseUrl: string,
  payload: unknown,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string }>;

export interface JudgeDeps {
  chat: JudgeChatFn;
  /** `config.ollamaUrl` — o rewrite docker `host.docker.internal` é feito aqui. */
  ollamaUrl: string;
  /** `config.ollamaChatModel` — o prefixo `ollama/`|`openai/` é removido aqui. */
  model: string;
  timeoutMs: number;
}

/**
 * Roda o juiz LLM (`router-escalation-judge` do Prompt Garden): uma chamada
 * SIM/NÃO ao modelo local. Encapsula o rewrite de URL docker, o strip do prefixo
 * do modelo, a montagem do prompt e o parse do verdito. Erro / HTTP != 0 /
 * exceção → `"unknown"` (não escala por isto).
 */
export async function judgeAnswer(
  q: { pergunta: string; contexto: string; resposta: string },
  deps: JudgeDeps,
): Promise<"ok" | "weak" | "unknown"> {
  try {
    let url = deps.ollamaUrl;
    if (url.includes("host.docker.internal")) url = url.replace("host.docker.internal", "192.168.65.254");
    const r = await deps.chat(
      url,
      {
        model: deps.model.replace(/^(ollama|openai)\//, ""),
        messages: [
          {
            role: "user",
            content: routerEscalationJudge.render({
              pergunta: q.pergunta.slice(0, 2000),
              contexto: (q.contexto || "(sem contexto)").slice(0, 4000),
              resposta: q.resposta.slice(0, 4000),
            }),
          },
        ],
        stream: false,
      },
      deps.timeoutMs,
    );
    return r.code === 0 ? parseJudgeVerdict(r.stdout) : "unknown";
  } catch {
    return "unknown";
  }
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
  /** Modo de execução do turno. */
  mode: "fast" | "pro";
  /** Verdito do juiz LLM, quando acionado. undefined = não rodou. */
  judge?: "ok" | "weak" | "unknown";
}

export interface EscalationVerdict {
  escalate: boolean;
  reason: string;
}

/** O RAG foi fraco o bastante para valer acionar o juiz LLM? */
export function shouldRunJudge(sig: Pick<EscalationSignals, "ragOk" | "ragTopScore">, cfg: EscalationConfig): boolean {
  return !sig.ragOk || sig.ragTopScore < cfg.minRagScore;
}

/**
 * Decide se escala. Conservador — só em sinal CLARO de baixa confiança.
 * Ordem: modo → falha → resposta curta → recusa → juiz LLM "não".
 */
export function shouldEscalate(sig: EscalationSignals, cfg: EscalationConfig): EscalationVerdict {
  if (cfg.fastModeOnly && sig.mode !== "fast") return { escalate: false, reason: "pro_mode" };
  if (sig.localFailed) return { escalate: true, reason: "local_failed" };
  if (sig.answerChars < cfg.minAnswerChars) return { escalate: true, reason: "answer_too_short" };
  if (sig.answerRefusalLike) return { escalate: true, reason: "refusal" };
  if (sig.judge === "weak") return { escalate: true, reason: "judge_weak" };
  return { escalate: false, reason: "confident" };
}

/** Próximo tier depois de `fromTier` na lista configurada; undefined se for o último. */
export function nextEscalationTier(routerTiers: string[], fromTier: string): string | undefined {
  const i = routerTiers.indexOf(fromTier);
  if (i < 0 || i + 1 >= routerTiers.length) return undefined;
  return routerTiers[i + 1];
}

// ── Rate limiter por sessão (in-process — é limitador, não fonte de verdade) ──

const perSession = new Map<string, { count: number; lastAt: number }>();

/** A sessão ainda pode escalar? (respeita `maxPerSession` e `cooldownMin`). */
export function canEscalateSession(
  sessionId: string,
  cfg: EscalationConfig,
  now = Date.now(),
): { ok: boolean; reason: string } {
  const s = perSession.get(sessionId);
  if (!s) return { ok: true, reason: "first" };
  if (s.count >= cfg.maxPerSession) return { ok: false, reason: "session_cap" };
  if (now - s.lastAt < cfg.cooldownMin * 60_000) return { ok: false, reason: "cooldown" };
  return { ok: true, reason: "ok" };
}

/** Registra um escalonamento efetivado para a sessão. */
export function recordSessionEscalation(sessionId: string, now = Date.now()): void {
  const s = perSession.get(sessionId) ?? { count: 0, lastAt: 0 };
  s.count += 1;
  s.lastAt = now;
  perSession.set(sessionId, s);
}

/** Só para testes. */
export function __resetEscalationRateLimiter(): void {
  perSession.clear();
}
