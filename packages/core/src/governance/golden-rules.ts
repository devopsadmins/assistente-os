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
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { todayISODate, nowISO, registrarLicao } from "../alma.js";
import { soulDir } from "../souls.js";

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
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
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

/**
 * Cria uma proposta de regra pendente de aprovação — seja pelo motor
 * automático (3+ reincidências) ou por acionamento manual do Guardian.
 */
export function proposeRule(configHome: string, topic: string, ruleText: string, reason: string): PendingRule {
  const pending = readPendingRules(configHome);
  const rule: PendingRule = { id: nextPendingId(), topic, ruleText, reason, createdAt: nowISO(), status: "pending" };
  pending.push(rule);
  writePendingRules(configHome, pending);
  return rule;
}

/** Lista propostas aguardando aprovação (ou rejeição) humana. */
export function listPendingRules(configHome: string): PendingRule[] {
  return readPendingRules(configHome).filter((r) => r.status === "pending");
}

/** Aprova uma proposta: grava a regra global (arquivos + índice ativo) e marca a proposta como decidida. */
export function approveRule(configHome: string, repoRoot: string, id: string): GoldenRule {
  const pending = readPendingRules(configHome);
  const rule = pending.find((r) => r.id === id && r.status === "pending");
  if (!rule) throw new Error(`proposta de regra não encontrada ou já decidida: ${id}`);

  const golden: GoldenRule = { topic: rule.topic, ruleText: rule.ruleText, reason: rule.reason };
  enforceGlobalRules(configHome, repoRoot, golden);

  const updated = pending.map((r) => (r.id === id ? { ...r, status: "approved" as const, decidedAt: nowISO() } : r));
  writePendingRules(configHome, updated);
  return golden;
}

/** Rejeita uma proposta: marca como decidida sem gravar/propagar nada. */
export function rejectRule(configHome: string, id: string): void {
  const pending = readPendingRules(configHome);
  const rule = pending.find((r) => r.id === id && r.status === "pending");
  if (!rule) throw new Error(`proposta de regra não encontrada ou já decidida: ${id}`);

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

  const prompt = [
    "Você é o Guardian, supervisor de qualidade e conformidade ISO/IEC 42001.",
    `Tarefa: ${input.taskId}`,
    `Agente avaliado: ${input.targetAgent}`,
    `Resumo das mudanças: ${input.changesSummary}`,
    input.testResults ? `Resultado dos testes: ${input.testResults}` : "",
    "",
    'Avalie a qualidade de 0 a 100 e responda apenas em JSON: {"score": number, "feedback": string}.',
  ]
    .filter(Boolean)
    .join("\n");

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
