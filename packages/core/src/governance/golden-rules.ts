/**
 * Motor de Governança "Guardian" — Regras de Ouro e Autoaprendizado
 *
 * Responsabilidades:
 * 1. Registro de incidentes de agente (erro + causa raiz + regra corretiva)
 * 2. Proposta automática: 3+ reincidências do mesmo tópico viram uma proposta
 *    de regra global — mas ela só é aplicada (arquivos gravados, propagada
 *    pra todas as souls) depois de aprovação humana explícita.
 * 3. Auditoria de execução (score 0-100, aprova apenas com score >= 95)
 *
 * Filosofia Local-First: escrita em disco (JSONL/Markdown) é a autoridade
 * canônica; qualquer falha de I/O é logada e não interrompe o processo.
 *
 * Por que aprovação humana: propagar uma regra errada automaticamente pra
 * todas as souls e pro AGENTS.md sem ninguém revisar é o tipo de coisa que
 * vira ruído/cerimônia sem controle. O motor ainda detecta e agrupa padrões
 * sozinho; só a aplicação final passa por `approveRule`.
 *
 * A aprovação é tecnicamente imposta, não só convencional: `proposeRule`
 * gera um código de uso único (nunca persistido em claro) e notifica o dono
 * via Telegram; `approveRule`/`rejectRule` exigem esse código. Isso impede
 * que o próprio agente LLM — que tem acesso às mesmas tools MCP — aprove
 * suas próprias propostas sem um humano de fato ter visto o código.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { todayISODate, nowISO, registrarLicao } from "../alma.js";
import { soulDir } from "../souls.js";
import { guardianAudit } from "../prompts/garden/index.js";

const PROMOTION_THRESHOLD = 3;
const AUDIT_SCORE_THRESHOLD = 95;

// ── Tipos ──────────────────────────────────────────────────────────────

export interface AgentIncidentInput {
  agentId: string;
  topic: string;
  mistake: string;
  rootCause: string;
  correctiveRule: string;
}

interface IncidentRecord extends AgentIncidentInput {
  ts: string;
  soulId: string;
  /** já contribuiu para uma proposta de regra (evita propor duas vezes). */
  proposed: boolean;
}

export interface GoldenRule {
  topic: string;
  ruleText: string;
  reason: string;
}

export interface PendingRule extends GoldenRule {
  id: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedAt?: string;
  /** SHA-256 hex do código de aprovação (prova de revisão humana) — nunca o valor em claro. */
  approvalCodeHash: string;
  /** ISO 8601 — depois disso o código não decide mais a proposta; use resendApprovalCode. */
  approvalCodeExpiresAt: string;
}

export interface AuditExecutionInput {
  taskId: string;
  targetAgent: string;
  changesSummary: string;
  testResults?: string;
}

export interface AuditExecutionResult {
  approved: boolean;
  score: number;
  feedback: string;
}

// ── Incidentes ─────────────────────────────────────────────────────────

function incidentsPath(configHome: string): string {
  return join(configHome, "governance", "incidents.jsonl");
}

function readIncidents(configHome: string): IncidentRecord[] {
  const p = incidentsPath(configHome);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IncidentRecord);
}

