import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordAgentIncident,
  evaluateAndPromoteRules,
  getLessons,
  listPendingRules,
  approveRule,
  rejectRule,
  listActiveGoldenRules,
  proposeRule,
} from "../governance/golden-rules.js";

function tempSetup(): { configHome: string; repoRoot: string; soulId: string } {
  const configHome = mkdtempSync(join(tmpdir(), "aos-golden-home-"));
  const repoRoot = mkdtempSync(join(tmpdir(), "aos-golden-repo-"));
  const soulId = "test-soul";
  mkdirSync(join(configHome, "souls", soulId), { recursive: true });
  return { configHome, repoRoot, soulId };
}

function cleanup(configHome: string, repoRoot: string): void {
  rmSync(configHome, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
}

const INCIDENT = {
  agentId: "agent-x",
  topic: "shell-injection",
  mistake: "usou shell=True em subprocess",
  rootCause: "não sanitizou input do usuário",
  correctiveRule: "nunca usar shell=True; sempre passar args como array",
};

test("recordAgentIncident grava em licoes.md da soul", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, soulId, INCIDENT);
    const licoes = readFileSync(join(configHome, "souls", soulId, "licoes.md"), "utf8");
    assert.match(licoes, /shell-injection/);
    assert.match(licoes, /usou shell=True em subprocess/);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("1º e 2º incidente do mesmo tópico não geram proposta", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, soulId, INCIDENT);
    const result = recordAgentIncident(configHome, soulId, INCIDENT);
    assert.deepEqual(result.proposed, []);
    assert.deepEqual(listPendingRules(configHome), []);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("3º incidente do mesmo tópico cria proposta pendente, sem aplicar nada ainda", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, soulId, INCIDENT);
    recordAgentIncident(configHome, soulId, INCIDENT);
    const result = recordAgentIncident(configHome, soulId, INCIDENT);

    assert.deepEqual(result.proposed, ["shell-injection"]);

    const pending = listPendingRules(configHome);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.topic, "shell-injection");
    assert.match(pending[0]!.ruleText, /nunca usar shell=True/);

    // Nada é aplicado até aprovação humana.
    assert.equal(existsSync(join(repoRoot, ".opencode", "rules", "golden-rules.md")), false);
    assert.equal(listActiveGoldenRules(configHome).length, 0);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("evaluateAndPromoteRules não duplica proposta já feita (idempotente)", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, soulId, INCIDENT);
    recordAgentIncident(configHome, soulId, INCIDENT);
    recordAgentIncident(configHome, soulId, INCIDENT);

    const before = listPendingRules(configHome);
    const second = evaluateAndPromoteRules(configHome);
    assert.deepEqual(second.proposed, []);
    assert.deepEqual(listPendingRules(configHome), before);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("approveRule grava golden-rules.md/AGENTS.md e o índice ativo; marca a proposta como aprovada", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, soulId, INCIDENT);
    recordAgentIncident(configHome, soulId, INCIDENT);
    recordAgentIncident(configHome, soulId, INCIDENT);
    const [pending] = listPendingRules(configHome);

    const rule = approveRule(configHome, repoRoot, pending!.id);
    assert.equal(rule.topic, "shell-injection");

    const rulesPath = join(repoRoot, ".opencode", "rules", "golden-rules.md");
    assert.equal(existsSync(rulesPath), true);
    assert.match(readFileSync(rulesPath, "utf8"), /## shell-injection/);

    const agentsPath = join(repoRoot, "AGENTS.md");
    assert.equal(existsSync(agentsPath), true);
    assert.match(readFileSync(agentsPath, "utf8"), /shell-injection/);

    const active = listActiveGoldenRules(configHome);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.topic, "shell-injection");

    // Já decidida — não pode ser aprovada/rejeitada de novo.
    assert.deepEqual(listPendingRules(configHome), []);
    assert.throws(() => approveRule(configHome, repoRoot, pending!.id));
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("rejectRule marca a proposta como rejeitada sem aplicar nada", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    const rule = proposeRule(configHome, "topico-x", "regra x", "acionamento manual");
    rejectRule(configHome, rule.id);

    assert.deepEqual(listPendingRules(configHome), []);
    assert.deepEqual(listActiveGoldenRules(configHome), []);
    assert.equal(existsSync(join(repoRoot, ".opencode", "rules", "golden-rules.md")), false);
    assert.throws(() => rejectRule(configHome, rule.id));
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("getLessons retorna as últimas N entradas na ordem certa", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    const dir = join(configHome, "souls", soulId);
    recordAgentIncident(configHome, soulId, { ...INCIDENT, topic: "t1", mistake: "erro 1", correctiveRule: "regra 1" });
    recordAgentIncident(configHome, soulId, { ...INCIDENT, topic: "t2", mistake: "erro 2", correctiveRule: "regra 2" });
    recordAgentIncident(configHome, soulId, { ...INCIDENT, topic: "t3", mistake: "erro 3", correctiveRule: "regra 3" });

    const lessons = getLessons(dir, 2);
    assert.equal(lessons.length, 2);
    assert.match(lessons[0]!.texto, /t2/);
    assert.match(lessons[1]!.texto, /t3/);
  } finally {
    cleanup(configHome, repoRoot);
  }
});
