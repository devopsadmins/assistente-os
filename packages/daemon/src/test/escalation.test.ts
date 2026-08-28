import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalationConfig,
  looksLikeRefusal,
  shouldEscalate,
  nextEscalationTier,
  type EscalationConfig,
  type EscalationSignals,
} from "../orchestrator/escalation.js";

const CFG: EscalationConfig = { enabled: true, minRagScore: 0.55, minAnswerChars: 40 };

function sig(over: Partial<EscalationSignals> = {}): EscalationSignals {
  return {
    localFailed: false,
    ragOk: true,
    ragTopScore: 0.9,
    answerChars: 200,
    answerRefusalLike: false,
    ...over,
  };
}

test("escalationConfig: default off; liga com ROUTER_ESCALATION=on; clampa", () => {
  const prev = { ...process.env };
  try {
    delete process.env.ROUTER_ESCALATION;
    assert.equal(escalationConfig().enabled, false);

    process.env.ROUTER_ESCALATION = "on";
    process.env.ROUTER_ESCALATION_MIN_SCORE = "2";
    process.env.ROUTER_ESCALATION_MIN_CHARS = "-5";
    const c = escalationConfig();
    assert.equal(c.enabled, true);
    assert.equal(c.minRagScore, 1);
    assert.equal(c.minAnswerChars, 0);
  } finally {
    process.env = prev;
  }
});

test("looksLikeRefusal: pega 'não sei' / 'não tenho essa informação' / vazio; ignora resposta normal", () => {
  assert.equal(looksLikeRefusal(""), true);
  assert.equal(looksLikeRefusal("   "), true);
  assert.equal(looksLikeRefusal("Não sei responder isso."), true);
  assert.equal(looksLikeRefusal("Desculpe, mas não tenho essa informação."), true);
  assert.equal(looksLikeRefusal("I don't know."), true);
  assert.equal(looksLikeRefusal("O pm2 reinicia com `pm2 restart <app>`."), false);
});

test("shouldEscalate: local falhou → sempre escala", () => {
  assert.deepEqual(shouldEscalate(sig({ localFailed: true }), CFG), {
    escalate: true,
    reason: "local_failed",
  });
});

test("shouldEscalate: resposta curta → escala", () => {
  const v = shouldEscalate(sig({ answerChars: 10 }), CFG);
  assert.equal(v.escalate, true);
  assert.equal(v.reason, "answer_too_short");
});

test("shouldEscalate: recusa + RAG não achou → escala", () => {
  const v = shouldEscalate(sig({ answerRefusalLike: true, ragOk: false }), CFG);
  assert.deepEqual(v, { escalate: true, reason: "refusal_no_rag" });
});

test("shouldEscalate: recusa + RAG fraco (score < min) → escala", () => {
  const v = shouldEscalate(sig({ answerRefusalLike: true, ragOk: true, ragTopScore: 0.4 }), CFG);
  assert.deepEqual(v, { escalate: true, reason: "refusal_weak_rag" });
});

test("shouldEscalate: recusa MAS RAG forte → NÃO escala (o contexto estava lá)", () => {
  const v = shouldEscalate(sig({ answerRefusalLike: true, ragOk: true, ragTopScore: 0.8 }), CFG);
  assert.equal(v.escalate, false);
});

test("shouldEscalate: resposta boa e longa → NÃO escala", () => {
  assert.deepEqual(shouldEscalate(sig(), CFG), { escalate: false, reason: "confident" });
});

test("nextEscalationTier: sobe um degrau; undefined no último ou tier desconhecido", () => {
  const tiers = ["local", "zen", "soul"];
  assert.equal(nextEscalationTier(tiers, "local"), "zen");
  assert.equal(nextEscalationTier(tiers, "zen"), "soul");
  assert.equal(nextEscalationTier(tiers, "soul"), undefined);
  assert.equal(nextEscalationTier(tiers, "langgraph"), undefined);
});
