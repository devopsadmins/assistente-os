import { test } from "node:test";
import assert from "node:assert/strict";
import { runPromptCommand } from "../prompt.js";

function capture(fn: () => number): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  try {
    const code = fn();
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test("os prompt list: tabela com id/versão/hash e contagem", () => {
  const { code, out } = capture(() => runPromptCommand(["list"]));
  assert.equal(code, 0);
  assert.match(out, /agent-react-system\s+1\s+[0-9a-f]{12}/);
  assert.match(out, /rag-answer\s+1\s+[0-9a-f]{12}/);
  assert.match(out, /\d+ prompt\(s\)\./);
  // ordenado por id: 'agent-react-system' antes de 'concise-output'
  assert.ok(out.indexOf("agent-react-system") < out.indexOf("concise-output"));
});

test("os prompt show <id>: detalhe com template e outputSchema", () => {
  const { code, out } = capture(() => runPromptCommand(["show", "entity-extraction"]));
  assert.equal(code, 0);
  assert.match(out, /# entity-extraction {2}\(v1\)/);
  assert.match(out, /hash: {8}[0-9a-f]{64}/);
  assert.match(out, /outputSchema: \{"entities"/);
  assert.match(out, /--- template ---/);
  assert.match(out, /\{entityKinds\}/);
});

test("os prompt show: id inexistente → exit 1", () => {
  const { code, err } = capture(() => runPromptCommand(["show", "nao-existe"]));
  assert.equal(code, 1);
  assert.match(err, /não encontrado/);
});

test("os prompt: subcomando inválido → uso + exit 1", () => {
  const { code, out } = capture(() => runPromptCommand(["xpto"]));
  assert.equal(code, 1);
  assert.match(out, /uso: os prompt/);
});
