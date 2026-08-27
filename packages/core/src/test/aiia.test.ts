import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoulFull } from "../souls.js";
import { generateAiiaReport, writeAiiaReport, generateAndWriteAiia } from "../governance/aiia.js";
import { proposeRule, approveRule } from "../governance/golden-rules.js";
import type { Familia } from "../familias.js";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "aos-aiia-test-"));
}

function withTempHome(fn: (home: string) => void): void {
  const home = tempHome();
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Aprova uma proposta capturando o código só a partir do retorno de proposeRule (sem depender de rede/Telegram). */
function proposeAndApprove(home: string, topic: string, ruleText: string, reason: string): void {
  const { rule, code } = proposeRule(home, topic, ruleText, reason);
  approveRule(home, home, rule.id, code);
}

const MOCK_FAMILIA: Familia = {
  id: 1,
  telefone: "5511999999999",
  nomeFamilia: "Família Teste",
  nomeCrianca: "Criança Teste",
  soulId: "familia_5511999999999",
  status: "ativo",
  anamnesePhase: 3,
  questionnaireData: {},
  baseLegal: "consentimento",
  baseLegalSensivel: "consentimento explícito (dados de criança)",
  finalidade: "acompanhamento pedagógico",
  encerradoEm: null,
  retencaoAte: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("generateAiiaReport: soul sem agent config usa os defaults globais", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "sem-agent", { name: "sem-agent" });
    assert.equal(result.created, true);

    const report = generateAiiaReport(home, "sem-agent");
    assert.equal(report.soulId, "sem-agent");
    assert.deepEqual(report.capabilities.allowedToolPatterns, [
      "memory:*", "soul_context", "soul_chat", "graph_list", "observation_add",
      "soul_anotar", "soul_licao", "soul_decidir", "agenda_add", "agenda_list",
      "action_execute", "costs_summary", "router_status", "spec_grill_plan",
      "worktree_create", "worktree_merge_locally", "worktree_destroy", "worktree_list", "git_commit_push",
    ]);
    assert.equal(report.capabilities.autonomy, "ask");
    assert.equal(report.guardrails.maxTurns, 10);
    assert.equal(report.guardrails.maxIterations, 5);
    assert.equal(report.guardrails.ragRelevanceThreshold, 0.70);
    assert.equal(report.personalData.isFamiliaSoul, false);
    // DEFAULT_ALLOWED_TOOLS já inclui capabilities L3 (soul_chat, action_execute,
    // spec_grill_plan, worktree_merge_locally, git_commit_push) — o relatório deve
    // refletir isso, não escondê-las. worktree_create/worktree_destroy não estão no
    // catálogo de risco, então não contam como L3.
    assert.deepEqual(report.capabilities.l3Capabilities.sort(), [
      "action_execute", "git_commit_push", "soul_chat", "spec_grill_plan", "worktree_merge_locally",
    ]);
  });
});

test("generateAiiaReport: lista corretamente as capabilities L3 declaradas pela soul", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "com-l3", {
      name: "com-l3",
      agent: {
        permissions: { tools: ["memory:*", "browser_*", "ado_create_work_item", "soul_anotar"] },
        guardrails: {},
      },
    });
    assert.equal(result.created, true);

    const report = generateAiiaReport(home, "com-l3");
    assert.ok(report.capabilities.l3Capabilities.includes("browser_*"));
    assert.ok(report.capabilities.l3Capabilities.includes("ado_create_work_item"));
    assert.equal(report.capabilities.l3Capabilities.length, 2);
  });
});

test("generateAiiaReport: soul com '*' é sinalizada como acesso irrestrito", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "com-wildcard", {
      name: "com-wildcard",
      agent: { permissions: { tools: ["*"] }, guardrails: {} },
    });
    assert.equal(result.created, true);

    const report = generateAiiaReport(home, "com-wildcard");
    assert.equal(report.capabilities.l3Capabilities.length, 1);
    assert.match(report.capabilities.l3Capabilities[0]!, /irrestrito/);
  });
});

