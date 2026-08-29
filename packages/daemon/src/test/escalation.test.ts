import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalationConfig,
  looksLikeRefusal,
  parseJudgeVerdict,
  shouldRunJudge,
  judgeAnswer,
  shouldEscalate,
  nextEscalationTier,
  canEscalateSession,
  recordSessionEscalation,
  __resetEscalationRateLimiter,
  type EscalationConfig,
  type EscalationSignals,
} from "../orchestrator/escalation.js";

const CFG: EscalationConfig = {
  enabled: true,
  minRagScore: 0.55,
  minAnswerChars: 40,
  maxPerSession: 1,
  cooldownMin: 10,
  fastModeOnly: true,
};

function sig(over: Partial<EscalationSignals> = {}): EscalationSignals {
  return {
    localFailed: false,
    ragOk: true,
    ragTopScore: 0.9,
    answerChars: 200,
    answerRefusalLike: false,
    mode: "fast",
    ...over,
  };
}

test("escalationConfig: default off; liga com ROUTER_ESCALATION=on; clampa e lê os tetos", () => {
  const prev = { ...process.env };
  try {
    delete process.env.ROUTER_ESCALATION;
    assert.equal(escalationConfig().enabled, false);

    process.env.ROUTER_ESCALATION = "on";
    process.env.ROUTER_ESCALATION_MIN_SCORE = "2";
    process.env.ROUTER_ESCALATION_MIN_CHARS = "-5";
    process.env.ROUTER_ESCALATION_MAX_PER_SESSION = "3";
    process.env.ROUTER_ESCALATION_COOLDOWN_MIN = "5";
    process.env.ROUTER_ESCALATION_FAST_ONLY = "0";
    const c = escalationConfig();
    assert.equal(c.enabled, true);
    assert.equal(c.minRagScore, 1);
    assert.equal(c.minAnswerChars, 0);
    assert.equal(c.maxPerSession, 3);
    assert.equal(c.cooldownMin, 5);
    assert.equal(c.fastModeOnly, false);
  } finally {
    process.env = prev;
  }
});

test("looksLikeRefusal: pega 'não sei' / vazio; ignora resposta normal", () => {
  assert.equal(looksLikeRefusal(""), true);
  assert.equal(looksLikeRefusal("Não sei responder isso."), true);
  assert.equal(looksLikeRefusal("I don't know."), true);
  assert.equal(looksLikeRefusal("O pm2 reinicia com `pm2 restart <app>`."), false);
});

test("parseJudgeVerdict: SIM/NÃO/lixo", () => {
  assert.equal(parseJudgeVerdict("SIM"), "ok");
  assert.equal(parseJudgeVerdict("sim, a resposta cobre a pergunta"), "ok");
  assert.equal(parseJudgeVerdict("NÃO"), "weak");
  assert.equal(parseJudgeVerdict("nao — é evasiva"), "weak");
  assert.equal(parseJudgeVerdict("talvez, depende"), "unknown");
});

test("shouldRunJudge: só quando o RAG foi fraco", () => {
  assert.equal(shouldRunJudge({ ragOk: true, ragTopScore: 0.9 }, CFG), false);
  assert.equal(shouldRunJudge({ ragOk: false, ragTopScore: 0.9 }, CFG), true);
  assert.equal(shouldRunJudge({ ragOk: true, ragTopScore: 0.4 }, CFG), true);
});

test("shouldEscalate: pro_mode não escala quando fastModeOnly", () => {
  assert.deepEqual(shouldEscalate(sig({ mode: "pro", localFailed: true }), CFG), {
    escalate: false,
    reason: "pro_mode",
  });
  // com fastModeOnly=false, pro escala normal
  assert.equal(shouldEscalate(sig({ mode: "pro", localFailed: true }), { ...CFG, fastModeOnly: false }).escalate, true);
});

test("shouldEscalate: local falhou / resposta curta / recusa / juiz 'weak'", () => {
  assert.equal(shouldEscalate(sig({ localFailed: true }), CFG).reason, "local_failed");
  assert.equal(shouldEscalate(sig({ answerChars: 10 }), CFG).reason, "answer_too_short");
  assert.equal(shouldEscalate(sig({ answerRefusalLike: true }), CFG).reason, "refusal");
  assert.equal(shouldEscalate(sig({ judge: "weak" }), CFG).reason, "judge_weak");
});

