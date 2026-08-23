/**
 * Gerador de AIIA.md — Avaliação de Impacto Algorítmico por soul.
 *
 * Compõe um relatório em Markdown a partir de dados JÁ existentes no sistema
 * (capabilities, guardrails, dados pessoais/LGPD, regras de ouro ativas,
 * volume aproximado de decisões auditadas) — não introduz nenhuma fonte de
 * dado nova. Gravado em souls/<id>/AIIA.md, idempotente (sempre sobrescreve
 * — não é um histórico, reflete o estado atual no momento da geração).
 *
 * Função pura de leitura local: `generateAiiaReport` não abre conexão com
 * Postgres. Quem tem o Pool (a tool MCP `soul_generate_aiia`) resolve
 * `familia` via `buscarFamiliaPorSoulId` antes de chamar, se aplicável.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSoul, soulDir, soulsDir } from "../souls.js";
import {
  resolveAllowedTools,
  resolveConnectors,
  resolveAutonomy,
  resolveApprovalPolicy,
  resolveEffectiveGuardrails,
  DEFAULT_GLOBAL_GUARDRAILS,
  type Autonomy,
  type GlobalGuardrails,
  type AgentGuardrails,
} from "../types/agent.js";
import { capabilityRiskLevel } from "../policy.js";
import { listActiveGoldenRules, type GoldenRule } from "./golden-rules.js";
import type { Familia } from "../familias.js";

export interface AiiaPersonalData {
  isFamiliaSoul: boolean;
  baseLegal?: string;
  baseLegalSensivel?: string;
  finalidade?: string;
  status?: string;
  retencaoAte?: string | null;
}

export interface AiiaAutomatedDecisionsSummary {
  sessionFilesScanned: number;
  /** Contagem aproximada (regex sobre `sessoes/*.md`) — não é fonte de verdade auditável. */
  approxAuditedActions: number;
}

export interface AiiaReport {
  soulId: string;
  generatedAt: string;
  capabilities: {
    allowedToolPatterns: string[];
    connectors: string[];
    autonomy: Autonomy;
    approvalPolicy: string[];
    l3Capabilities: string[];
  };
  guardrails: Required<Pick<AgentGuardrails, "maxTurns" | "maxIterations" | "ragRelevanceThreshold">> & AgentGuardrails;
  personalData: AiiaPersonalData;
  goldenRulesApplicable: GoldenRule[];
  automatedDecisionsSummary: AiiaAutomatedDecisionsSummary;
}

export interface GenerateAiiaOptions {
  /** Registro de família (LGPD), se esta soul for do tipo familia_<telefone>. Resolvido pelo chamador (precisa de Pool). */
  familia?: Familia | null;
  /** Piso global de guardrails; default DEFAULT_GLOBAL_GUARDRAILS se o chamador não tiver a config carregada. */
  globalGuardrails?: GlobalGuardrails;
}

/** Conta ocorrências de `### Auditoria — ` (marcador gravado por logFullAuditEntry) em souls/<id>/sessoes/*.md. */
function countApproxAuditedActions(soulDirPath: string): AiiaAutomatedDecisionsSummary {
  const sessionsDir = join(soulDirPath, "sessoes");
  if (!existsSync(sessionsDir)) return { sessionFilesScanned: 0, approxAuditedActions: 0 };

  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".md"));
  let approxAuditedActions = 0;
  for (const f of files) {
    const content = readFileSync(join(sessionsDir, f), "utf8");
    const matches = content.match(/^### Auditoria — /gm);
    approxAuditedActions += matches ? matches.length : 0;
  }
  return { sessionFilesScanned: files.length, approxAuditedActions };
}

/** Cruza os patterns de tools permitidos da soul com o catálogo L1/L2/L3 e devolve os de nível L3. */
function resolveL3Capabilities(allowedToolPatterns: string[]): string[] {
  const l3: string[] = [];
  for (const pattern of allowedToolPatterns) {
    if (pattern === "*") {
      l3.push("* (acesso irrestrito a todas as tools — equivalente a L3 em tudo)");
      continue;
    }
    if (capabilityRiskLevel(pattern) === "L3") l3.push(pattern);
  }
  return l3;
}

