import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rateLimitHit,
  __resetRateLimiter,
  tryAcquireExecSlot,
  releaseExecSlot,
  __resetExecSlots,
  execInFlight,
  isExpensivePath,
} from "../throttle.js";

test("rateLimitHit: permite até max, bloqueia depois, reseta na janela, isola por cliente", () => {
  __resetRateLimiter();
  const cfg = { max: 3, windowMs: 1000 };
  const t0 = 100_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimitHit("a", cfg, t0).ok, true);
  const blocked = rateLimitHit("a", cfg, t0);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(rateLimitHit("b", cfg, t0).ok, true, "outro cliente não afetado");
  assert.equal(rateLimitHit("a", cfg, t0 + 1001).ok, true, "passada a janela, libera");
});

test("rateLimitHit: max<=0 desliga o guarda", () => {
  __resetRateLimiter();
  for (let i = 0; i < 100; i++) assert.equal(rateLimitHit("x", { max: 0, windowMs: 1000 }).ok, true);
});

test("semáforo: adquire até o cap, 503 depois, release devolve o slot", () => {
  __resetExecSlots();
  const prev = process.env.AOS_MAX_CONCURRENT_EXEC;
  process.env.AOS_MAX_CONCURRENT_EXEC = "2";
  try {
    assert.equal(tryAcquireExecSlot(), true);
    assert.equal(tryAcquireExecSlot(), true);
    assert.equal(execInFlight(), 2);
    assert.equal(tryAcquireExecSlot(), false, "no cap");
    releaseExecSlot();
    assert.equal(tryAcquireExecSlot(), true);
  } finally {
    if (prev === undefined) delete process.env.AOS_MAX_CONCURRENT_EXEC;
    else process.env.AOS_MAX_CONCURRENT_EXEC = prev;
    __resetExecSlots();
  }
});

test("semáforo: cap<=0 desliga o guarda", () => {
  __resetExecSlots();
  const prev = process.env.AOS_MAX_CONCURRENT_EXEC;
  process.env.AOS_MAX_CONCURRENT_EXEC = "0";
  try {
    for (let i = 0; i < 50; i++) assert.equal(tryAcquireExecSlot(), true);
  } finally {
    if (prev === undefined) delete process.env.AOS_MAX_CONCURRENT_EXEC;
    else process.env.AOS_MAX_CONCURRENT_EXEC = prev;
    __resetExecSlots();
  }
});

test("isExpensivePath: chat / stream / missions / pipelines seguram slot", () => {
  assert.equal(isExpensivePath("/souls/main/chat"), true);
  assert.equal(isExpensivePath("/souls/consultoria_ia/chat"), true);
  assert.equal(isExpensivePath("/souls/main/threads/1/messages/stream"), true);
  assert.equal(isExpensivePath("/souls/consultoria_ia/threads/42/messages/stream"), true);
  assert.equal(isExpensivePath("/api/missions/m1/run"), true);
  assert.equal(isExpensivePath("/api/pipelines/email-ingest"), true);
  assert.equal(isExpensivePath("/souls/main"), false);
  assert.equal(isExpensivePath("/souls/main/buffer"), false);
  assert.equal(isExpensivePath("/souls/main/threads/1/messages"), false);
  assert.equal(isExpensivePath("/health"), false);
  assert.equal(isExpensivePath("/agenda"), false);
});