test("generateAiiaReport: com familia mockada, popula personalData; sem familia, isFamiliaSoul=false", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "familia_5511999999999", { name: "familia_5511999999999" });
    assert.equal(result.created, true);

    const withFamilia = generateAiiaReport(home, "familia_5511999999999", { familia: MOCK_FAMILIA });
    assert.equal(withFamilia.personalData.isFamiliaSoul, true);
    assert.equal(withFamilia.personalData.baseLegal, "consentimento");
    assert.equal(withFamilia.personalData.finalidade, "acompanhamento pedagógico");

    const withoutFamilia = generateAiiaReport(home, "familia_5511999999999", { familia: null });
    assert.equal(withoutFamilia.personalData.isFamiliaSoul, false);
  });
});

test("generateAiiaReport: reflete golden rules ativas em goldenRulesApplicable", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "com-regras", { name: "com-regras" });
    assert.equal(result.created, true);

    proposeAndApprove(home, "topico-aiia", "regra do AIIA", "teste de integração");

    const report = generateAiiaReport(home, "com-regras");
    assert.equal(report.goldenRulesApplicable.length, 1);
    assert.equal(report.goldenRulesApplicable[0]!.topic, "topico-aiia");
  });
});

test("generateAiiaReport: soul inexistente lança erro", () => {
  withTempHome((home) => {
    assert.throws(() => generateAiiaReport(home, "nao-existe"));
  });
});

test("writeAiiaReport/generateAndWriteAiia: grava AIIA.md e é idempotente (sobrescreve, não duplica)", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "regravavel", { name: "regravavel" });
    assert.equal(result.created, true);

    const path1 = generateAndWriteAiia(home, "regravavel");
    assert.ok(existsSync(path1));
    const content1 = readFileSync(path1, "utf8");
    assert.match(content1, /# AIIA — Avaliação de Impacto Algorítmico/);
    assert.match(content1, /regravavel/);

    proposeAndApprove(home, "topico-novo", "nova regra", "motivo novo");
    const path2 = generateAndWriteAiia(home, "regravavel");
    assert.equal(path2, path1);
    const content2 = readFileSync(path2, "utf8");

    // Sobrescreveu — não duplicou o cabeçalho nem o conteúdo antigo em cima do novo.
    assert.equal(content2.match(/# AIIA — Avaliação de Impacto Algorítmico/g)?.length, 1);
    assert.match(content2, /topico-novo/);
  });
});

test("generateAiiaReport: contagem aproximada de ações auditadas bate com blocos sintéticos em sessoes/*.md", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "com-sessoes", { name: "com-sessoes" });
    assert.equal(result.created, true);
    if (!result.created) return;

    const sessionsDir = join(result.soul.dir, "sessoes");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "2026-01-01.md"),
      "### Auditoria — ação 1\ntexto\n\n### Auditoria — ação 2\ntexto\n",
      "utf8",
    );
    writeFileSync(join(sessionsDir, "2026-01-02.md"), "### Auditoria — ação 3\ntexto\n", "utf8");

    const report = generateAiiaReport(home, "com-sessoes");
    assert.equal(report.automatedDecisionsSummary.sessionFilesScanned, 2);
    assert.equal(report.automatedDecisionsSummary.approxAuditedActions, 3);
  });
});

test("writeAiiaReport: soul sem arquivos de sessão ainda gera relatório válido (contagem zero)", () => {
  withTempHome((home) => {
    const result = createSoulFull(home, "sem-sessoes", { name: "sem-sessoes" });
    assert.equal(result.created, true);

    const report = generateAiiaReport(home, "sem-sessoes");
    assert.equal(report.automatedDecisionsSummary.sessionFilesScanned, 0);
    assert.equal(report.automatedDecisionsSummary.approxAuditedActions, 0);
  });
});
