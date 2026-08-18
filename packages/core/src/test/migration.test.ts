import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateAlmas } from "../migration.js";
import { listSouls, getSoul } from "../souls.js";
import { loadConfig } from "../config.js";

test("migrateAlmas migra estrutura de almas para souls", () => {
  const root = mkdtempSync(join(tmpdir(), "aos-slc-"));
  try {
    // alma 1: completa
    mkdirSync(join(root, "desenvolvimento", "sessoes"), { recursive: true });
    mkdirSync(join(root, "desenvolvimento", "documentos"), { recursive: true });
    mkdirSync(join(root, "desenvolvimento", "conhecimento", "skills"), { recursive: true });
    writeFileSync(join(root, "desenvolvimento", "perfil.md"), "# Persona\nid: desenvolvimento\n");
    writeFileSync(join(root, "desenvolvimento", "contexto.md"), "em andamento");
    writeFileSync(join(root, "desenvolvimento", "licoes.md"), "licoes");
    writeFileSync(join(root, "desenvolvimento", "pessoas.md"), "pessoas");
    writeFileSync(join(root, "desenvolvimento", "sessoes", "2026-08-10.md"), "log diario");
    writeFileSync(join(root, "desenvolvimento", "documentos", "nota.pdf"), "pdf falso");
    writeFileSync(join(root, "desenvolvimento", "conhecimento", "skills", "x.md"), "skill x");
    // arquivo de segredo deve ser ignorado
    writeFileSync(join(root, "desenvolvimento", "config.json"), '{"secret":true}');
    // alma 2: só perfil
    mkdirSync(join(root, "main"), { recursive: true });
    writeFileSync(join(root, "main", "perfil.md"), "# main\n");

    const home = mkdtempSync(join(tmpdir(), "aos-home-"));
    try {
      const cfg = loadConfig({ home });
      const summary = migrateAlmas(root, cfg.home);

      assert.equal(summary.migrated, 2);
      assert.equal(summary.perSoul["desenvolvimento"]?.md, 6);
      assert.equal(summary.perSoul["main"]?.md, 1);

      const souls = listSouls(cfg.home);
      assert.deepEqual(souls.map((s) => s.id), ["desenvolvimento", "main"]);

      const dev = getSoul(cfg.home, "desenvolvimento");
      assert.ok(dev);
      assert.equal(getSoul(cfg.home, "desenvolvimento")?.config.name, "desenvolvimento");

      // layout esperado: sessoes/ e conhecimento/ no topo; documentos/ sob sources/
      const devDir = souls[0]!.dir;
      assert.equal(existsSync(join(devDir, "perfil.md")), true);
      assert.equal(existsSync(join(devDir, "sessoes", "2026-08-10.md")), true);
      assert.equal(existsSync(join(devDir, "conhecimento", "skills", "x.md")), true);
      assert.equal(existsSync(join(devDir, "sources", "documentos", "nota.pdf")), true);
      // config.json da soul é o benigno (name), não o de segredos do SLC-OS
      const cfgJson = JSON.parse(readFileSync(join(devDir, "config.json"), "utf8"));
      assert.equal(cfgJson.name, "desenvolvimento");
      assert.equal("secrets" in cfgJson, false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