export function generateAiiaReport(configHome: string, soulId: string, opts?: GenerateAiiaOptions): AiiaReport {
  const soul = getSoul(configHome, soulId);
  if (!soul) throw new Error(`soul não encontrada: ${soulId}`);

  const agentConfig = soul.config.agent;
  const allowedToolPatterns = resolveAllowedTools(agentConfig);
  const global = opts?.globalGuardrails ?? DEFAULT_GLOBAL_GUARDRAILS;
  const familia = opts?.familia;

  return {
    soulId,
    generatedAt: new Date().toISOString(),
    capabilities: {
      allowedToolPatterns,
      connectors: resolveConnectors(agentConfig),
      autonomy: resolveAutonomy(agentConfig),
      approvalPolicy: resolveApprovalPolicy(agentConfig),
      l3Capabilities: resolveL3Capabilities(allowedToolPatterns),
    },
    guardrails: resolveEffectiveGuardrails(global, agentConfig),
    personalData: familia
      ? {
          isFamiliaSoul: true,
          baseLegal: familia.baseLegal,
          baseLegalSensivel: familia.baseLegalSensivel,
          finalidade: familia.finalidade,
          status: familia.status,
          retencaoAte: familia.retencaoAte,
        }
      : { isFamiliaSoul: false },
    goldenRulesApplicable: listActiveGoldenRules(configHome),
    automatedDecisionsSummary: countApproxAuditedActions(soul.dir),
  };
}

function renderAiiaMarkdown(report: AiiaReport): string {
  const lines: string[] = [
    "# AIIA — Avaliação de Impacto Algorítmico",
    "",
    `> Gerado automaticamente em ${report.generatedAt}. Regravável e idempotente — reflete o estado atual, não um histórico. Rode \`soul_generate_aiia\` de novo após mudar capabilities, guardrails ou dados pessoais.`,
    "",
    "## Identificação",
    `- **Soul:** ${report.soulId}`,
    "",
    "## Capacidades e Conectores",
    `- **Tools permitidas:** ${report.capabilities.allowedToolPatterns.join(", ") || "—"}`,
    `- **Conectores externos:** ${report.capabilities.connectors.join(", ") || "—"}`,
    `- **Autonomia:** ${report.capabilities.autonomy}`,
    `- **Política de aprovação adicional:** ${report.capabilities.approvalPolicy.join(", ") || "—"}`,
    `- **Capabilities de alto risco (L3):** ${report.capabilities.l3Capabilities.join(", ") || "nenhuma"}`,
    "",
    "## Guardrails Efetivos",
    `- **Máximo de turnos por sessão:** ${report.guardrails.maxTurns}`,
    `- **Máximo de iterações agentic:** ${report.guardrails.maxIterations}`,
    `- **Threshold de relevância RAG:** ${report.guardrails.ragRelevanceThreshold}`,
    ...(report.guardrails.dailyLimitTokens !== undefined
      ? [`- **Teto diário de tokens:** ${report.guardrails.dailyLimitTokens}`]
      : []),
    "",
    "## Dados Pessoais e Base Legal",
    ...(report.personalData.isFamiliaSoul
      ? [
          "- Esta soul trata dados pessoais de uma família (LGPD).",
          `- **Base legal:** ${report.personalData.baseLegal ?? "—"}`,
          `- **Base legal (dados sensíveis):** ${report.personalData.baseLegalSensivel ?? "—"}`,
          `- **Finalidade:** ${report.personalData.finalidade ?? "—"}`,
          `- **Status:** ${report.personalData.status ?? "—"}`,
          `- **Retenção até:** ${report.personalData.retencaoAte ?? "sem prazo definido (ativa)"}`,
        ]
      : ["- Nenhum registro de dados pessoais de terceiros associado a esta soul foi encontrado."]),
    "",
    "## Regras de Ouro Aplicáveis",
    ...(report.goldenRulesApplicable.length === 0
      ? ["- Nenhuma regra de ouro aprovada ainda."]
      : report.goldenRulesApplicable.map((rule) => `- **${rule.topic}:** ${rule.ruleText} _(${rule.reason})_`)),
    "",
    "## Resumo de Decisões Automatizadas",
    `- Arquivos de sessão analisados: ${report.automatedDecisionsSummary.sessionFilesScanned}`,
    `- Ações auditadas (contagem aproximada): ${report.automatedDecisionsSummary.approxAuditedActions}`,
    "- _Contagem aproximada, baseada em `sessoes/*.md`; consulte os arquivos originais para o registro completo._",
    "",
  ];
  return lines.join("\n");
}

/** Grava o AIIA.md da soul — sobrescreve sempre (idempotente), sem merge manual. Retorna o caminho gravado. */
export function writeAiiaReport(configHome: string, soulId: string, report: AiiaReport): string {
  const dir = soulDir(soulsDir(configHome), soulId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "AIIA.md");
  writeFileSync(path, renderAiiaMarkdown(report), "utf8");
  return path;
}

/** Gera e grava o AIIA.md da soul em um único passo. Retorna o caminho gravado. */
export function generateAndWriteAiia(configHome: string, soulId: string, opts?: GenerateAiiaOptions): string {
  const report = generateAiiaReport(configHome, soulId, opts);
  return writeAiiaReport(configHome, soulId, report);
}
