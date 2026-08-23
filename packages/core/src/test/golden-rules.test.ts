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
  resendApprovalCode,
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

function extractApprovalCode(text: string | null): string | null {
  if (text === null) return null;
  const m = text.match(/Código de aprovação: (\d{6})/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Stub de `fetch` para capturar o código de aprovação enviado por
 * `notifyGuardianApproval` via Telegram (o código só existe em claro nessa
 * notificação — nunca é persistido). `fn` deve disparar exatamente uma
 * proposta/reenvio de código dentro do escopo.
 */
function withCapturedApprovalCode<T>(fn: () => T): { result: T; code: string | null } {
  const originalFetch = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.GUARDIAN_APPROVAL_CHAT_ID = "test-chat";
  let capturedText: string | null = null;
  globalThis.fetch = (async (_url: unknown, opts?: { body?: string }) => {
    try {
      const body = JSON.parse(opts?.body ?? "{}") as { text?: string };
      capturedText = body.text ?? null;
    } catch {
      capturedText = null;
    }
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    const result = fn();
    const code = extractApprovalCode(capturedText);
    return { result, code };
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.GUARDIAN_APPROVAL_CHAT_ID;
  }
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

test("proposeRule grava só o hash do código de aprovação, nunca o valor em claro", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    const { code } = withCapturedApprovalCode(() => proposeRule(configHome, "topico-hash", "regra", "motivo"));
    assert.match(code ?? "", /^\d{6}$/);

    const [pending] = listPendingRules(configHome);
    assert.equal(pending!.approvalCodeHash.length, 64); // sha256 hex
    assert.notEqual(pending!.approvalCodeHash, code);
    assert.ok(new Date(pending!.approvalCodeExpiresAt).getTime() > Date.now());
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("approveRule grava golden-rules.md/AGENTS.md e o índice ativo; marca a proposta como aprovada", () => {
  const { configHome, repoRoot, soulId } = tempSetup();
  try {
    recordAgentIncident(configHome, soulId, INCIDENT);
    recordAgentIncident(configHome, soulId, INCIDENT);
    const { code } = withCapturedApprovalCode(() => recordAgentIncident(configHome, soulId, INCIDENT));
    assert.match(code ?? "", /^\d{6}$/);
    const [pending] = listPendingRules(configHome);

    const rule = approveRule(configHome, repoRoot, pending!.id, code!);
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
    assert.throws(() => approveRule(configHome, repoRoot, pending!.id, code!));
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("approveRule com código errado lança erro e não aplica a regra", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    const { code } = withCapturedApprovalCode(() => proposeRule(configHome, "topico-y", "regra y", "motivo"));
    const [pending] = listPendingRules(configHome);
    const wrongCode = code === "111111" ? "222222" : "111111";

    assert.throws(() => approveRule(configHome, repoRoot, pending!.id, wrongCode));
    assert.equal(listActiveGoldenRules(configHome).length, 0);
    // Proposta continua pendente — código errado não decide a proposta.
    assert.equal(listPendingRules(configHome).length, 1);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("approveRule com código expirado marca a proposta como expired e não aplica nada", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    // "0" cairia no fallback `Number(env) || 24` (0 é falsy em JS); "-1" gera
    // um approvalCodeExpiresAt no passado sem depender do fallback.
    process.env.GUARDIAN_APPROVAL_TTL_HOURS = "-1";
    const { code } = withCapturedApprovalCode(() => proposeRule(configHome, "topico-z", "regra z", "motivo"));
    delete process.env.GUARDIAN_APPROVAL_TTL_HOURS;
    const [pending] = listPendingRules(configHome);

    assert.throws(() => approveRule(configHome, repoRoot, pending!.id, code!), /expirado/);
    assert.equal(listActiveGoldenRules(configHome).length, 0);
    assert.equal(listPendingRules(configHome).length, 0); // não é mais "pending", virou "expired"
  } finally {
    delete process.env.GUARDIAN_APPROVAL_TTL_HOURS;
    cleanup(configHome, repoRoot);
  }
});

test("resendApprovalCode invalida o código anterior e emite um novo", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    const { code: firstCode } = withCapturedApprovalCode(() => proposeRule(configHome, "topico-w", "regra w", "motivo"));
    const [pending] = listPendingRules(configHome);

    const { code: secondCode } = withCapturedApprovalCode(() => resendApprovalCode(configHome, pending!.id));
    assert.match(secondCode ?? "", /^\d{6}$/);

    assert.throws(() => approveRule(configHome, repoRoot, pending!.id, firstCode!));
    const rule = approveRule(configHome, repoRoot, pending!.id, secondCode!);
    assert.equal(rule.topic, "topico-w");
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("rejectRule marca a proposta como rejeitada sem aplicar nada", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    const { result, code } = withCapturedApprovalCode(() =>
      proposeRule(configHome, "topico-x", "regra x", "acionamento manual"),
    );
    const ruleId = result.rule.id;
    rejectRule(configHome, ruleId, code!);

    assert.deepEqual(listPendingRules(configHome), []);
    assert.deepEqual(listActiveGoldenRules(configHome), []);
    assert.equal(existsSync(join(repoRoot, ".opencode", "rules", "golden-rules.md")), false);
    assert.throws(() => rejectRule(configHome, ruleId, code!));
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("rejectRule exige código de aprovação válido", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    const { code } = withCapturedApprovalCode(() => proposeRule(configHome, "topico-v", "regra v", "motivo"));
    const [pending] = listPendingRules(configHome);
    const wrongCode = code === "111111" ? "222222" : "111111";

    assert.throws(() => rejectRule(configHome, pending!.id, wrongCode));
    assert.equal(listPendingRules(configHome).length, 1);
  } finally {
    cleanup(configHome, repoRoot);
  }
});

test("notifyGuardianApproval não lança mesmo sem TELEGRAM_BOT_TOKEN/GUARDIAN_APPROVAL_CHAT_ID configurados", () => {
  const { configHome, repoRoot } = tempSetup();
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.GUARDIAN_APPROVAL_CHAT_ID;
    assert.doesNotThrow(() => proposeRule(configHome, "topico-sem-telegram", "regra", "motivo"));
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
