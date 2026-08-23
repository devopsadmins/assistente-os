import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSoulFull,
  getActiveSoul,
  listSouls,
  rollbackActiveSoul,
  setActiveSoul,
} from "../souls.js";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "aos-souls-test-"));
}

function withTempHome(fn: (dir: string) => void) {
  const dir = tempHome();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── createSoulFull: criação atômica (§5.2 passo 5, §11 #5/#6) ───────────

test("createSoulFull: cria config.json, 5 arquivos de alma e 3 dirs (sessoes/sources/decisoes)", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "nova", { name: "nova", description: "teste" });
    assert.equal(result.created, true);
    if (!result.created) return;
    assert.equal(result.soul.id, "nova");
    assert.ok(existsSync(join(result.soul.dir, "config.json")));
    for (const f of ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"]) {
      assert.ok(existsSync(join(result.soul.dir, f)), `esperava ${f}`);
    }
    for (const d of ["sessoes", "sources", "decisoes"]) {
      assert.ok(existsSync(join(result.soul.dir, d)), `esperava dir ${d}`);
    }
    const config = JSON.parse(readFileSync(join(result.soul.dir, "config.json"), "utf8"));
    assert.equal(config.name, "nova");
    assert.equal(config.description, "teste");
  });
});

test("createSoulFull: grava o conteúdo inicial dos arquivos de alma quando fornecido", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "nova", { name: "nova" }, { "perfil.md": "# Perfil inicial" });
    assert.equal(result.created, true);
    if (!result.created) return;
    assert.equal(readFileSync(join(result.soul.dir, "perfil.md"), "utf8"), "# Perfil inicial");
    assert.equal(readFileSync(join(result.soul.dir, "contexto.md"), "utf8"), "");
  });
});

test("createSoulFull: id inválido (path traversal) é rejeitado com E_VALIDATION, nada é criado", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "../etc/passwd", { name: "x" });
    assert.equal(result.created, false);
    if (result.created) return;
    assert.equal(result.code, "E_VALIDATION");
    assert.deepEqual(listSouls(home), []);
  });
});

test("createSoulFull: id já existente é rejeitado com E_CONFLICT (§11 #5)", () => {
  withTempHome((home) => {
    const first = createSoulFull(home, "dup", { name: "dup" });
    assert.equal(first.created, true);

    const second = createSoulFull(home, "dup", { name: "dup", description: "tentativa 2" });
    assert.equal(second.created, false);
    if (second.created) return;
    assert.equal(second.code, "E_CONFLICT");

    // A soul original não foi corrompida pela segunda tentativa.
    const config = JSON.parse(readFileSync(join(home, "souls", "dup", "config.json"), "utf8"));
    assert.equal(config.description, undefined);
  });
});

test("createSoulFull: corrida no mesmo id — a primeira chamada vence, a segunda perde com E_CONFLICT, sem dir residual (§11 #5)", () => {
  withTempHome((home) => {
    // Simula duas criações concorrentes disputando o mesmo id: cada uma monta seu
    // próprio temp dir e disputa o rename() exclusivo sobre o mesmo finalDir.
    const winner = createSoulFull(home, "corrida", { name: "corrida", description: "vencedora" });
    const loser = createSoulFull(home, "corrida", { name: "corrida", description: "perdedora" });

    assert.equal(winner.created, true);
    assert.equal(loser.created, false);
    if (loser.created) return;
    assert.equal(loser.code, "E_CONFLICT");

    // Só a soul vencedora existe, e listSouls não vaza nenhum diretório temporário.
    const souls = listSouls(home);
    assert.deepEqual(souls.map((s) => s.id), ["corrida"]);
    assert.equal(souls[0]?.config.description, "vencedora");
  });
});

test("createSoulFull: diretório temporário nunca aparece em listSouls mesmo após conflito", () => {
  withTempHome((home) => {
    createSoulFull(home, "x", { name: "x" });
    createSoulFull(home, "x", { name: "x" }); // perde, deixaria um .tmp-x-* se não fizesse rollback
    const souls = listSouls(home);
    assert.ok(!souls.some((s) => s.id.startsWith(".")));
  });
});

// ── setActiveSoul / rollbackActiveSoul: swap atômico (§2 "set_active") ──

test("setActiveSoul: primeira chamada retorna previousActiveSoul null", () => {
  withTempHome((home) => {
    const result = setActiveSoul(home, "a");
    assert.equal(result.previousActiveSoul, null);
    assert.equal(result.activeSoul, "a");
    assert.equal(getActiveSoul(home), "a");
  });
});

test("setActiveSoul: chamada subsequente retorna o valor anterior", () => {
  withTempHome((home) => {
    setActiveSoul(home, "a");
    const result = setActiveSoul(home, "b");
    assert.equal(result.previousActiveSoul, "a");
    assert.equal(result.activeSoul, "b");
    assert.equal(getActiveSoul(home), "b");
  });
});

test("rollbackActiveSoul: restaura o valor anterior", () => {
  withTempHome((home) => {
    setActiveSoul(home, "a");
    const { previousActiveSoul } = setActiveSoul(home, "b");
    rollbackActiveSoul(home, previousActiveSoul);
    assert.equal(getActiveSoul(home), "a");
  });
});

test("rollbackActiveSoul: com previousActiveSoul null remove active.json", () => {
  withTempHome((home) => {
    const { previousActiveSoul } = setActiveSoul(home, "a");
    assert.equal(previousActiveSoul, null);
    rollbackActiveSoul(home, previousActiveSoul);
    assert.equal(getActiveSoul(home), null);
  });
});
