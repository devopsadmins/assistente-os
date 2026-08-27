import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoulFull } from "@assistente-os/core";
import { runSkillCommand } from "../skill.js";

function home(): string {
  const h = mkdtempSync(join(tmpdir(), "aos-cli-skill-"));
  createSoulFull(h, "main", { name: "main" });
  return h;
}

test("os skill list: mostra as skills e o marcador de allowlist", () => {
  const h = home();
  try {
    mkdirSync(join(h, "skills", "glob"), { recursive: true });
    writeFileSync(join(h, "skills", "glob", "SKILL.md"), "---\nname: glob\ndescription: skill global\n---\ncorpo");
    const out = runSkillCommand(h, ["list", "--soul", "main"]);
    assert.match(out, /glob {2}\[global\]/);
    assert.match(out, /skill global/);
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});

test("os skill create: escreve o SKILL.md; show devolve o conteúdo", () => {
  const h = home();
  try {
    const created = runSkillCommand(h, [
      "create", "minha-skill", "--desc", "faz algo", "--keywords", "a,b", "--body", "instruções aqui", "--soul", "main",
    ]);
    assert.match(created, /criada:/);
    assert.ok(existsSync(join(h, "souls", "main", "skills", "minha-skill", "SKILL.md")));

    const shown = runSkillCommand(h, ["show", "minha-skill", "--soul", "main"]);
    assert.match(shown, /name: minha-skill/);
    assert.match(shown, /instruções aqui/);

    // segunda criação com o mesmo nome → conflito
    const again = runSkillCommand(h, ["create", "minha-skill", "--desc", "x", "--body", "y", "--soul", "main"]);
    assert.match(again, /erro \(E_CONFLICT\)/);
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});

test("os skill: subcomando ausente → uso", () => {
  assert.match(runSkillCommand("/tmp", []), /uso: os skill/);
});
