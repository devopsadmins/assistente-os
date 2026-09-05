import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompliance } from "./compliance-rules.mjs";

const GOOD_BODY = [
  "## Descrição",
  "Adiciona o gate de compliance no CI para validar PRs automaticamente.",
  "## Plano (arquivos + ordem)",
  "Plano: 1) .github/scripts/compliance-rules.mjs (regra nova), 2) ci.yml (liga o step).",
  "## Rastreabilidade",
  "Ref: T1.1 de docs/ARCHITECTURE-REVIEW.md",
  "## Rollback",
  "Rollback: reverter o merge e remover o job compliance do ci.yml.",
].join("\n");

test("PR bem preenchido, sem arquivos sensíveis → sem pendências", () => {
  assert.deepEqual(
    evaluateCompliance({ body: GOOD_BODY, changedFiles: ["packages/daemon/src/foo.ts"] }),
    [],
  );
});

test("descrição curta é reprovada", () => {
  const v = evaluateCompliance({ body: "Rollback: revert\nRef: #12", changedFiles: [] });
  assert.ok(v.some((m) => m.includes("muito curta")));
});

test("comentários HTML não contam para a descrição mínima", () => {
  const body = "<!-- " + "x".repeat(200) + " -->\nRollback: revert do merge\nRef: ADR-AI-003";
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("muito curta")));
});

test("falta a seção Plano é reprovado (SPEC-EP1)", () => {
  const body = GOOD_BODY.replace(/## Plano[\s\S]*?## Rastreabilidade/, "## Rastreabilidade");
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("Plano")));
});

test('Plano "N/A" não é aceito (SPEC-EP1)', () => {
  const body = GOOD_BODY.replace(/Plano:.*/, "Plano: N/A");
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("Plano")));
});

test("Plano curto demais (menos que o mínimo) é reprovado (SPEC-EP1)", () => {
  const body = GOOD_BODY.replace(/Plano:.*/, "Plano: ok");
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("Plano")));
});

test("Plano com conteúdo real em múltiplas linhas é aceito (SPEC-EP1)", () => {
  const body = GOOD_BODY.replace(
    /Plano:.*/,
    "Plano:\n1) packages/core/src/config.ts — adiciona o schema novo.\n2) packages/tools/src/misc/index.ts — consome o schema.",
  );
  assert.deepEqual(evaluateCompliance({ body, changedFiles: [] }), []);
});

test("falta linha Rollback é reprovado", () => {
  const body = GOOD_BODY.replace(/## Rollback[\s\S]*$/, "");
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("Rollback")));
});

test('Rollback "N/A" não é aceito', () => {
  const body = GOOD_BODY.replace(/Rollback:.*/, "Rollback: N/A");
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("Rollback")));
});

test("falta referência de rastreabilidade é reprovado", () => {
  const body = GOOD_BODY.replace("Ref: T1.1 de docs/ARCHITECTURE-REVIEW.md", "Ref: nenhuma");
  const v = evaluateCompliance({ body, changedFiles: [] });
  assert.ok(v.some((m) => m.includes("rastreabilidade")));
});

test("aceita rastreabilidade via #issue, ADR-XXX-000, Exx e Tn.n", () => {
  for (const ref of ["#42", "ADR-PRIV-001", "roadmap E8.2", "T1.3"]) {
    const body = GOOD_BODY.replace("Ref: T1.1 de docs/ARCHITECTURE-REVIEW.md", `Ref: ${ref}`);
    assert.deepEqual(
      evaluateCompliance({ body, changedFiles: ["packages/daemon/src/x.ts"] }),
      [],
      `esperava aprovar com ref "${ref}"`,
    );
  }
});

test("mudança em caminho sensível sem CHANGELOG/ADR é reprovada", () => {
  for (const f of [
    "packages/core/src/config.ts",
    "packages/core/src/policy.ts",
    "packages/core/src/governance/golden-rules.ts",
    ".github/workflows/ci.yml",
    ".github/scripts/compliance-rules.mjs",
  ]) {
    const v = evaluateCompliance({ body: GOOD_BODY, changedFiles: [f] });
    assert.ok(v.some((m) => m.includes("caminho sensível sem registro")), `esperava reprovar ${f}`);
  }
});

test("editar um ADR sozinho já é o próprio paper trail (passa)", () => {
  assert.deepEqual(evaluateCompliance({ body: GOOD_BODY, changedFiles: ["docs/adr/ADR-RAG-001.md"] }), []);
});

test("mudança em caminho sensível COM entrada no CHANGELOG passa", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: ["packages/core/src/config.ts", "CHANGELOG.md"],
  });
  assert.deepEqual(v, []);
});

test("mudança em caminho sensível COM entrada em docs/adr/ passa", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: ["packages/core/src/policy.ts", "docs/adr/ADR-XX-001.md"],
  });
  assert.deepEqual(v, []);
});

test("arquivo comum (não sensível) não exige paper trail", () => {
  const v = evaluateCompliance({ body: GOOD_BODY, changedFiles: ["packages/daemon/src/routes/chat.ts"] });
  assert.deepEqual(v, []);
});

test("acumula múltiplas pendências", () => {
  const v = evaluateCompliance({ body: "muda coisas", changedFiles: ["packages/core/src/policy.ts"] });
  assert.ok(v.length >= 4, `esperava >=4 pendências, obteve ${v.length}: ${JSON.stringify(v)}`);
});
