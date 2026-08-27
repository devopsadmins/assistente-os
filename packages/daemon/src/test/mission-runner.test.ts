/**
 * Testes do Mission Runner (ORCA / E3).
 * Uso: node --test dist/test/mission-runner.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMissions, runMission } from "../orchestrator/mission-runner.js";
import { createSoul, getPool, loadConfig } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "aos-mission-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n");
  const db = await tempDaemonHome(home);
  const prevHome = process.env.ASSISTENTE_OS_HOME;
  process.env.ASSISTENTE_OS_HOME = home;
  try {
    await fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.ASSISTENTE_OS_HOME;
    else process.env.ASSISTENTE_OS_HOME = prevHome;
    await db.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
}

test("listMissions: expõe id/modo/nº de etapas", () => {
  const missions = listMissions();
  assert.ok(missions.length >= 2);
  const ids = missions.map((m) => m.id);
  assert.ok(ids.includes("meetingIngestHeadless"));
  const headless = missions.find((m) => m.id === "meetingIngestHeadless")!;
  assert.equal(headless.mode, "headless");
  assert.equal(headless.steps, 2);
});

test("runMission: missão desconhecida → erro", async () => {
  await assert.rejects(() => runMission("naoexiste"), /não encontrada/);
});

test("runMission: executa todas as etapas mesmo com uma falha; agenda-add persiste de verdade (E3)", async () => {
  await withHome(async (home) => {
    const steps: string[] = [];
    // meeting-ingest falha (sem transcrição real), agenda-add roda em seguida.
    const result = await runMission("meetingIngestHeadless", {
      onStep: (e) => { steps.push(`${e.type}:${e.ok ? "ok" : "fail"}`); },
    });

    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0]!.type, "meeting-ingest");
    assert.equal(result.steps[0]!.ok, false, "meeting-ingest sem arquivo → falha");
    assert.equal(result.steps[1]!.type, "agenda-add");
    assert.equal(result.steps[1]!.ok, true, "agenda-add roda mesmo após a falha anterior");
    assert.equal(result.status, "failed");
    assert.deepEqual(steps, ["meeting-ingest:fail", "agenda-add:ok"]);

    // A etapa agenda-add inseriu um item real no kernel.db.
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const { rows } = await pool.query("SELECT title FROM agenda WHERE soul = 'main'");
    assert.equal(rows.length, 1);
    assert.match(String(rows[0].title), /Follow-up/);
  });
});

test("runMission: guardian-audit degrada para 'pulado' quando o Guardian/Ollama não responde (E3)", async () => {
  await withHome(async () => {
    const prevOllama = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = "http://127.0.0.1:1"; // sem listener
    try {
      const result = await runMission("meetingIngestFull");
      const auditStep = result.steps.find((s) => s.type === "guardian-audit")!;
      assert.ok(auditStep, "guardian-audit executou");
      assert.equal(auditStep.ok, true, "degrada para ok/skipped, não derruba a missão");
      assert.match(auditStep.note ?? "", /pulado/);
    } finally {
      if (prevOllama === undefined) delete process.env.OLLAMA_URL;
      else process.env.OLLAMA_URL = prevOllama;
    }
  });
});
