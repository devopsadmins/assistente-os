import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCompliance, REVIEW_LABEL } from "./compliance-rules.mjs";

const GOOD_BODY = [
  "## Descrição",
  "Adiciona o gate de compliance no CI para validar PRs automaticamente.",
  "## Rastreabilidade",
  "Ref: T1.1 de docs/ARCHITECTURE-REVIEW.md",
  "## Rollback",
  "Rollback: reverter o merge e remover o job compliance do ci.yml.",
].join("\n");

test("PR bem preenchido, sem arquivos sensíveis → sem pendências", () => {
  assert.deepEqual(
    evaluateCompliance({ body: GOOD_BODY, changedFiles: ["packages/daemon/src/foo.ts"], labels: [] }),
    [],
  );
});

test("descrição curta é reprovada", () => {
  const v = evaluateCompliance({ body: "Rollback: revert\nRef: #12", changedFiles: [], labels: [] });
  assert.ok(v.some((m) => m.includes("muito curta")));
});

test("comentários HTML não contam para a descrição mínima", () => {
  const body = "<!-- " + "x".repeat(200) + " -->\nRollback: revert do merge\nRef: ADR-AI-003";
  const v = evaluateCompliance({ body, changedFiles: [], labels: [] });
  assert.ok(v.some((m) => m.includes("muito curta")));
});

test("falta linha Rollback é reprovado", () => {
  const body = GOOD_BODY.replace(/## Rollback[\s\S]*$/, "");
  const v = evaluateCompliance({ body, changedFiles: [], labels: [] });
  assert.ok(v.some((m) => m.includes("Rollback")));
});

test('Rollback "N/A" não é aceito', () => {
  const body = GOOD_BODY.replace(/Rollback:.*/, "Rollback: N/A");
  const v = evaluateCompliance({ body, changedFiles: [], labels: [] });
  assert.ok(v.some((m) => m.includes("Rollback")));
});

test("falta referência de rastreabilidade é reprovado", () => {
  const body = GOOD_BODY.replace("Ref: T1.1 de docs/ARCHITECTURE-REVIEW.md", "Ref: nenhuma");
  const v = evaluateCompliance({ body, changedFiles: [], labels: [] });
  assert.ok(v.some((m) => m.includes("rastreabilidade")));
});

test("aceita rastreabilidade via #issue, ADR-XXX-000, Exx e Tn.n", () => {
  for (const ref of ["#42", "ADR-PRIV-001", "roadmap E8.2", "T1.3"]) {
    const body = GOOD_BODY.replace("Ref: T1.1 de docs/ARCHITECTURE-REVIEW.md", `Ref: ${ref}`);
    assert.deepEqual(
      evaluateCompliance({ body, changedFiles: ["packages/daemon/src/x.ts"], labels: [] }),
      [],
      `esperava aprovar com ref "${ref}"`,
    );
  }
});

test("mudança em config de governança sem ADR/CHANGELOG é reprovada", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: ["packages/core/src/config.ts"],
    labels: [],
  });
  assert.ok(v.some((m) => m.includes("config sensível sem registro")));
});

test("mudança em config de governança COM entrada no CHANGELOG passa", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: ["packages/core/src/config.ts", "CHANGELOG.md"],
    labels: [],
  });
  assert.deepEqual(v, []);
});

test("caminho sensível sem label é reprovado", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: ["packages/core/src/policy.ts", "CHANGELOG.md"],
    labels: [],
  });
  assert.ok(v.some((m) => m.includes(REVIEW_LABEL)));
});

test("caminho sensível COM label de revisão passa", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: ["packages/core/src/policy.ts", "CHANGELOG.md"],
    labels: ["governanca-revisada"],
  });
  assert.deepEqual(v, []);
});

test("label é case-insensitive", () => {
  const v = evaluateCompliance({
    body: GOOD_BODY,
    changedFiles: [".github/workflows/ci.yml", "CHANGELOG.md"],
    labels: ["Governanca-Revisada"],
  });
  assert.deepEqual(v, []);
});

test("acumula múltiplas pendências", () => {
  const v = evaluateCompliance({ body: "muda coisas", changedFiles: ["packages/core/src/policy.ts"], labels: [] });
  assert.ok(v.length >= 3, `esperava >=3 pendências, obteve ${v.length}: ${JSON.stringify(v)}`);
});
