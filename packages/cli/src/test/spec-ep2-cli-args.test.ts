/**
 * SPEC-EP2 Frente 2 (Fatia 3, 2026-09-05): `argSchema.ts` centraliza a
 * validação de argv da CLI. Dois achados concretos motivaram a fatia — não
 * eram só "inconsistência de exit code", eram comportamento silenciosamente
 * errado:
 *   - `os agenda list <filtro-com-typo>` caía num fallback pra "pending" sem
 *     avisar nada (agora rejeita).
 *   - `os daemon <porta-inválida>` virava `Number(...)` = NaN, passado
 *     direto pro `http.Server.listen`, travando de um jeito confuso em vez
 *     de um erro claro na hora.
 * Os testes abaixo spawnam o binário compilado de verdade (não chamam
 * `main()` in-process — não é exportado, e testar via subprocess prova o
 * exit code real, que é o contrato que scripts externos dependem).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointDatabaseUrlAtFreshSchema } from "./pgTestHelper.js";

const CLI_PATH = join(import.meta.dirname, "..", "..", "dist", "index.js");

function runCli(args: string[], home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ASSISTENTE_OS_HOME: home },
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

test("SPEC-EP2: os agenda list <filtro inválido> é rejeitado, não cai silenciosamente em 'pending'", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cli-ep2-"));
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  try {
    const r = await runCli(["agenda", "list", "donee"], home);
    assert.notEqual(r.code, 0, `esperava falha; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /válidos/);
    assert.doesNotMatch(r.stdout, /nenhum item pending/);
  } finally {
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: os agenda list (sem filtro) continua funcionando (default pending, sem regressão)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cli-ep2-"));
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  try {
    const r = await runCli(["agenda", "list"], home);
    assert.equal(r.code, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /nenhum item pending/);
  } finally {
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: os daemon <porta inválida> é rejeitado com erro claro, não NaN silencioso", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cli-ep2-"));
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  try {
    const r = await runCli(["daemon", "não-é-porta"], home);
    assert.notEqual(r.code, 0, `esperava falha; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /porta inválida/);
  } finally {
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: comando com argumento obrigatório ausente sai com código != 0 (antes alguns saíam com 0)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cli-ep2-"));
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  try {
    const r = await runCli(["migrate"], home);
    assert.notEqual(r.code, 0, `esperava falha; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /uso: os migrate/);
  } finally {
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: os costs usage --from <data inválida> é rejeitado", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cli-ep2-"));
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  try {
    const r = await runCli(["costs", "usage", "--from", "não-é-data"], home);
    assert.notEqual(r.code, 0, `esperava falha; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /data inválida/);
  } finally {
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
