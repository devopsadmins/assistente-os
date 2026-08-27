import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoul, loadConfig, getSoul } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { startDaemon } from "../server.js";
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


test("chat: skills ativadas viram entrada no audit trail (skills: ativadas)", async () => {
  const { home, cleanup } = await homeWithSkill();
  const prevOllama = process.env.OLLAMA_URL;
  const prevHome = process.env.ASSISTENTE_OS_HOME;
  process.env.OLLAMA_URL = "http://127.0.0.1:1";
  process.env.ASSISTENTE_OS_HOME = home; // logFullAuditEntry resolve o home por env
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => ({ code: 0, stdout: "ok", stderr: "", timedOut: false }),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/souls/main/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "me ajuda com a palavra-magica" }),
    });
    assert.equal(res.status, 200);

    const dir = join(home, "souls", "main", "sessoes");
    const audit = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    assert.match(audit, /skills: ativadas/);
    assert.match(audit, /gatilho/);
  } finally {
    if (prevOllama === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevOllama;
    if (prevHome === undefined) delete process.env.ASSISTENTE_OS_HOME;
    else process.env.ASSISTENTE_OS_HOME = prevHome;
    await daemon.close();
    await cleanup();
  }
});
