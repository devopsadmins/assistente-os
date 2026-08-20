/**
 * Runner LangGraph para o daemon.
 *
 * Executa o agente LangGraph com memória persistente e checkpoint.
 * Alternativa ao `opencode run` para tarefas que precisam de
 * memória de longo prazo e execução multi-turno.
 *
 * Suporta tool-calling via tools LangChain.
 */
import type { Pool } from "@assistente-os/core";
import { runAgent, type AgentStateType } from "@assistente-os/memory";
import { createAgentTools } from "./langgraph-tools.js";
import { loadConfig } from "@assistente-os/core";
import { join } from "node:path";

export interface LangGraphRunnerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  state?: AgentStateType;
}

export interface LangGraphRunnerOptions {
  soul: string;
  prompt: string;
  threadId?: string;
  timeoutSeconds?: number;
  useTools?: boolean;
}

/**
 * Executa o agente LangGraph para uma soul.
 *
 * O LangGraph usa o RAG interno (retrieve → generate) e mantém
 * memória persistente via thread ID.
 *
 * Se useTools=true (padrão), cria tools LangChain que wrapam
 * as ferramentas do Assistente OS (memory, graph, soul, agenda).
 */
export async function runLangGraphAgent(
  pool: Pool,
  options: LangGraphRunnerOptions,
): Promise<LangGraphRunnerResult> {
  const { soul, prompt, threadId, timeoutSeconds = 300, useTools = true } = options;
  const startedAt = Date.now();

  try {
    const finalThreadId = threadId ?? `soul-${soul}-${Date.now()}`;

    let tools = undefined;
    if (useTools) {
      const config = loadConfig({});
      tools = createAgentTools({
        home: config.home,
        pool,
        soulId: soul,
      });
    }

    const state = await runAgent(pool, soul, prompt, finalThreadId, tools);

    const lastAssistant = [...state.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    const stdout = lastAssistant?.content ?? "(sem resposta)";

    return {
      code: 0,
      stdout,
      stderr: "",
      timedOut: false,
      state,
    };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const timedOut = elapsed >= timeoutSeconds * 1000;
    const message = err instanceof Error ? err.message : String(err);

    return {
      code: 1,
      stdout: "",
      stderr: timedOut ? `LangGraph timeout after ${timeoutSeconds}s` : message,
      timedOut,
    };
  }
}

/**
 * Sonda se o LangGraph está disponível.
 * Retorna ok=true se o Ollama estiver respondendo.
 */
export async function probeLangGraph(ollamaUrl: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const url = new URL("/api/tags", ollamaUrl);
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `Ollama HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
