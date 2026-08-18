/**
 * Prompt Templates para Chain RAG do Assistente OS.
 *
 * Templates reutilizáveis para diferentes tipos de consulta,
 * integráveis com o LangChain e o fluxo runRagChain.
 */

/**
 * Template padrão: equilibrado para perguntas gerais.
 */
export function defaultTemplate(context: string, question: string): string {
  return "Você é o assistente do Assistente OS. Use o contexto abaixo para responder à pergunta do usuário.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Resposta:";
}

/**
 * Template para perguntas de código/desenvolvimento.
 */
export function codeTemplate(context: string, question: string): string {
  return "Você é um assistente de programação. Use o contexto abaixo para responder sobre código.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Resposta detalhada:";
}

/**
 * Template para análise/resumos.
 */
export function analysisTemplate(context: string, question: string): string {
  return "Faça uma análise baseando-se apenas no contexto abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Análise:\n- Pontos principais:\n- Conclusões:\n- Incertezas:";
}

/**
 * Template para perguntas factual.
 */
export function factualTemplate(context: string, question: string): string {
  return "Responda baseando-se APENAS no contexto abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Resposta direta:";
}

/**
 * Template para extração de informações.
 */
export function informationExtractionTemplate(context: string, question: string): string {
  return "Extraia as informações solicitadas baseando-se no contexto abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Informação solicitada:";
}

/**
 * Aplica o template adequado baseado no tipo de consulta.
 */
export function applyTemplate(
  templateName: "default" | "code" | "analysis" | "factual" | "information-extraction",
  context: string,
  question: string
): string {
  const templates: Record<
    "default" | "code" | "analysis" | "factual" | "information-extraction",
    (ctx: string, q: string) => string
  > = {
    default: defaultTemplate,
    code: codeTemplate,
    analysis: analysisTemplate,
    factual: factualTemplate,
    "information-extraction": informationExtractionTemplate,
  };

  const template = templates[templateName];
  if (!template) {
    throw new Error(
      "Template " + templateName + " não encontrado. Use um dos: " + Object.keys(templates).join(", ")
    );
  }

  return template(context, question);
}