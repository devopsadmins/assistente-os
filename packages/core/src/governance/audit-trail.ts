/**
 * Governança e Rastreabilidade do Ciclo de Vida do Agente
 * Conformidade com ISO/IEC 42001 — Sistema de Gestão de IA (SGIA)
 *
 * Responsabilidades:
 * 1. Registro de Intenção e Justificativa — objetivo da ação, ferramentas, parâmetros
 * 2. Relevance Thresholding & Guardrail — barra chamadas se similaridade < 0.70
 * 3. Registro de Métricas e Telemetria — prompt_tokens, completion_tokens, latency_ms
 *
 * Filosofia Local-First: escrita Markdown primária (sessoes/YYYY-MM-DD.md).
 * PostgreSQL é index derivado — best-effort, nunca bloqueia.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { todayISODate } from "../alma.js";
import { soulDir } from "../souls.js";
import { nowIso } from "../costs.js";
import { sanitizeText } from "../security/content-filter.js";

// ── Tipos ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  ts: string;
  sessionId: string;
  soulId: string;
  intention: string;
  toolsCalled: string[];
  params?: Record<string, unknown>;
  relevanceVerdict?: RelevanceCheck;
  metrics?: TokenMetrics;
}

export interface TokenMetrics {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  model?: string;
}

export interface RelevanceCheck {
  score: number;
  ok: boolean;
  motivo: string;
}

export interface RelevanceGuardResult {
  allowed: boolean;
  score: number;
  threshold: number;
  warning?: string;
}

// ── Configuração ───────────────────────────────────────────────────────

const DEFAULT_RELEVANCE_THRESHOLD = 0.70;

function resolveHome(): string {
  return process.env.ASSISTENTE_OS_HOME || join(require("node:os").homedir(), ".assistant-os");
}

// ── Intenção e Justificativa ───────────────────────────────────────────

/**
 * Monta o cabeçalho Markdown de uma sessão com registro de intenção.
 * Formato ISO/IEC 42001: objetivo, ferramentas, parâmetros, timestamp.
 */
export function buildSessionHeader(entry: AuditEntry): string {
  const lines = [
    `# Sessão ${entry.sessionId} — ${entry.soulId}`,
    "",
    `**Data:** ${entry.ts}`,
    `**Objetivo:** ${entry.intention}`,
    `**Ferramentas chamadas:** ${entry.toolsCalled.length > 0 ? entry.toolsCalled.map((t) => `\`${t}\``).join(", ") : "—"}`,
  ];

  if (entry.params && Object.keys(entry.params).length > 0) {
    lines.push(`**Parâmetros:** \`${sanitizeText(JSON.stringify(entry.params)).sanitized}\``);
  }

  if (entry.relevanceVerdict) {
    const v = entry.relevanceVerdict;
    lines.push(
      `**Relevância RAG:** score=${v.score.toFixed(4)} ${v.ok ? "✅" : "⚠️"} ${v.motivo}`,
    );
  }

  lines.push("", "---", "");
  return lines.join("\n");
}

/**
 * Registra a intenção de uma ação no cabeçalho da sessão Markdown.
 * Idempotente: se o cabeçalho já existir, appenda seção adicional.
 */