function writeIncidents(configHome: string, records: IncidentRecord[]): void {
  mkdirSync(join(configHome, "governance"), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(incidentsPath(configHome), body.length > 0 ? body + "\n" : "", "utf8");
}

/**
 * Registra um incidente de agente (JSONL + `licoes.md` da soul) e reavalia
 * se algum tópico acumulou reincidências suficientes para virar proposta.
 */
export function recordAgentIncident(
  configHome: string,
  soulId: string,
  incident: AgentIncidentInput,
): { proposed: string[] } {
  const record: IncidentRecord = { ...incident, ts: nowISO(), soulId, proposed: false };

  try {
    mkdirSync(join(configHome, "governance"), { recursive: true });
    appendFileSync(incidentsPath(configHome), JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error(`[golden-rules] Falha ao registrar incidente (non-fatal): ${(err as Error).message}`);
  }

  try {
    const dir = soulDir(join(configHome, "souls"), soulId);
    registrarLicao(dir, `[${incident.topic}] ${incident.mistake} → ${incident.correctiveRule}`);
  } catch (err) {
    console.error(`[golden-rules] Falha ao registrar lição (non-fatal): ${(err as Error).message}`);
  }

  return evaluateAndPromoteRules(configHome);
}

/**
 * Agrupa incidentes ainda não propostos por tópico; cria uma proposta pendente
 * (não aplica ainda) para qualquer tópico com 3+ ocorrências. Idempotente —
 * não propõe duas vezes o mesmo lote de incidentes.
 */
export function evaluateAndPromoteRules(configHome: string): { proposed: string[] } {
  const records = readIncidents(configHome);
  const byTopic = new Map<string, IncidentRecord[]>();
  for (const r of records) {
    if (r.proposed) continue;
    const list = byTopic.get(r.topic) ?? [];
    list.push(r);
    byTopic.set(r.topic, list);
  }

  const proposed: string[] = [];
  for (const [topic, incidents] of byTopic) {
    if (incidents.length < PROMOTION_THRESHOLD) continue;
    const last = incidents[incidents.length - 1] as IncidentRecord;
    proposeRule(configHome, topic, last.correctiveRule, `${incidents.length} reincidências: ${last.mistake}`);
    proposed.push(topic);
  }

  if (proposed.length > 0) {
    const updated = records.map((r) => (proposed.includes(r.topic) ? { ...r, proposed: true } : r));
    try {
      writeIncidents(configHome, updated);
    } catch (err) {
      console.error(`[golden-rules] Falha ao marcar incidentes como propostos (non-fatal): ${(err as Error).message}`);
    }
  }

  return { proposed };
}

// ── Propostas pendentes (fila de aprovação humana) ──────────────────────

function pendingRulesPath(configHome: string): string {
  return join(configHome, "governance", "pending-rules.jsonl");
}

function readPendingRules(configHome: string): PendingRule[] {
  const p = pendingRulesPath(configHome);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PendingRule);
}

function writePendingRules(configHome: string, records: PendingRule[]): void {
  mkdirSync(join(configHome, "governance"), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(pendingRulesPath(configHome), body.length > 0 ? body + "\n" : "", "utf8");
}

function nextPendingId(): string {
  return `gr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Código de aprovação (prova técnica de revisão humana) ───────────────
//
// approveRule/rejectRule não confiam mais só em "quem chamou a tool" — o
// próprio agente LLM tem acesso às mesmas tools MCP que um humano, então
// allowlist por soul não impede autoaprovação. O código de 6 dígitos é
// gerado aqui, nunca persistido em claro (só o hash), e só chega em claro a
// quem recebe a notificação do Guardian (Telegram) ou consulta via CLI/
// resendApprovalCode. Sem o código certo, approveRule/rejectRule falham.

function generateApprovalCode(): string {
  return String(randomInt(100000, 1000000));
}

function hashApprovalCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function verifyApprovalCode(code: string, storedHash: string): boolean {
  const a = Buffer.from(hashApprovalCode(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Validade do código de aprovação, em horas (env GUARDIAN_APPROVAL_TTL_HOURS, default 24). Lida a cada chamada, não em import — permite configurar/testar sem reiniciar o processo. */
function approvalCodeTtlHours(): number {
  return Number(process.env.GUARDIAN_APPROVAL_TTL_HOURS) || 24;
}

function approvalCodeExpiresAt(): string {
  return new Date(Date.now() + approvalCodeTtlHours() * 60 * 60 * 1000).toISOString();
}

/**
 * Notifica o dono do sistema via Telegram com o código de aprovação em claro
 * — único lugar (fora da memória do processo) onde o valor puro existe.
 * Best-effort/non-fatal: sem TELEGRAM_BOT_TOKEN/GUARDIAN_APPROVAL_CHAT_ID
 * configurados, ou em falha de rede, a proposta continua consultável via
 * guardian_pending_rules/`os guardian pending`, e resendApprovalCode gera
 * um código novo a qualquer momento.
 */
async function notifyGuardianApproval(rule: PendingRule, code: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.GUARDIAN_APPROVAL_CHAT_ID;
  if (!token || !chatId) {
    console.error(
      "[golden-rules] Notificação de aprovação pulada (non-fatal): TELEGRAM_BOT_TOKEN/GUARDIAN_APPROVAL_CHAT_ID não configurados.",
    );
    return;
  }

  const text = [
    "🛡️ Guardian — proposta de regra de ouro aguardando aprovação",
    `Tópico: ${rule.topic}`,
    `Regra: ${rule.ruleText}`,
    `Motivo: ${rule.reason}`,
    `ID: ${rule.id}`,
    `Código de aprovação: ${code}`,
    `Válido até: ${rule.approvalCodeExpiresAt}`,
    "",
    `Aprove com: os guardian approve ${rule.id} ${code}`,
  ].join("\n");

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      console.error(`[golden-rules] Falha ao notificar aprovação via Telegram (non-fatal): HTTP ${resp.status}`);
    }
  } catch (err) {
    console.error(`[golden-rules] Falha ao notificar aprovação via Telegram (non-fatal): ${(err as Error).message}`);
  }
}

/**
 * Cria uma proposta de regra pendente de aprovação — seja pelo motor
 * automático (3+ reincidências) ou por acionamento manual do Guardian.
 * Gera e envia (best-effort) um código de aprovação de uso único; o valor
 * em claro é devolvido aqui e nunca mais persistido — quem chama precisa
 * repassá-lo por um canal que o agente LLM não controla (ex.: não incluir
 * no retorno de uma tool MCP consumida pelo próprio agente).
 */
export function proposeRule(
  configHome: string,
  topic: string,
  ruleText: string,
  reason: string,
): { rule: PendingRule; code: string } {
  const pending = readPendingRules(configHome);
  const code = generateApprovalCode();
  const rule: PendingRule = {
    id: nextPendingId(),
    topic,
    ruleText,
    reason,
    createdAt: nowISO(),
    status: "pending",
    approvalCodeHash: hashApprovalCode(code),
    approvalCodeExpiresAt: approvalCodeExpiresAt(),
  };
  pending.push(rule);
  writePendingRules(configHome, pending);
  void notifyGuardianApproval(rule, code).catch((err) => {
    console.error(`[golden-rules] notifyGuardianApproval falhou (non-fatal): ${(err as Error).message}`);
  });
  return { rule, code };
}

/** Lista propostas aguardando aprovação (ou rejeição) humana. */
export function listPendingRules(configHome: string): PendingRule[] {
  return readPendingRules(configHome).filter((r) => r.status === "pending");
}

/**
 * Gera um novo código de aprovação para uma proposta pendente (invalida o
 * anterior) e reenvia a notificação — usado quando a notificação original
 * falhou ou o código expirou.
 */
export function resendApprovalCode(configHome: string, id: string): { code: string } {
  const pending = readPendingRules(configHome);
  const rule = pending.find((r) => r.id === id && r.status === "pending");
  if (!rule) throw new Error(`proposta de regra não encontrada ou já decidida: ${id}`);

  const code = generateApprovalCode();
  const updatedRule: PendingRule = {
    ...rule,
    approvalCodeHash: hashApprovalCode(code),
    approvalCodeExpiresAt: approvalCodeExpiresAt(),
  };
  const updated = pending.map((r) => (r.id === id ? updatedRule : r));
  writePendingRules(configHome, updated);
  void notifyGuardianApproval(updatedRule, code).catch((err) => {
    console.error(`[golden-rules] notifyGuardianApproval falhou (non-fatal): ${(err as Error).message}`);
  });
  return { code };
}

function checkApprovalCode(configHome: string, pending: PendingRule[], rule: PendingRule, code: string): void {
  if (new Date(rule.approvalCodeExpiresAt).getTime() < Date.now()) {
    const expired = pending.map((r) => (r.id === rule.id ? { ...r, status: "expired" as const, decidedAt: nowISO() } : r));
    writePendingRules(configHome, expired);
    throw new Error(`código de aprovação expirado para a proposta ${rule.id}; use guardian_resend_approval_code`);
  }
  if (!verifyApprovalCode(code, rule.approvalCodeHash)) {
    throw new Error("código de aprovação inválido");
  }
}

/**
 * Aprova uma proposta: exige o código de aprovação (prova de revisão humana),
 * grava a regra global (arquivos + índice ativo) e marca a proposta como decidida.
 */
export function approveRule(configHome: string, repoRoot: string, id: string, code: string): GoldenRule {
  const pending = readPendingRules(configHome);
  const rule = pending.find((r) => r.id === id && r.status === "pending");
  if (!rule) throw new Error(`proposta de regra não encontrada ou já decidida: ${id}`);
  checkApprovalCode(configHome, pending, rule, code);

  const golden: GoldenRule = { topic: rule.topic, ruleText: rule.ruleText, reason: rule.reason };
  enforceGlobalRules(configHome, repoRoot, golden);

  const updated = pending.map((r) => (r.id === id ? { ...r, status: "approved" as const, decidedAt: nowISO() } : r));
  writePendingRules(configHome, updated);
  return golden;
}

/** Rejeita uma proposta: exige o código de aprovação, marca como decidida sem gravar/propagar nada. */
export function rejectRule(configHome: string, id: string, code: string): void {
  const pending = readPendingRules(configHome);
  const rule = pending.find((r) => r.id === id && r.status === "pending");
  if (!rule) throw new Error(`proposta de regra não encontrada ou já decidida: ${id}`);
  checkApprovalCode(configHome, pending, rule, code);

  const updated = pending.map((r) => (r.id === id ? { ...r, status: "rejected" as const, decidedAt: nowISO() } : r));
  writePendingRules(configHome, updated);
}

// ── Regras globais ativas (aprovadas) ───────────────────────────────────

function activeRulesPath(configHome: string): string {
  return join(configHome, "governance", "golden-rules.jsonl");
}

/** Lista as regras de ouro já aprovadas e em vigor. */
export function listActiveGoldenRules(configHome: string): GoldenRule[] {
  const p = activeRulesPath(configHome);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GoldenRule);
}

/**
 * Aplica uma regra aprovada: grava no índice ativo (`governance/golden-rules.jsonl`,
 * consumido pelo buildPrompt) e propaga em `.opencode/rules/golden-rules.md` +
 * `AGENTS.md` (consumidos pelo OpenCode/agentes de código).
 */
function enforceGlobalRules(configHome: string, repoRoot: string, rule: GoldenRule): void {
  try {
    mkdirSync(join(configHome, "governance"), { recursive: true });
    appendFileSync(activeRulesPath(configHome), JSON.stringify(rule) + "\n", "utf8");
  } catch (err) {
    console.error(`[golden-rules] Falha ao gravar golden-rules.jsonl (non-fatal): ${(err as Error).message}`);
  }

  try {
    const rulesDir = join(repoRoot, ".opencode", "rules");
    mkdirSync(rulesDir, { recursive: true });
    const rulesPath = join(rulesDir, "golden-rules.md");
    if (!existsSync(rulesPath)) {
      writeFileSync(rulesPath, "# Golden Rules\n\nRegras aprovadas pelo usuário após proposta do motor de governança.\n\n", "utf8");
    }
    appendFileSync(
      rulesPath,
      `## ${rule.topic}\n- **Regra:** ${rule.ruleText}\n- **Motivo:** ${rule.reason}\n- **Aprovada em:** ${todayISODate()}\n\n`,
      "utf8",
    );
  } catch (err) {
    console.error(`[golden-rules] Falha ao gravar golden-rules.md (non-fatal): ${(err as Error).message}`);
  }

  try {
    const agentsPath = join(repoRoot, "AGENTS.md");
    const marker = "## Golden Rules (aprovadas)";
    let content = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
    if (!content.includes(marker)) {
      content =
        content.replace(/\s*$/, "\n") +
        `\n${marker}\n\nRegras aprovadas pelo usuário após proposta do motor de governança (golden-rules.ts).\n`;
    }
    content += `\n- **${rule.topic}:** ${rule.ruleText} _(${rule.reason})_\n`;
    writeFileSync(agentsPath, content, "utf8");
  } catch (err) {
    console.error(`[golden-rules] Falha ao gravar AGENTS.md (non-fatal): ${(err as Error).message}`);
  }
}

