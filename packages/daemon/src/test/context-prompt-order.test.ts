/**
 * T3.3 — ordem do montador de prompt: estático → volátil, para maximizar o
 * prefixo de bytes idêntico entre turnos (prompt caching / KV cache do Ollama).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoul, loadConfig, getSoul, CONCISE_OUTPUT_DIRECTIVE } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { tempDaemonHome } from "./pgTestHelper.js";

async function homeWithSoul(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-ord-"));
  createSoul(home, "main", { name: "main" });
  const dir = join(home, "souls", "main");
  writeFileSync(join(dir, "perfil.md"), "PERFIL-ESTAVEL do assistente principal");
  writeFileSync(join(dir, "licoes.md"), "LICAO-ESTAVEL aprendida");
  mkdirSync(join(dir, "sessoes"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, "sessoes", `${today}.md`), "LOG-DA-SESSAO-VOLATIL turno 1");
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("buildPrompt: CONCISE_OUTPUT_DIRECTIVE primeiro; persona antes do log de sessão; sessão/rag/histórico na cauda", async () => {
  const { home, cleanup } = await homeWithSoul();
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const built = await buildPrompt({
      home,
      soul,
      prompt: "pergunta do usuário",
      config,
      withRag: false,
      history: [
        { role: "user", content: "oi" },
        { role: "assistant", content: "olá" },
      ],
    });
    const p = built.fullPrompt;

    assert.ok(p.startsWith(CONCISE_OUTPUT_DIRECTIVE), "diretriz FinOps é o prefixo");

    const iPersona = p.indexOf("PERFIL-ESTAVEL");
    const iLicao = p.indexOf("LICAO-ESTAVEL");
    const iSessao = p.indexOf("LOG-DA-SESSAO-VOLATIL");
    const iHist = p.indexOf("## Histórico da conversa");
    const iUser = p.indexOf("--- Instrução do usuário ---");

    assert.ok(iPersona > 0 && iLicao > 0 && iSessao > 0 && iHist > 0 && iUser > 0, "todos os blocos presentes");
    assert.ok(iPersona < iSessao, "persona (estável) vem antes do log de sessão (volátil)");
    assert.ok(iLicao < iSessao, "lições (estável) vêm antes do log de sessão");
    assert.ok(iSessao < iHist, "log de sessão antes do histórico");
    assert.ok(iHist < iUser, "histórico antes da instrução do usuário (que é o último)");

    // o campo de compat `almaCtx` ainda carrega persona + sessão
    assert.match(built.almaCtx, /PERFIL-ESTAVEL/);
    assert.match(built.almaCtx, /LOG-DA-SESSAO-VOLATIL/);
  } finally {
    await cleanup();
  }
});

test("buildPrompt: o prefixo até a persona é idêntico quando só o log de sessão muda entre turnos", async () => {
  const { home, cleanup } = await homeWithSoul();
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const t1 = await buildPrompt({ home, soul, prompt: "q1", config, withRag: false });

    // turno 2: o log da sessão cresceu
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(
      join(home, "souls", "main", "sessoes", `${today}.md`),
      "LOG-DA-SESSAO-VOLATIL turno 1\nLOG-DA-SESSAO-VOLATIL turno 2 (novo)",
    );
    const t2 = await buildPrompt({ home, soul, prompt: "q2", config, withRag: false });

    const boundary = "LOG-DA-SESSAO-VOLATIL";
    const prefix1 = t1.fullPrompt.slice(0, t1.fullPrompt.indexOf(boundary));
    const prefix2 = t2.fullPrompt.slice(0, t2.fullPrompt.indexOf(boundary));
    assert.equal(prefix1, prefix2, "prefixo até o log de sessão não muda entre turnos");
    assert.ok(prefix1.includes("PERFIL-ESTAVEL"), "e esse prefixo estável inclui a persona");
  } finally {
    await cleanup();
  }
});
