/**
 * Workflow do agente LangGraph para o Assistente OS.
 *
 * Define o grafo de execução: retrieve → generate → (tool? | END).
 * Compilado como StateGraph do LangGraph, suporta memória persistente via
 * MemorySaver e checkpoints entre chamadas.
 *
 * Suporta tool-calling via tools LangChain.
 */
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableSequence } from "@langchain/core/runnables";
import type { StructuredTool } from "@langchain/core/tools";
import { runRagChain } from "./rag-chain.js";
import { AgentState, type AgentStateType } from "./agent-state.js";
import { loadConfig, type Pool } from "@assistente-os/core";

export type { AgentStateType };

/**
 * Antes lia process.env.OLLAMA_URL/OLLAMA_MODEL direto, com um default
 * hardcoded ("qwen2.5:latest") que não existe no Ollama local (só
 * qwen2.5-coder:3b está puxado) — todo turno de LangGraph terminava em
 * 404 MODEL_NOT_FOUND. Usa a config canônica (mesma de todo o resto do
 * sistema) em vez de reinventar um terceiro par de env vars/defaults.
 *
 * Prefere o OpenCode Zen (cloud, tool-calling nativo real) quando
 * ZEN_API_KEY estiver configurada — modelos locais pequenos no Ollama não
 * suportam tool-calling de forma confiável (o modelo escreve a chamada
 * como texto solto em vez de preencher o campo estruturado da resposta),
 * o que torna as tools do LangGraph inutilizáveis com Ollama sozinho.
 * Sem a chave, cai de volta pro Ollama local (sem tools funcionais, mas
 * ainda responde).
 */
function createLLM(tools?: StructuredTool[]) {
  const config = loadConfig({});
  const useZen = Boolean(config.zenApiKey);
  const baseUrl = useZen ? config.zenBaseUrl : `${config.ollamaUrl.replace(/\/$/, "")}/v1`;
  const modelName = useZen ? config.zenChatModel : config.ollamaChatModel;
  const apiKey = useZen ? config.zenApiKey! : process.env.OPENAI_API_KEY || "ollama";
  const llm = new ChatOpenAI({
    modelName,
    apiKey,
    configuration: { baseURL: baseUrl },
    temperature: 0,
    maxTokens: 1024,
  });

  if (tools && tools.length > 0) {
    return llm.bindTools(tools);
  }
  return llm;
}

function toLangChainMessages(msgs: AgentStateType["messages"]) {
  return msgs.map((m) => {
    switch (m.role) {
      case "system": return new SystemMessage(m.content);
      case "user": return new HumanMessage(m.content);
      case "assistant": return new AIMessage(m.content);
      case "tool": return new ToolMessage(m.content, m.toolCallId ?? "");
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

function buildGenerateNode(tools?: StructuredTool[]) {
  return async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const llm = createLLM(tools);

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "Você é o assistente do Assistente OS. Use o contexto fornecido e as ferramentas disponíveis para responder. Se não tiver informação suficiente, diga que não sabe. Você pode usar ferramentas para buscar informações, registrar lições, e executar ações."],
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
    ]);

    const response = await chain.invoke({});

    const toolCalls = response.tool_calls ?? [];
    const content = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    if (toolCalls.length > 0) {
      const assistantMessage = {
        role: "assistant" as const,
        content,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id ?? "",
          name: tc.name,
          args: tc.args as Record<string, unknown>,
        })),
      };
      return {
        messages: [assistantMessage],
        iterationCount: state.iterationCount + 1,
      };
    }

    return {
      messages: [{ role: "assistant", content }],
      iterationCount: state.iterationCount + 1,
    };
  };
}

/**
 * Node de execução de ferramentas próprio, no lugar do ToolNode pronto do
 * LangGraph (@langchain/langgraph/prebuilt) — este grafo usa um `AgentState`
 * customizado (mensagens em `AgentMessage`, não `BaseMessage` do LangChain),
 * e ToolNode exige especificamente `BaseMessage[]`/`{messages: BaseMessage[]}`
 * como entrada. Passar o estado customizado pra ele sempre quebrava com
 * "ToolNode only accepts BaseMessage[] or { messages: BaseMessage[] } as
 * input." — só foi notado agora porque o tool-calling nunca tinha chegado
 * até aqui de verdade (Ollama local não populava toolCalls; ver createLLM).
 */