// ── Lições ─────────────────────────────────────────────────────────────

/** Lê e faz parse de `licoes.md` (formato `- [YYYY-MM-DD] texto`); retorna as últimas `limit`. */
export function getLessons(dir: string, limit = 20): { dateISO: string; texto: string }[] {
  const p = join(dir, "licoes.md");
  if (!existsSync(p)) return [];

  const parsed: { dateISO: string; texto: string }[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
    if (m) parsed.push({ dateISO: m[1] as string, texto: m[2] as string });
  }
  return parsed.slice(-limit);
}

// ── Auditoria (Guardian) ───────────────────────────────────────────────

/**
 * Julga uma execução de agente via LLM (0-100). Aprova apenas com score >= 95.
 * Falha segura: se o Guardian estiver indisponível, não aprova por omissão.
 */
export async function auditExecution(input: AuditExecutionInput): Promise<AuditExecutionResult> {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const chatModel = process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free";

  const prompt = guardianAudit.render({
    taskId: input.taskId,
    targetAgent: input.targetAgent,
    changesSummary: input.changesSummary,
    testResultsLine: input.testResults ? `Resultado dos testes: ${input.testResults}\n` : "",
  });

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 30000);

  try {
    const resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chatModel, messages: [{ role: "user", content: prompt }], stream: false }),
      signal: ac.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { approved: false, score: 0, feedback: "Guardian indisponível (Ollama respondeu erro) — revisão manual necessária." };
    }

    const data = (await resp.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(data.message?.content || "{}") as { score?: number; feedback?: string };
    const score = Number(parsed.score) || 0;
    return { approved: score >= AUDIT_SCORE_THRESHOLD, score, feedback: String(parsed.feedback || "") };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      approved: false,
      score: 0,
      feedback: `Guardian indisponível (${(err as Error).message}) — revisão manual necessária.`,
    };
  }
}