export function logIntention(entry: AuditEntry): string {
  const home = resolveHome();
  const dateISO = todayISODate();
  const header = buildSessionHeader(entry);

  try {
    const soulPath = soulDir(join(home, "souls"), entry.soulId);
    mkdirSync(join(soulPath, "sessoes"), { recursive: true });
    const logPath = join(soulPath, "sessoes", `${dateISO}.md`);
    if (!existsSync(logPath) || readFileSync(logPath, "utf8").length === 0) {
      appendFileSync(logPath, header, "utf8");
    } else {
      // Sessão já existe — appenda como nova seção
      const section = [
        "",
        `## ${entry.intention}`,
        `**Timestamp:** ${entry.ts}`,
        `**Ferramentas:** ${entry.toolsCalled.map((t) => `\`${t}\``).join(", ") || "—"}`,
        "",
        "---",
        "",
      ].join("\n");
      appendFileSync(logPath, section, "utf8");
    }
    return logPath;
  } catch (err) {
    console.error(`[audit-trail] Falha ao registrar intenção (non-fatal): ${(err as Error).message}`);
    return "";
  }
}

// ── Relevance Thresholding & Guardrail ─────────────────────────────────

/**
 * Verifica se o score de relevância do RAG atende ao threshold mínimo.
 * ISO/IEC 42001: barrar chamadas automáticas à LLM se contexto insuficiente.
 *
 * @param score Score semântico (0..1) do RAG híbrido
 * @param threshold Threshold mínimo (default: 0.70)
 */
export function checkRelevanceThreshold(
  score: number,
  threshold: number = DEFAULT_RELEVANCE_THRESHOLD,
): RelevanceGuardResult {
  if (score >= threshold) {
    return { allowed: true, score, threshold };
  }
  return {
    allowed: false,
    score,
    threshold,
    warning: `Relevância abaixo do threshold (${score.toFixed(4)} < ${threshold.toFixed(2)}). ` +
      `Documentação insuficiente para justificar chamada automática à LLM. ` +
      `Ação registrada para auditoria ISO/IEC 42001.`,
  };
}

/**
 * Wrapper que combina busca RAG + guardrail de relevância.
 * Retorna o guardrail result e, se allowed, os resultados da busca.
 */
export async function ragWithGuardrail(
  searchFn: () => Promise<{ score: number }[]>,
  threshold: number = DEFAULT_RELEVANCE_THRESHOLD,
): Promise<{
  allowed: boolean;
  guardrail: RelevanceGuardResult;
  results?: { score: number }[];
}> {
  try {
    const results = await searchFn();
    const maxScore = results.length > 0 ? Math.max(...results.map((r) => r.score ?? 0)) : 0;
    const guardrail = checkRelevanceThreshold(maxScore, threshold);
    return { allowed: guardrail.allowed, guardrail, results: guardrail.allowed ? results : undefined };
  } catch (err) {
    // Se a busca falhar, bloqueia por segurança
    return {
      allowed: false,
      guardrail: {
        allowed: false,
        score: 0,
        threshold,
        warning: `Falha na busca RAG: ${(err as Error).message}. Chamada bloqueada por segurança.`,
      },
    };
  }
}

// ── Métricas e Telemetria ─────────────────────────────────────────────

/**
 * Monta o bloco Markdown de telemetria para append no log de sessão.
 * Formato ISO/IEC 42001: prompt_tokens, completion_tokens, latency_ms.
 */
export function buildTelemetryBlock(metrics: TokenMetrics, operationDesc: string): string {
  return [
    "",
    `### Métricas — ${operationDesc}`,
    `- **prompt_tokens:** ${metrics.promptTokens}`,
    `- **completion_tokens:** ${metrics.completionTokens}`,
    `- **total_tokens:** ${metrics.promptTokens + metrics.completionTokens}`,
    `- **latency_ms:** ${metrics.latencyMs}`,
    metrics.model ? `- **modelo:** ${metrics.model}` : null,
    `- **ts:** ${nowIso()}`,
    "",
    "---",
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Registra métricas e telemetria no final do arquivo de sessão Markdown.
 * Filosofia Local-First: append garantido, best-effort, nunca bloqueia.
 */
export function logTelemetry(soulId: string, metrics: TokenMetrics, operationDesc: string): string {
  const home = resolveHome();
  const dateISO = todayISODate();
  const block = buildTelemetryBlock(metrics, operationDesc);

  try {
    const soulPath = soulDir(join(home, "souls"), soulId);
    mkdirSync(join(soulPath, "sessoes"), { recursive: true });
    const logPath = join(soulPath, "sessoes", `${dateISO}.md`);
    appendFileSync(logPath, block, "utf8");
    return logPath;
  } catch (err) {
    console.error(`[audit-trail] Falha ao registrar telemetria (non-fatal): ${(err as Error).message}`);
    return "";
  }
}

/**
 * Registra uma entrada completa de auditoria (intenção + métricas) em uma chamada.
 */
export function logFullAuditEntry(entry: AuditEntry): string {
  const home = resolveHome();
  const dateISO = todayISODate();

  const lines = [
    "",
    `### Auditoria — ${entry.intention}`,
    `- **ts:** ${entry.ts}`,
    `- **session:** ${entry.sessionId}`,
    `- **ferramentas:** ${entry.toolsCalled.map((t) => `\`${t}\``).join(", ") || "—"}`,
  ];

  if (entry.params) {
    lines.push(`- **params:** \`${sanitizeText(JSON.stringify(entry.params)).sanitized}\``);
  }

  if (entry.relevanceVerdict) {
    const v = entry.relevanceVerdict;
    lines.push(`- **relevância:** score=${v.score.toFixed(4)} ${v.ok ? "✅" : "⚠️"} ${v.motivo}`);
  }

  if (entry.metrics) {
    const m = entry.metrics;
    lines.push(
      `- **tokens:** prompt=${m.promptTokens} completion=${m.completionTokens} total=${m.promptTokens + m.completionTokens}`,
      `- **latência:** ${m.latencyMs}ms`,
    );
    if (m.model) lines.push(`- **modelo:** ${m.model}`);
  }

  lines.push("", "---", "");

  try {
    const soulPath = soulDir(join(home, "souls"), entry.soulId);
    mkdirSync(join(soulPath, "sessoes"), { recursive: true });
    const logPath = join(soulPath, "sessoes", `${dateISO}.md`);
    appendFileSync(logPath, lines.join("\n"), "utf8");
    return logPath;
  } catch (err) {
    console.error(`[audit-trail] Falha ao registrar auditoria completa (non-fatal): ${(err as Error).message}`);
    return "";
  }
}
