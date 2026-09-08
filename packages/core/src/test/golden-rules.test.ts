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
  auditExecution,
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

// ── auditExecution (SPEC-GR4 — usado pelo `os discriminator` no CI) ────────

/**
 * `loadConfig({})` sem override de `home` lê o `.env` real da máquina — se
 * ela já tiver ZEN_API_KEY[S]/OPENROUTER_API_KEY configurada (normal numa
 * máquina de dev), "sem provider cloud" deixaria de ser verdade dentro do
 * teste. Isola as 9 variáveis Zen possíveis (lista + numeradas 1-7 + única)
 * + as 3 do OpenRouter (resolveCloudProvider prefere OpenRouter sobre Zen —
 * precisa estar isolada também, senão "com ZEN_API_KEY" deixaria de bater
 * no Zen se a máquina tiver OPENROUTER_API_KEY configurada) e restaura no
 * finally.
 */
const ZEN_ENV_VARS = [
  "ZEN_API_KEYS",
  "ZEN_API_KEY",
  ...Array.from({ length: 7 }, (_, i) => `ZEN_API_KEY_${i + 1}`),
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_CHAT_MODEL",
];
function withZenEnv<T>(vars: Record<string, string> | null, fn: () => T): T {
  const saved = new Map(ZEN_ENV_VARS.map((k) => [k, process.env[k]]));
  // String vazia, não delete: loadConfig -> loadDotEnv só define a var se
  // `undefined` — um delete seria recarregado do .env real da máquina no
  // meio do teste. String vazia sobrevive porque já está "definida".
  for (const k of ZEN_ENV_VARS) process.env[k] = "";
  if (vars) Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("auditExecution: sem ZEN_API_KEY, chama Ollama (/api/chat) e aprova score >= 95", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = (async (url: unknown) => {
    calledUrl = String(url);
    return {
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ score: 97, feedback: "ok" }) } }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await withZenEnv(null, () =>
      auditExecution({ taskId: "t1", targetAgent: "agent-x", changesSummary: "diff pequeno" }),
    );
    assert.match(calledUrl, /\/api\/chat$/, "deve chamar o endpoint específico do Ollama sem ZEN_API_KEY");
    assert.equal(result.approved, true);
    assert.equal(result.score, 97);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auditExecution: score < 95 não aprova, mesmo com resposta válida", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ score: 80, feedback: "faltou teste" }) } }),
    }) as Response) as typeof fetch;
  try {
    const result = await withZenEnv(null, () =>
      auditExecution({ taskId: "t1", targetAgent: "agent-x", changesSummary: "diff" }),
    );
    assert.equal(result.approved, false);
    assert.equal(result.score, 80);
    assert.equal(result.feedback, "faltou teste");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auditExecution: com ZEN_API_KEY configurada, chama Zen (/chat/completions, formato OpenAI) em vez de Ollama", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let sentAuth = "";
  globalThis.fetch = (async (url: unknown, opts?: { headers?: Record<string, string> }) => {
    calledUrl = String(url);
    sentAuth = opts?.headers?.Authorization ?? "";
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ score: 96, feedback: "bom" }) } }] }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await withZenEnv({ ZEN_API_KEY: "test-zen-key" }, () =>
      auditExecution({ taskId: "t1", targetAgent: "agent-x", changesSummary: "diff" }),
    );
    assert.match(calledUrl, /\/chat\/completions$/, "com ZEN_API_KEY deve chamar o endpoint OpenAI-compatible do Zen, não o do Ollama");
    assert.equal(sentAuth, "Bearer test-zen-key");
    assert.equal(result.approved, true);
    assert.equal(result.score, 96);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auditExecution: HTTP de erro do provider não aprova por omissão (falha segura)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as typeof fetch;
  try {
    const result = await withZenEnv(null, () =>
      auditExecution({ taskId: "t1", targetAgent: "agent-x", changesSummary: "diff" }),
    );
    assert.equal(result.approved, false);
    assert.equal(result.score, 0);
    assert.match(result.feedback, /indisponível/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