test("shouldEscalate: resposta boa / juiz 'ok' / juiz 'unknown' → NÃO escala", () => {
  assert.deepEqual(shouldEscalate(sig(), CFG), { escalate: false, reason: "confident" });
  assert.equal(shouldEscalate(sig({ judge: "ok" }), CFG).escalate, false);
  assert.equal(shouldEscalate(sig({ judge: "unknown" }), CFG).escalate, false);
});

test("[wired] judgeAnswer: monta o prompt do garden, chama o chat injetado e faz parse do verdito", async () => {
  const calls: Array<{ url: string; payload: { model: string; messages: Array<{ content: string }> }; timeoutMs: number }> = [];
  const chat = async (url: string, payload: unknown, timeoutMs: number) => {
    calls.push({ url, payload: payload as (typeof calls)[number]["payload"], timeoutMs });
    return { code: 0, stdout: "NÃO — a resposta é evasiva" };
  };

  const verdict = await judgeAnswer(
    { pergunta: "como reinicio o pm2?", contexto: "docs do pm2", resposta: "sei lá" },
    { chat, ollamaUrl: "http://host.docker.internal:11434", model: "ollama/qwen2.5:7b", timeoutMs: 45000 },
  );

  assert.equal(verdict, "weak");
  assert.equal(calls.length, 1);
  // rewrite docker + strip do prefixo do modelo
  assert.equal(calls[0]!.url, "http://192.168.65.254:11434");
  assert.equal(calls[0]!.payload.model, "qwen2.5:7b");
  // o prompt renderizado carrega os três campos
  const content = calls[0]!.payload.messages[0]!.content;
  assert.match(content, /como reinicio o pm2\?/);
  assert.match(content, /docs do pm2/);
  assert.match(content, /sei lá/);
});

test("[wired] judgeAnswer: SIM → ok; contexto vazio vira '(sem contexto)'", async () => {
  let seenContent = "";
  const chat = async (_u: string, payload: unknown) => {
    seenContent = (payload as { messages: Array<{ content: string }> }).messages[0]!.content;
    return { code: 0, stdout: "SIM" };
  };
  const verdict = await judgeAnswer(
    { pergunta: "p", contexto: "", resposta: "r" },
    { chat, ollamaUrl: "http://127.0.0.1:11434", model: "qwen2.5", timeoutMs: 1000 },
  );
  assert.equal(verdict, "ok");
  assert.match(seenContent, /\(sem contexto\)/);
});

test("[wired] judgeAnswer: HTTP != 0 e exceção no chat → 'unknown' (não escala por isto)", async () => {
  const httpErr = await judgeAnswer(
    { pergunta: "p", contexto: "c", resposta: "r" },
    { chat: async () => ({ code: 1, stdout: "" }), ollamaUrl: "http://x", model: "m", timeoutMs: 100 },
  );
  assert.equal(httpErr, "unknown");

  const threw = await judgeAnswer(
    { pergunta: "p", contexto: "c", resposta: "r" },
    {
      chat: async () => {
        throw new Error("conexão recusada");
      },
      ollamaUrl: "http://x",
      model: "m",
      timeoutMs: 100,
    },
  );
  assert.equal(threw, "unknown");
});

test("nextEscalationTier: sobe um degrau; undefined no último ou tier desconhecido", () => {
  const tiers = ["local", "zen", "soul"];
  assert.equal(nextEscalationTier(tiers, "local"), "zen");
  assert.equal(nextEscalationTier(tiers, "soul"), undefined);
  assert.equal(nextEscalationTier(tiers, "langgraph"), undefined);
});

test("canEscalateSession: teto por sessão + cooldown", () => {
  __resetEscalationRateLimiter();
  const t0 = 1_000_000;
  assert.deepEqual(canEscalateSession("s1", CFG, t0), { ok: true, reason: "first" });
  recordSessionEscalation("s1", t0);
  // agora no cooldown E no teto (maxPerSession=1)
  assert.equal(canEscalateSession("s1", CFG, t0 + 60_000).ok, false); // < 10min → cooldown OU cap
  // passado o cooldown, ainda bloqueado pelo teto
  assert.deepEqual(canEscalateSession("s1", CFG, t0 + 11 * 60_000), { ok: false, reason: "session_cap" });
  // com teto maior, só o cooldown importa
  const cfg2 = { ...CFG, maxPerSession: 5 };
  assert.deepEqual(canEscalateSession("s1", cfg2, t0 + 60_000), { ok: false, reason: "cooldown" });
  assert.deepEqual(canEscalateSession("s1", cfg2, t0 + 11 * 60_000), { ok: true, reason: "ok" });
  // outra sessão não é afetada
  assert.equal(canEscalateSession("s2", CFG, t0 + 60_000).ok, true);
});
