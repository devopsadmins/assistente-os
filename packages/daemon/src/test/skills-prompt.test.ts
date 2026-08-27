import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoul, loadConfig, getSoul } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { tempDaemonHome } from "./pgTestHelper.js";

async function homeWithSkill(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-skp-"));
  createSoul(home, "main", { name: "main", agent: { permissions: { tools: ["soul_anotar"], skills: ["gatilho"] }, guardrails: {} } });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n");
  const sk = join(home, "souls", "main", "skills", "gatilho");
  mkdirSync(sk, { recursive: true });
  writeFileSync(
    join(sk, "SKILL.md"),
    "---\nname: gatilho\ndescription: skill de teste\nkeywords: [palavra-magica]\ntools: [soul_anotar, tool_ausente]\n---\nCONTEUDO-DA-SKILL-ATIVA",
  );
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("buildPrompt: índice sempre; corpo só quando o prompt casa a keyword", async () => {
  const { home, cleanup } = await homeWithSkill();
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const hit = await buildPrompt({ home, soul, prompt: "isso tem palavra-magica aqui", config, withRag: false });
    assert.match(hit.fullPrompt, /## Skills disponíveis/);
    assert.match(hit.fullPrompt, /- gatilho — skill de teste/);
    assert.match(hit.fullPrompt, /## Skill ativa: gatilho/);
    assert.match(hit.fullPrompt, /CONTEUDO-DA-SKILL-ATIVA/);
    assert.match(hit.fullPrompt, /`tool_ausente` \(indisponível para esta soul\)/);
    assert.equal(hit.skills?.active[0]?.name, "gatilho");

    const miss = await buildPrompt({ home, soul, prompt: "pergunta sem relação nenhuma", config, withRag: false });
    assert.match(miss.fullPrompt, /## Skills disponíveis/);
    assert.doesNotMatch(miss.fullPrompt, /CONTEUDO-DA-SKILL-ATIVA/);
    assert.equal(miss.skills?.active.length, 0);
  } finally {
    await cleanup();
  }
});

test("buildPrompt: SKILLS_ENABLED=0 remove a seção", async () => {
  const { home, cleanup } = await homeWithSkill();
  const prev = process.env.SKILLS_ENABLED;
  process.env.SKILLS_ENABLED = "0";
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const out = await buildPrompt({ home, soul, prompt: "palavra-magica", config, withRag: false });
    assert.doesNotMatch(out.fullPrompt, /## Skills disponíveis/);
    assert.equal(out.skills, undefined);
  } finally {
    if (prev === undefined) delete process.env.SKILLS_ENABLED;
    else process.env.SKILLS_ENABLED = prev;
    await cleanup();
  }
});

test("buildPrompt: skill fora da allowlist não é injetada", async () => {
  const { home, cleanup } = await homeWithSkill();
  try {
    const sk = join(home, "souls", "main", "skills", "nao-listada");
    mkdirSync(sk, { recursive: true });
    writeFileSync(
      join(sk, "SKILL.md"),
      "---\nname: nao-listada\ndescription: fora da allowlist\nkeywords: [palavra-magica]\n---\nNAO-DEVE-APARECER",
    );
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const out = await buildPrompt({ home, soul, prompt: "palavra-magica", config, withRag: false });
    assert.doesNotMatch(out.fullPrompt, /NAO-DEVE-APARECER/);
    assert.doesNotMatch(out.fullPrompt, /- nao-listada —/);
  } finally {
    await cleanup();
  }
});
