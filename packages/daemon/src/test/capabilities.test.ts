import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";
import { createSoul } from "@assistente-os/core";

test("daemon: GET /llms.txt expõe rotas, tools MCP e souls (loopback, sem token)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-dmn-llms-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const { cleanup } = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/llms.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
    const body = await res.text();
    assert.match(body, /^# Assistente OS/);
    assert.ok(body.includes("## Rotas ativas"));
    assert.ok(body.includes("## Catálogo de MCP Tools"));
    assert.ok(body.includes("## Souls registradas"));
    assert.ok(body.includes("`main`"));
    assert.ok(body.includes("spec_grill_plan"));
    assert.ok(body.includes("browser_navigate"));
    assert.ok(body.includes("sales_ingest_meeting"));
    assert.ok(body.includes("guardian_approve_rule"));
  } finally {
    await daemon.close();
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("daemon: GET /api/capabilities retorna JSON estruturado", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-dmn-cap-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const { cleanup } = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/api/capabilities`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body: any = await res.json();
    assert.ok(body.system);
    assert.ok(body.system.name === "Assistente OS");
    assert.ok(Array.isArray(body.souls));
    assert.ok(body.souls.length >= 1);
    assert.ok(body.souls.some((s: any) => s.id === "main"));
    assert.ok(Array.isArray(body.restEndpoints));
    assert.ok(body.restEndpoints.length > 0);
    assert.ok(body.operationalMissions.description);
    assert.ok(Array.isArray(body.operationalMissions.examples));
    assert.ok(body.operationalMissions.examples.length >= 2);
  } finally {
    await daemon.close();
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});