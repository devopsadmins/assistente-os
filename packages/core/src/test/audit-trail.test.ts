import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logIntention, logTelemetry, logFullAuditEntry, buildSessionHeader } from "../governance/audit-trail.js";

function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "aos-audit-"));
  const prev = process.env.ASSISTENTE_OS_HOME;
  process.env.ASSISTENTE_OS_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.ASSISTENTE_OS_HOME;
    else process.env.ASSISTENTE_OS_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

test("audit-trail: logIntention escreve o cabeçalho de sessão e devolve o path", () => {
  withHome((home) => {
    const path = logIntention({
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "s1",
      soulId: "main",
      intention: "testar",
      toolsCalled: ["memory_search"],
    });
    assert.ok(path, "esperava um path não vazio");
    assert.ok(readFileSync(path, "utf8").includes("testar"));
  });
});

test("audit-trail: logTelemetry e logFullAuditEntry funcionam com ASSISTENTE_OS_HOME custom (sem require() ESM)", () => {
  withHome(() => {
    const telemetryPath = logTelemetry("main", { promptTokens: 10, completionTokens: 5, latencyMs: 100 }, "teste");
    assert.ok(telemetryPath);

    const fullPath = logFullAuditEntry({
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "s1",
      soulId: "main",
      intention: "teste completo",
      toolsCalled: [],
    });
    assert.ok(fullPath);
  });
});

test("audit-trail: soulId com path traversal degrada (retorna string vazia), não lança", () => {
  withHome(() => {
    assert.doesNotThrow(() => {
      const path = logIntention({
        ts: "2026-01-01T00:00:00.000Z",
        sessionId: "s1",
        soulId: "../../etc",
        intention: "ataque",
        toolsCalled: [],
      });
      assert.equal(path, "");
    });
  });
});

test("audit-trail: buildSessionHeader sanitiza segredos em params", () => {
  const header = buildSessionHeader({
    ts: "2026-01-01T00:00:00.000Z",
    sessionId: "s1",
    soulId: "main",
    intention: "teste",
    toolsCalled: [],
    params: { token: "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789" },
  });
  assert.ok(!header.includes("sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"), "segredo não deveria aparecer em texto puro");
});
