import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionFile, anotar, registrarLicao, decidir, ensureAlmaFiles, todayISODate, appendUsageMetadata } from "../alma.js";

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

test("appendUsageMetadata anexa bloco yaml com os campos de telemetria (SPEC-GR2)", () => {
  const { dir } = tempAlma();
  try {
    const f = appendUsageMetadata(dir, {
      sessionId: "sess-1",
      promptTokens: 120,
      completionTokens: 45,
      latencyMs: 980,
      modelUsed: "nemotron-3-ultra-free",
      executionMode: "direct",
    });
    const content = readFileSync(f, "utf8");
    assert.match(content, /```yaml usage_metadata/);
    assert.match(content, /session_id: "sess-1"/);
    assert.match(content, /prompt_tokens: 120/);
    assert.match(content, /completion_tokens: 45/);
    assert.match(content, /latency_ms: 980/);
    assert.match(content, /model_used: "nemotron-3-ultra-free"/);
    assert.match(content, /execution_mode: "direct"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendUsageMetadata é idempotente por sessionId — não duplica ao reprocessar", () => {
  const { dir } = tempAlma();
  try {
    appendUsageMetadata(dir, {
      sessionId: "sess-2",
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 100,
      modelUsed: "m",
      executionMode: "direct",
    });
    const f = appendUsageMetadata(dir, {
      sessionId: "sess-2",
      promptTokens: 999, // valores diferentes — não deve sobrescrever nem duplicar
      completionTokens: 999,
      latencyMs: 999,
      modelUsed: "outro-modelo",
      executionMode: "outro",
    });
    const content = readFileSync(f, "utf8");
    const occurrences = content.split('session_id: "sess-2"').length - 1;
    assert.equal(occurrences, 1);
    assert.match(content, /prompt_tokens: 10\b/);
    assert.doesNotMatch(content, /prompt_tokens: 999/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendUsageMetadata grava sessões diferentes como blocos separados", () => {
  const { dir } = tempAlma();
  try {
    const f1 = appendUsageMetadata(dir, {
      sessionId: 1,
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 100,
      modelUsed: "m",
      executionMode: "direct",
    });
    const f2 = appendUsageMetadata(dir, {
      sessionId: 2,
      promptTokens: 20,
      completionTokens: 8,
      latencyMs: 200,
      modelUsed: "m",
      executionMode: "direct",
    });
    assert.equal(f1, f2); // mesmo dia, mesmo arquivo
    const content = readFileSync(f1, "utf8");
    assert.match(content, /session_id: "1"/);
    assert.match(content, /session_id: "2"/);
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
