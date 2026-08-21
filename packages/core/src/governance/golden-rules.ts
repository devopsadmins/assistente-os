/**
 * Motor de Governança "Guardian" — Regras de Ouro e Autoaprendizado
 *
 * Responsabilidades:
 * 1. Registro de incidentes de agente (erro + causa raiz + regra corretiva)
 * 2. Promoção automática: 3+ reincidências do mesmo tópico viram regra global
 * 3. Auditoria de execução (score 0-100, aprova apenas com score >= 95)
 *
 * Filosofia Local-First: escrita em disco (JSONL/Markdown) é a autoridade
 * canônica; qualquer falha de I/O é logada e não interrompe o processo.
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
  promoted: boolean;
}

export interface GoldenRule {
  topic: string;
  ruleText: string;
  reason: string;
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
 * a promoção de regras globais para o tópico afetado.
 */
export function recordAgentIncident(
  configHome: string,
  repoRoot: string,
  soulId: string,
  incident: AgentIncidentInput,
): { promoted: string[] } {
  const record: IncidentRecord = { ...incident, ts: nowISO(), soulId, promoted: false };

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

  return evaluateAndPromoteRules(configHome, repoRoot);
}

/**
 * Agrupa incidentes ainda não promovidos por tópico; promove (regra global)
 * qualquer tópico com 3+ ocorrências. Idempotente — não promove duas vezes.
 */
export function evaluateAndPromoteRules(configHome: string, repoRoot: string): { promoted: string[] } {
  const records = readIncidents(configHome);
  const byTopic = new Map<string, IncidentRecord[]>();
  for (const r of records) {
    if (r.promoted) continue;
    const list = byTopic.get(r.topic) ?? [];
    list.push(r);
    byTopic.set(r.topic, list);
  }

  const promoted: string[] = [];
  for (const [topic, incidents] of byTopic) {
    if (incidents.length < PROMOTION_THRESHOLD) continue;
    const last = incidents[incidents.length - 1] as IncidentRecord;
    enforceGlobalRules(repoRoot, {
      topic,
      ruleText: last.correctiveRule,
      reason: `${incidents.length} reincidências: ${last.mistake}`,
    });
    promoted.push(topic);
  }

  if (promoted.length > 0) {
    const updated = records.map((r) => (promoted.includes(r.topic) ? { ...r, promoted: true } : r));
    try {
      writeIncidents(configHome, updated);
    } catch (err) {
      console.error(`[golden-rules] Falha ao marcar incidentes como promovidos (non-fatal): ${(err as Error).message}`);
    }
  }

  return { promoted };
}

// ── Regras globais ─────────────────────────────────────────────────────

/** Grava uma regra promovida em `.opencode/rules/golden-rules.md` e `AGENTS.md`. */
export function enforceGlobalRules(repoRoot: string, rule: GoldenRule): void {
  try {
    const rulesDir = join(repoRoot, ".opencode", "rules");
    mkdirSync(rulesDir, { recursive: true });
    const rulesPath = join(rulesDir, "golden-rules.md");
    if (!existsSync(rulesPath)) {
      writeFileSync(rulesPath, "# Golden Rules\n\nRegras promovidas automaticamente após 3+ reincidências.\n\n", "utf8");
    }
    appendFileSync(
      rulesPath,
      `## ${rule.topic}\n- **Regra:** ${rule.ruleText}\n- **Motivo:** ${rule.reason}\n- **Promovida em:** ${todayISODate()}\n\n`,
      "utf8",
    );
  } catch (err) {
    console.error(`[golden-rules] Falha ao gravar golden-rules.md (non-fatal): ${(err as Error).message}`);
  }

  try {
    const agentsPath = join(repoRoot, "AGENTS.md");
    const marker = "## Golden Rules (auto)";
    let content = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
    if (!content.includes(marker)) {
      content =
        content.replace(/\s*$/, "\n") +
        `\n${marker}\n\nRegras promovidas automaticamente pelo motor de governança (golden-rules.ts) após 3+ reincidências.\n`;
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
