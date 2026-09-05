/**
 * SPEC-GR4 (achado ao vivo, 2026-09-05): `os discriminator` — usado pelo job
 * `Discriminator` do CI — crashava silenciosamente (exit 1, zero stdout, sem
 * JSON de veredito) porque `main()` roda `runMigrations` (exige Postgres)
 * ANTES de despachar pra qualquer comando, e o job `Discriminator` do CI não
 * tem serviço Postgres (só `build-and-test` tem) — `discriminator` em si
 * nunca tocou banco, só git + Zen/Ollama. Corrigido incluindo "discriminator"
 * na lista de comandos que pulam a etapa de migração (mesma lista de
 * help/backup). Testa contra um `DATABASE_URL` inatingível — se a correção
 * regredir, este teste trava/estoura em vez de retornar rápido.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dirname, "..", "..", "dist", "index.js");
// Porta sem ninguém escutando — ECONNREFUSED rápido, sem esperar o
// connectionTimeoutMillis cheio do pool.
const UNREACHABLE_DB_URL = "postgres://x:x@127.0.0.1:1/x";
const UNREACHABLE_OLLAMA_URL = "http://127.0.0.1:1";

function runCli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        ASSISTENTE_OS_HOME: home,
        DATABASE_URL: UNREACHABLE_DB_URL,
        ZEN_API_KEY: "",
        OLLAMA_URL: UNREACHABLE_OLLAMA_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("SPEC-GR4: os discriminator não exige Postgres — degrada com JSON de veredito, não crasha silencioso", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-gr4-"));
  try {
    const startedAt = Date.now();
    const r = await runCli(["discriminator", "--base", "origin/main"], home);
    const elapsedMs = Date.now() - startedAt;
    // Sem Postgres/Zen/Ollama alcançáveis, o veredito é REPROVADO (score 0) —
    // isso é esperado e correto (Guardian indisponível = não aprova por
    // omissão). O que este teste prova é que chega até aqui: imprime o JSON
    // do veredito em vez de morrer em ECONNREFUSED do Postgres.
    assert.equal(r.code, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /"score"/);
    assert.match(r.stdout, /"feedback"/);
    assert.match(r.stderr, /REPROVADO/);
    assert.doesNotMatch(r.stderr, /ECONNREFUSED.*127\.0\.0\.1:1.*x:x/, "não deveria nem tentar conectar no Postgres inatingível");
    // Rede de segurança de 60s do próprio auditExecution (timeout do fetch) —
    // bem abaixo disso prova que não ficou preso esperando o pool do Postgres.
    assert.ok(elapsedMs < 30_000, `esperava resposta rápida, levou ${elapsedMs}ms`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
