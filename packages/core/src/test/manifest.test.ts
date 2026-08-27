import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoulFull, buildExecutionManifest } from "../index.js";
import { createTestSchema } from "./pgTestHelper.js";

function tmpHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aos-manifest-"));
  const r = createSoulFull(home, "main", { name: "main" }, { "perfil.md": "# main\n\nassistente\n" });
  assert.equal(r.created, true);
  return home;
}

test("buildExecutionManifest: determinístico (mesmo estado → mesmo hash)", async () => {
  const db = await createTestSchema();
  const home = tmpHome();
  try {
    const m1 = await buildExecutionManifest({ home, pool: db.pool });
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await buildExecutionManifest({ home, pool: db.pool });

    assert.equal(m1.hash, m2.hash, "hash estável entre chamadas");
    assert.notEqual(m1.generatedAt, m2.generatedAt, "generatedAt muda (e fica fora do hash)");
    assert.equal(m1.schemaVersion, 1);
    assert.ok(m1.capabilityCatalog.version);
    assert.ok(m1.capabilityCatalog.tools.some((t) => t.pattern === "worktree_merge_locally" && t.level === "L3"));
    assert.equal(m1.souls.length, 1);
    assert.equal(m1.souls[0]!.id, "main");
    assert.match(m1.souls[0]!.systemPromptHash, /^[0-9a-f]{64}$/);
    assert.ok(m1.migrations.length > 0, "migrações aplicadas no schema de teste");
  } finally {
    rmSync(home, { recursive: true, force: true });
    await db.cleanup();
  }
});

test("buildExecutionManifest: mudar o markdown da soul muda o systemPromptHash e o hash", async () => {
  const db = await createTestSchema();
  const home = tmpHome();
  try {
    const before = await buildExecutionManifest({ home, pool: db.pool });
    writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nCONTEUDO NOVO\n");
    const after = await buildExecutionManifest({ home, pool: db.pool });

    assert.notEqual(before.souls[0]!.systemPromptHash, after.souls[0]!.systemPromptHash);
    assert.notEqual(before.hash, after.hash);
  } finally {
    rmSync(home, { recursive: true, force: true });
    await db.cleanup();
  }
});
