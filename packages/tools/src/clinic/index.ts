import { authorizeTool, type Tool, type ToolHandler } from "../index.js";

/**
 * Vertical Clínicas — perfil AI-4 (`ADR-PRIV-003`). Bloco G BLOCKED (G3/G4/G5,
 * ver `docs/compliance/clinicas/`): nenhuma destas tools deve processar dado
 * real de paciente até o Bloco G ser reaprovado. `clinic_prevent_noshow` roda
 * em modo dry-run — nunca dispara mensagem real — enquanto o provedor de
 * mensageria (pendência P6) não for escolhido e `MCP_ZERO_TRUST` (P8) não
 * estiver confirmado no ambiente real.
 */

export const CLINIC_TOOLS: Tool[] = [
  {
    name: "clinic_triage_lead",
    description: "Avalia o score preditivo de um lead de clínica (aderência ao ICP) e gera um dossiê para a equipe comercial. Não processa dado clínico/diagnóstico — só qualificação comercial.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        leadData: {
          type: "object",
          description: "dados do lead: nome, telefone/e-mail, procedimento de interesse, origem, urgência",
        },
      },
      required: ["soul", "leadData"],
    },
  },
  {
    name: "clinic_prevent_noshow",
    description: "Agenda gatilhos de cadência (nutrição/confirmação) para reduzir no-show. Modo dry-run enquanto o Bloco G (ADR-PRIV-003) estiver BLOCKED — não dispara mensagem real.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        patientId: { type: "string", description: "identificador do paciente (opaco, não usar dado direto como PII em claro)" },
        appointmentDate: { type: "string", description: "data/hora do agendamento, ISO 8601" },
      },
      required: ["soul", "patientId", "appointmentDate"],
    },
  },
];

/** Palavras-chave de interesse alinhadas ao ICP de clínicas (odontologia/estética avançada). */
const ICP_KEYWORDS = [
  "implante", "ortodontia", "clareamento", "estética", "botox", "preenchimento",
  "harmonização", "laser", "avaliação", "consulta",
];

function scoreLead(leadData: Record<string, unknown>): { score: number; tier: "quente" | "morno" | "frio"; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const hasContact = typeof leadData.telefone === "string" && leadData.telefone.trim().length > 0
    || typeof leadData.email === "string" && leadData.email.trim().length > 0;
  if (hasContact) {
    score += 30;
    reasons.push("contato direto informado (+30)");
  } else {
    reasons.push("sem telefone/e-mail — lead incompleto");
  }

  const procedimento = typeof leadData.procedimento === "string" ? leadData.procedimento.toLowerCase() : "";
  const matchedKeyword = ICP_KEYWORDS.find((k) => procedimento.includes(k));
  if (matchedKeyword) {
    score += 40;
    reasons.push(`procedimento de interesse alinhado ao ICP ("${matchedKeyword}") (+40)`);
  } else if (procedimento) {
    score += 10;
    reasons.push("procedimento informado, mas fora das palavras-chave conhecidas do ICP (+10)");
  }

  const urgencia = typeof leadData.urgencia === "string" ? leadData.urgencia.toLowerCase() : "";
  if (urgencia === "alta") {
    score += 30;
    reasons.push("urgência declarada alta (+30)");
  } else if (urgencia === "media" || urgencia === "média") {
    score += 15;
    reasons.push("urgência declarada média (+15)");
  }

  score = Math.min(100, score);
  const tier = score >= 70 ? "quente" : score >= 40 ? "morno" : "frio";
  return { score, tier, reasons };
}

export const CLINIC_HANDLERS: Record<string, ToolHandler> = {
  clinic_triage_lead: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "clinic_triage_lead");

    const leadData = args.leadData;
    if (!leadData || typeof leadData !== "object" || Array.isArray(leadData)) {
      throw new Error("parâmetro leadData é obrigatório e deve ser um objeto");
    }

    const { score, tier, reasons } = scoreLead(leadData as Record<string, unknown>);
    return {
      score,
      tier,
      reasons,
      dossie: {
        procedimentoInteresse: (leadData as Record<string, unknown>).procedimento ?? null,
        origem: (leadData as Record<string, unknown>).origem ?? null,
        geradoEm: new Date().toISOString(),
      },
      aviso: "Score comercial (ICP) — não é avaliação clínica/diagnóstico.",
    };
  },

  clinic_prevent_noshow: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "clinic_prevent_noshow");

    const patientId = typeof args.patientId === "string" && args.patientId.trim() ? args.patientId.trim() : null;
    const appointmentDate = typeof args.appointmentDate === "string" && args.appointmentDate.trim() ? args.appointmentDate.trim() : null;
    if (!patientId || !appointmentDate) throw new Error("patientId e appointmentDate são obrigatórios");

    const parsed = new Date(appointmentDate);
    if (Number.isNaN(parsed.getTime())) throw new Error("appointmentDate inválida — use ISO 8601");

    // Modo dry-run: Bloco G (ADR-PRIV-003) BLOCKED — nunca despachar mensagem
    // real aqui. Só devolve o plano de gatilhos que SERIA agendado.
    const triggers = [
      { tipo: "nutricao", offsetHoras: -72 },
      { tipo: "confirmacao", offsetHoras: -24 },
    ].map((t) => ({
      ...t,
      previstoPara: new Date(parsed.getTime() + t.offsetHoras * 3_600_000).toISOString(),
    }));

    return {
      dryRun: true,
      motivo: "Bloco G BLOCKED (ADR-PRIV-003) — provedor de mensageria (P6) e MCP_ZERO_TRUST (P8) ainda pendentes; nenhuma mensagem real é disparada.",
      patientId,
      appointmentDate,
      gatilhosPlanejados: triggers,
    };
  },
};
