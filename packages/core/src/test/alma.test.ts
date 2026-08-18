import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionFile, anotar, registrarLicao, decidir, ensureAlmaFiles, todayISODate } from "../alma.js";

const TODAY = todayISODate();

function tempAlma(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "aos-alma-"));
  return { dir };
}

test("ensureAlmaFiles cria arquivos e pastas (idempotente)", () => {
  const { dir } = tempAlma();
  try {
    ensureAlmaFiles(dir);
    for (const f of ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"]) {
      assert.equal(existsSync(join(dir, f)), true);
    }
    assert.equal(existsSync(join(dir, "sessoes")), true);
    assert.equal(existsSync(join(dir, "decisoes")), true);
    // segunda chamada não deve reescrever
    const before = readFileSync(join(dir, "licoes.md"), "utf8");
    ensureAlmaFiles(dir);
    assert.equal(readFileSync(join(dir, "licoes.md"), "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sessionFile garante pasta sessoes e devolve caminho com data", () => {
  const { dir } = tempAlma();
  try {
    const f = sessionFile(dir, "2026-08-16");
    assert.match(f, new RegExp(`sessoes[\\\\/]2026-08-16\\.md$`));
    assert.equal(existsSync(join(dir, "sessoes")), true);
    // sessionFile cria apenas a pasta; o arquivo é criado no primeiro anotar
    assert.equal(existsSync(f), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anotar append cronológico na sessão do dia", () => {
  const { dir } = tempAlma();
  try {
  const f = anotar(dir, "primeira nota");
  anotar(dir, "segunda nota");
  const content = readFileSync(f, "utf8");
  assert.match(content, new RegExp(`# Sessão ${TODAY}`));
  assert.match(content, /- .* — primeira nota/);
  assert.match(content, /- .* — segunda nota/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registrarLicao append em licoes.md com data", () => {
  const { dir } = tempAlma();
  try {
  const f = registrarLicao(dir, "nunca confie em shell=True");
  const content = readFileSync(f, "utf8");
  assert.match(content, new RegExp(`- \\[${TODAY}\\] nunca confie em shell=True`));
    // segunda não sobrescreve
    registrarLicao(dir, "sempre testar");
    assert.match(readFileSync(f, "utf8"), new RegExp(`- \\[${TODAY}\\] sempre testar`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decidir grava ADR em decisoes/ e falha se duplicado", () => {
  const { dir } = tempAlma();
  try {
  const f = decidir(dir, {
      titulo: "Usar gate de relevância recusar",
      contexto: "RAG sem gate responde fora de contexto",
      decisao: "Adotar relevancia() com modo recusar",
      alternativas: "- liberar tudo",
      consequencias: "- menos respostas espúrias",
    });
  assert.match(f, new RegExp(`${TODAY}-usar-gate-de-relevancia-recusar\\.md$`));
    const content = readFileSync(f, "utf8");
    assert.match(content, /# Decisão: Usar gate de relevância recusar/);
    assert.match(content, /## Contexto/);
    assert.match(content, /## Decisão/);
    assert.match(content, /## Alternativas consideradas/);
    assert.match(content, /## Consequências/);
    assert.throws(() => decidir(dir, { titulo: "Usar gate de relevância recusar" }), /já existe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
