/**
 * Prompt Templates da chain RAG. As palavras vêm do Prompt Garden
 * (`@assistente-os/core` → `ragAnswer` + `RAG_ANSWER_SUFFIXES`) — este arquivo só
 * monta as duas formas consumidas hoje:
 *  - `langchainTemplates` — `ChatPromptTemplate` (system + human), usado por `rag-chain.ts`.
 *  - `applyTemplate` / `*Template` — string única (compat; formato inline "Contexto: ").
 */
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ragAnswer, RAG_ANSWER_SUFFIXES, type RagAnswerStyle } from "@assistente-os/core";

type TemplateName = RagAnswerStyle;

/** Instrução de sistema — fonte única no garden (`ragAnswer.papel`). */
const SYSTEM_INSTRUCTION = ragAnswer.papel;

const templates: Record<TemplateName, ChatPromptTemplate> = {} as Record<TemplateName, ChatPromptTemplate>;

for (const name of Object.keys(RAG_ANSWER_SUFFIXES) as TemplateName[]) {
  templates[name] = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_INSTRUCTION],
    // `ragAnswer.template` = "Contexto:\n{context}\n\nPergunta: {question}\n\n{suffix}"
    // — só o {suffix} é resolvido aqui; {context}/{question} ficam pro LangChain.
    ["human", ragAnswer.template.replace("{suffix}", RAG_ANSWER_SUFFIXES[name])],
  ]);
}

export const langchainTemplates = templates;

/** Forma-string legada (inline "Contexto: "), mantida por retrocompat. */
function legacyString(suffix: string, context: string, question: string): string {
  return (
    SYSTEM_INSTRUCTION + "\n\n" +
    "Contexto: " + context + "\n\n" +
    "Pergunta: " + question + "\n\n" +
    suffix
  );
}

export function defaultTemplate(context: string, question: string): string {
  return legacyString(RAG_ANSWER_SUFFIXES.default, context, question);
}
export function codeTemplate(context: string, question: string): string {
  return legacyString(RAG_ANSWER_SUFFIXES.code, context, question);
}
export function analysisTemplate(context: string, question: string): string {
  return legacyString(RAG_ANSWER_SUFFIXES.analysis, context, question);
}
export function factualTemplate(context: string, question: string): string {
  return legacyString(RAG_ANSWER_SUFFIXES.factual, context, question);
}
export function informationExtractionTemplate(context: string, question: string): string {
  return legacyString(RAG_ANSWER_SUFFIXES["information-extraction"], context, question);
}

const legacyTemplates: Record<TemplateName, (ctx: string, q: string) => string> = {
  default: defaultTemplate,
  code: codeTemplate,
  analysis: analysisTemplate,
  factual: factualTemplate,
  "information-extraction": informationExtractionTemplate,
};

export function applyTemplate(templateName: TemplateName, context: string, question: string): string {
  const template = legacyTemplates[templateName];
  if (!template) {
    throw new Error(
      "Template " + templateName + " não encontrado. Use um dos: " + Object.keys(legacyTemplates).join(", "),
    );
  }
  return template(context, question);
}
