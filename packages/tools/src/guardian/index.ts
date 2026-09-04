import {
  auditExecution,
  proposeRule,
  listPendingRules,
  approveRule,
  rejectRule,
  resendApprovalCode,
  listActiveGoldenRules,
  type PendingRule,
} from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

/** Nunca expõe approvalCodeHash pro agente — o código só existe em claro na notificação Telegram. */
function pendingRuleForAgent<T extends { approvalCodeHash: string }>(rule: T): Omit<T, "approvalCodeHash"> {
  const { approvalCodeHash, ...rest } = rule;
  return rest;
}

export const GUARDIAN_TOOLS: Tool[] = [
  {
    name: "guardian_audit_execution",
    description: "Julga a qualidade de uma execução de agente via LLM (score 0-100, ISO/IEC 42001); aprova apenas com score >= 95.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "id da tarefa avaliada" },
        targetAgent: { type: "string", description: "id/nome do agente avaliado" },
        changesSummary: { type: "string", description: "resumo das mudanças feitas" },
        testResults: { type: "string", description: "resultado dos testes (opcional)" },
      },
      required: ["taskId", "targetAgent", "changesSummary"],
    },
  },
  {
    name: "guardian_promote_golden_rule",
    description: "Propõe manualmente uma regra de ouro (fora do gatilho automático de 3 reincidências). A proposta fica pendente em guardian_pending_rules até ser aprovada com guardian_approve_rule — nada é aplicado automaticamente.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "tópico normalizado da regra" },
        ruleText: { type: "string", description: "texto da regra proposta" },
        reason: { type: "string", description: "motivo/justificativa da proposta" },
      },
      required: ["topic", "ruleText", "reason"],
    },
  },
  {
    name: "guardian_pending_rules",
    description: "Lista propostas de regra de ouro aguardando aprovação ou rejeição humana.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guardian_approve_rule",
    description: "Aprova uma proposta pendente: grava a regra em .opencode/rules/golden-rules.md, AGENTS.md e no índice ativo consumido pelo prompt de todas as souls. Exige o código de aprovação enviado por Telegram (não é devolvido por guardian_promote_golden_rule/guardian_pending_rules) — prova de revisão humana, não pode ser satisfeito pelo próprio agente.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da proposta pendente (ver guardian_pending_rules)" },
        code: { type: "string", description: "código de aprovação de 6 dígitos enviado por Telegram/CLI" },
      },
      required: ["id", "code"],
    },
  },
  {
    name: "guardian_reject_rule",
    description: "Rejeita uma proposta pendente: marca como decidida sem aplicar nem propagar nada. Exige o mesmo código de aprovação de guardian_approve_rule.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da proposta pendente (ver guardian_pending_rules)" },
        code: { type: "string", description: "código de aprovação de 6 dígitos enviado por Telegram/CLI" },
      },
      required: ["id", "code"],
    },
  },
  {
    name: "guardian_resend_approval_code",
    description: "Gera um novo código de aprovação para uma proposta pendente (invalida o anterior) e reenvia a notificação por Telegram — use se a notificação original falhou ou o código expirou.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da proposta pendente (ver guardian_pending_rules)" },
      },
      required: ["id"],
    },
  },
  {
    name: "guardian_get_golden_rules",
    description: "Retorna a lista consolidada de regras de ouro já aprovadas e em vigor.",
    inputSchema: { type: "object", properties: {} },
  },
];

export const GUARDIAN_HANDLERS: Record<string, ToolHandler> = {
  guardian_audit_execution: async (ctx, args) => {
    const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
    const targetAgent = typeof args.targetAgent === "string" && args.targetAgent.trim() ? args.targetAgent.trim() : null;
    const changesSummary = typeof args.changesSummary === "string" && args.changesSummary.trim() ? args.changesSummary.trim() : null;
    if (!taskId || !targetAgent || !changesSummary) {
      throw new Error("parâmetros taskId, targetAgent e changesSummary são obrigatórios");
    }
    const testResults = typeof args.testResults === "string" ? args.testResults : undefined;
    const result = await auditExecution({ taskId, targetAgent, changesSummary, testResults });
    return { ok: true, ...result };
  },

  guardian_promote_golden_rule: async (ctx, args) => {
    const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
    const ruleText = typeof args.ruleText === "string" && args.ruleText.trim() ? args.ruleText.trim() : null;
    const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : null;
    if (!topic || !ruleText || !reason) {
      throw new Error("parâmetros topic, ruleText e reason são obrigatórios");
    }
    // O código de aprovação NUNCA volta pro agente aqui — só chega em
    // claro via notificação Telegram (ou `os guardian pending` + reenvio).
    const { rule } = proposeRule(ctx.config.home, topic, ruleText, reason);
    return { ok: true, rule: pendingRuleForAgent(rule) };
  },

  guardian_pending_rules: async (ctx) => {
    return { ok: true, pending: listPendingRules(ctx.config.home).map(pendingRuleForAgent) };
  },

  guardian_approve_rule: async (ctx, args) => {
    const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : null;
    const code = typeof args.code === "string" && args.code.trim() ? args.code.trim() : null;
    if (!id) throw new Error("parâmetro id é obrigatório");
    if (!code) throw new Error("parâmetro code é obrigatório (código de aprovação enviado por Telegram/CLI)");
    const repoRoot = process.env.ASSISTENTE_OS_REPO_ROOT || process.cwd();
    const rule = approveRule(ctx.config.home, repoRoot, id, code);
    return { ok: true, rule };
  },

  guardian_reject_rule: async (ctx, args) => {
    const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : null;
    const code = typeof args.code === "string" && args.code.trim() ? args.code.trim() : null;
    if (!id) throw new Error("parâmetro id é obrigatório");
    if (!code) throw new Error("parâmetro code é obrigatório (código de aprovação enviado por Telegram/CLI)");
    rejectRule(ctx.config.home, id, code);
    return { ok: true };
  },

  guardian_resend_approval_code: async (ctx, args) => {
    const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : null;
    if (!id) throw new Error("parâmetro id é obrigatório");
    resendApprovalCode(ctx.config.home, id);
    return { ok: true, message: "novo código enviado por Telegram (se configurado); consulte guardian_pending_rules ou o dono do sistema" };
  },

  guardian_get_golden_rules: async (ctx) => {
    return { ok: true, rules: listActiveGoldenRules(ctx.config.home) };
  },
};
