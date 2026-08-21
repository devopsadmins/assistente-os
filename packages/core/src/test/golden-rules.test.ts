import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAgentIncident, evaluateAndPromoteRules, getLessons } from "../governance/golden-rules.js";

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
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    const licoes = readFileSync(join(configHome, "souls", soulId, "licoes.md"), "utf8");
    assert.match(licoes, /shell-injection/);
    assert.match(licoes, /usou shell=True em subprocess/);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("1º e 2º incidente do mesmo tópico não promovem regra global", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    const result = recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    assert.deepEqual(result.promoted, []);
    assert.equal(existsSync(join(repoRoot, ".opencode", "rules", "golden-rules.md")), false);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("3º incidente do mesmo tópico promove regra global (golden-rules.md + AGENTS.md)", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    const result = recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);

    assert.deepEqual(result.promoted, ["shell-injection"]);

    const rulesPath = join(repoRoot, ".opencode", "rules", "golden-rules.md");
    assert.equal(existsSync(rulesPath), true);
    const rulesContent = readFileSync(rulesPath, "utf8");
    assert.match(rulesContent, /## shell-injection/);
    assert.match(rulesContent, /nunca usar shell=True/);

    const agentsPath = join(repoRoot, "AGENTS.md");
    assert.equal(existsSync(agentsPath), true);
    const agentsContent = readFileSync(agentsPath, "utf8");
    assert.match(agentsContent, /## Golden Rules \(auto\)/);
    assert.match(agentsContent, /shell-injection/);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("evaluateAndPromoteRules não duplica promoção já feita (idempotente)", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);
    recordAgentIncident(configHome, repoRoot, soulId, INCIDENT);

    const rulesPath = join(repoRoot, ".opencode", "rules", "golden-rules.md");
    const before = readFileSync(rulesPath, "utf8");

    const second = evaluateAndPromoteRules(configHome, repoRoot);
    assert.deepEqual(second.promoted, []);
    assert.equal(readFileSync(rulesPath, "utf8"), before);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("getLessons retorna as últimas N entradas na ordem certa", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    const dir = join(configHome, "souls", soulId);
    recordAgentIncident(configHome, repoRoot, soulId, { ...INCIDENT, topic: "t1", mistake: "erro 1", correctiveRule: "regra 1" });
    recordAgentIncident(configHome, repoRoot, soulId, { ...INCIDENT, topic: "t2", mistake: "erro 2", correctiveRule: "regra 2" });
    recordAgentIncident(configHome, repoRoot, soulId, { ...INCIDENT, topic: "t3", mistake: "erro 3", correctiveRule: "regra 3" });

    const lessons = getLessons(dir, 2);
    assert.equal(lessons.length, 2);
    assert.match(lessons[0]!.texto, /t2/);
    assert.match(lessons[1]!.texto, /t3/);
  } finally {
    cleanup(configHome, repoRoot);
  }
});