function buildToolNode(tools: StructuredTool[]) {
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  return async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls = lastMessage?.toolCalls ?? [];

    const results: AgentStateType["messages"] = [];
    for (const call of toolCalls) {
      const tool = toolsByName.get(call.name);
      let content: string;
      if (!tool) {
        content = `Erro: ferramenta "${call.name}" não encontrada.`;
      } else {
        try {
          const result = await tool.invoke(call.args);
          content = typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
          content = `Erro ao executar ${call.name}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      results.push({ role: "tool", content, toolCallId: call.id });
    }

    return { messages: results };
  };
}

function shouldContinue(state: AgentStateType): string {
  if (state.iterationCount >= state.maxIterations) {
    return "__end__";
  }

  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage?.role === "assistant" && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
    return "tools";
  }

  return "__end__";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let compiledGraphWithTools: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let compiledGraphWithoutTools: any = null;

function buildGraphWithTools(pool: Pool, tools: StructuredTool[]) {
  if (compiledGraphWithTools) return compiledGraphWithTools;

  const generateNode = buildGenerateNode(tools);
  const toolNode = buildToolNode(tools);

  const graph = new StateGraph(AgentState)
    .addNode("retrieve", buildRetrieveNode(pool))
    .addNode("generate", generateNode)
    .addNode("tools", toolNode)
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addConditionalEdges("generate", shouldContinue, {
      tools: "tools",
      [END]: END,
    })
    .addEdge("tools", "generate");

  const memory = new MemorySaver();
  compiledGraphWithTools = graph.compile({ checkpointer: memory });
  return compiledGraphWithTools;
}

function buildGraphWithoutTools(pool: Pool) {
  if (compiledGraphWithoutTools) return compiledGraphWithoutTools;

  const graph = new StateGraph(AgentState)
    .addNode("retrieve", buildRetrieveNode(pool))
    .addNode("generate", buildGenerateNode())
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addConditionalEdges("generate", shouldContinue, {
      [END]: END,
    });

  const memory = new MemorySaver();
  compiledGraphWithoutTools = graph.compile({ checkpointer: memory });
  return compiledGraphWithoutTools;
}

/**
 * Executa o agente LangGraph com o estado inicial e uma mensagem do usuário.
 * Retorna o estado final após todas as iterações.
 *
 * @param tools Tools LangChain disponíveis para o agente (opcional)
 */
export async function runAgent(
  pool: Pool,
  soul: string,
  userMessage: string,
  threadId?: string,
  tools?: StructuredTool[],
): Promise<AgentStateType> {
  const graph = tools && tools.length > 0
    ? buildGraphWithTools(pool, tools)
    : buildGraphWithoutTools(pool);

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

export interface LangGraphStepEvent {
  node: string;
  state: AgentStateType;
  ts: number;
}

export async function* runAgentStream(
  pool: Pool,
  soul: string,
  userMessage: string,
  threadId?: string,
  tools?: StructuredTool[],
): AsyncGenerator<LangGraphStepEvent> {
  const graph = tools && tools.length > 0
    ? buildGraphWithTools(pool, tools)
    : buildGraphWithoutTools(pool);

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

  // graph.stream() retorna uma Promise<IterableReadableStream>, não o
  // stream diretamente — sem o await, for-await tentava iterar a própria
  // Promise (que não é async-iterable) e falhava sempre, tornando esta
  // função inutilizável em qualquer chamada real.
  //
  // O streamMode padrão do LangGraph.js é "updates": cada passo do stream
  // traz só o retorno PARCIAL do nó que rodou (ex.: { context: "..." } do
  // node "retrieve", sem `messages`) — mas langgraph-runner.ts assume o
  // estado completo a cada passo (event.state.messages.length), o que
  // quebrava com "Cannot read properties of undefined (reading 'length')"
  // assim que o primeiro passo parcial chegava. Em vez de depender do modo
  // multi-stream ["updates","values"] do LangGraph (cuja ordem de entrega
  // dos dois streams não é algo que eu queira assumir sem testar), a
  // atualização parcial de cada passo é mesclada manualmente no estado
  // acumulado aqui, espelhando os reducers de agent-state.ts (messages
  // concatena, os demais campos sobrescrevem).
  const stream = await graph.stream(initialState, config);
  let state: AgentStateType = { ...initialState };
  for await (const step of stream) {
    const node = Object.keys(step as object)[0] ?? "unknown";
    const partial = ((step as Record<string, Partial<AgentStateType>>)[node] ?? {}) as Partial<AgentStateType>;
    state = {
      ...state,
      ...partial,
      messages: partial.messages ? [...state.messages, ...partial.messages] : state.messages,
    };
    yield { node, state, ts: Date.now() };
  }
}

export {
  defaultTemplate as ragDefaultTemplate,
  codeTemplate as ragCodeTemplate,
  analysisTemplate as ragAnalysisTemplate,
  factualTemplate as ragFactualTemplate,
  informationExtractionTemplate as ragInformationExtractionTemplate,
} from "./prompt-templates.js";
