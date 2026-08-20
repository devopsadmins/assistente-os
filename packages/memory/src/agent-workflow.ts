/**
 * Workflow do agente LangGraph para o Assistente OS.
 *
 * Define o grafo de execução: retrieve → generate → (decide) → END ou tool.
 * Compilado como StateGraph do LangGraph, suporta memória persistente via
 * MemorySaver e checkpoints entre chamadas.
 */
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { runRagChain } from "./rag-chain.js";
import { AgentState, type AgentStateType } from "./agent-state.js";
import type { Pool } from "@assistente-os/core";

export type { AgentStateType };

function createLLM() {
  const baseUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434/v1";
  const modelName = process.env.OLLAMA_MODEL || "qwen2.5:latest";
  return new ChatOpenAI({
    modelName,
    apiKey: process.env.OPENAI_API_KEY || "ollama",
    configuration: { baseURL: baseUrl },
    temperature: 0,
    maxTokens: 1024,
  });
}

function toLangChainMessages(msgs: AgentStateType["messages"]) {
  return msgs.map((m) => {
    switch (m.role) {
      case "system": return new SystemMessage(m.content);
      case "user": return new HumanMessage(m.content);
      case "assistant": return new AIMessage(m.content);
      default: return new HumanMessage(m.content);
    }
  });
}

function buildRetrieveNode(pool: Pool) {
  return async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return {};

    const result = await runRagChain(pool, state.soul, lastUser.content, 5);
    return { context: result.answer };
  };
}

function buildGenerateNode() {
  return async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const llm = createLLM();

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "Você é o assistente do Assistente OS. Use o contexto fornecido para responder. Se não tiver informação suficiente, diga que não sabe."],
      new MessagesPlaceholder("history"),
      ["human", "Contexto do grafo de memória:\n{context}\n\nPergunta: {question}"],
    ]);

    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    const question = lastUser?.content ?? "";
    const history = toLangChainMessages(state.messages);

    const chain = RunnableSequence.from([
      async () => ({ context: state.context || "Sem contexto disponível.", question, history }),
      prompt,
      llm,
      new StringOutputParser(),
    ]);

    const answer = await chain.invoke({});

    return {
      messages: [{ role: "assistant", content: answer }],
      iterationCount: state.iterationCount + 1,
    };
  };
}

function shouldContinue(state: AgentStateType): string {
  if (state.iterationCount >= state.maxIterations) {
    return "__end__";
  }
  return "generate";
}

import { RunnableSequence } from "@langchain/core/runnables";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let compiledGraph: any = null;

function buildGraph(pool: Pool) {
  if (compiledGraph) return compiledGraph;

  const graph = new StateGraph(AgentState)
    .addNode("retrieve", buildRetrieveNode(pool))
    .addNode("generate", buildGenerateNode())
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addConditionalEdges("generate", shouldContinue, {
      generate: "generate",
      [END]: END,
    });

  const memory = new MemorySaver();
  compiledGraph = graph.compile({ checkpointer: memory });
  return compiledGraph;
}

/**
 * Executa o agente LangGraph com o estado inicial e uma mensagem do usuário.
 * Retorna o estado final após todas as iterações.
 */
export async function runAgent(
  pool: Pool,
  soul: string,
  userMessage: string,
  threadId?: string
): Promise<AgentStateType> {
  const graph = buildGraph(pool);

  const initialState: AgentStateType = {
    soul,
    messages: [
      {
        role: "system",
        content:
          "Você é o assistente do Assistente OS. Use as ferramentas disponíveis para responder perguntas do usuário. " +
          "Você tem acesso a um grafo de memória com entidades, relações e observações.",
      },
      { role: "user", content: userMessage },
    ],
    context: "",
    lastToolResult: undefined,
    entities: undefined,
    relations: undefined,
    iterationCount: 0,
    maxIterations: Number(process.env.LANGGRAPH_MAX_ITERATIONS) || 5,
  };

  const config = { configurable: { thread_id: threadId ?? `soul-${soul}` } };
  return await graph.invoke(initialState, config);
}

/**
 * Re-exporta funções auxiliares para retrocompatibilidade.
 */
export {
  addUserMessage,
  addToolResult,
  checkMaxIterations,
  nextIteration,
  executeRagChain,
  decideNextStep,
} from "./agent-workflow-legacy.js";

export {
  defaultTemplate as ragDefaultTemplate,
  codeTemplate as ragCodeTemplate,
  analysisTemplate as ragAnalysisTemplate,
  factualTemplate as ragFactualTemplate,
  informationExtractionTemplate as ragInformationExtractionTemplate,
} from "./prompt-templates.js";
