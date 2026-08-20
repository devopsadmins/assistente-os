/**
 * Prompt Templates para Chain RAG do Assistente OS.
 *
 * Usa ChatPromptTemplate do LangChain para composição declarativa.
 * Mantém applyTemplate() para retrocompatibilidade.
 */
import { ChatPromptTemplate, type ChatPromptTemplateInput } from "@langchain/core/prompts";

type TemplateName = "default" | "code" | "analysis" | "factual" | "information-extraction";

const SYSTEM_INSTRUCTION = "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.";

const SUFFIX_BY_NAME: Record<TemplateName, string> = {
  default: "Resposta:",
  code: "Resposta detalhada:",
  analysis: "Análise:\n- Pontos principais:\n- Conclusões:\n- Incertezas:",
  factual: "Resposta direta:",
  "information-extraction": "Informação solicitada:",
};

const templates: Record<TemplateName, ChatPromptTemplate> = {} as Record<TemplateName, ChatPromptTemplate>;

for (const name of Object.keys(SUFFIX_BY_NAME) as TemplateName[]) {
  templates[name] = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_INSTRUCTION],
    [
      "human",
      `Contexto:\n{context}\n\nPergunta: {question}\n\n${SUFFIX_BY_NAME[name]}`,
    ],
  ]);
}

export const langchainTemplates = templates;

export function defaultTemplate(context: string, question: string): string {
  return (
    "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Resposta:"
  );
}

export function codeTemplate(context: string, question: string): string {
  return (
    "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Resposta detalhada:"
  );
}

export function analysisTemplate(context: string, question: string): string {
  return (
    "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Análise:\n- Pontos principais:\n- Conclusões:\n- Incertezas:"
  );
}

export function factualTemplate(context: string, question: string): string {
  return (
    "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Resposta direta:"
  );
}

export function informationExtractionTemplate(context: string, question: string): string {
  return (
    "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    "Informação solicitada:"
  );
}

const legacyTemplates: Record<TemplateName, (ctx: string, q: string) => string> = {
  default: defaultTemplate,
  code: codeTemplate,
  analysis: analysisTemplate,
  factual: factualTemplate,
  "information-extraction": informationExtractionTemplate,
};

export function applyTemplate(
  templateName: TemplateName,
  context: string,
  question: string
): string {
  const template = legacyTemplates[templateName];
  if (!template) {
    throw new Error(
      "Template " + templateName + " não encontrado. Use um dos: " + Object.keys(legacyTemplates).join(", ")
    );
  }
  return template(context, question);
}
