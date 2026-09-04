import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";

const ADMIN_TOKEN = "admin-test-token";

test("GET /souls/:id/langgraph/status responde sem lançar (smoke test — sem cobertura automatizada antes desta task)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-lgstatus-"));
  createSoul(home, "soul-lg-status", { name: "soul-lg-status" });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/soul-lg-status/langgraph/status`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    // Não afirma um status specific — o objetivo é provar que a rota
    // responde (não 404, não crash) antes/depois do reposicionamento.
    assert.notEqual(res.status, 404);
  } finally {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
  }
});
