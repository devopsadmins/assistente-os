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
import { runAgent, runAgentStream, type AgentStateType, type LangGraphStepEvent } from "@assistente-os/memory";
import { createAgentTools } from "./langgraph-tools.js";
import { loadConfig } from "@assistente-os/core";
import { join } from "node:path";

export interface LangGraphToolCallSummary {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface LangGraphRunnerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  state?: AgentStateType;
  toolCalls?: LangGraphToolCallSummary[];
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

    const toolCalls: LangGraphToolCallSummary[] = state.messages
      .filter((m) => m.role === "assistant" && m.toolCalls?.length)
      .flatMap((m) =>
        m.toolCalls!.map((tc) => ({
          name: tc.name,
          args: tc.args,
          result: state.messages
            .find((r) => r.role === "tool" && r.toolCallId === tc.id)
            ?.content?.slice(0, 500) ?? "(sem resultado)",
        })),
      );

    return {
      code: 0,
      stdout,
      stderr: "",
      timedOut: false,
      state,
      toolCalls: toolCalls.length ? toolCalls : undefined,
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

export interface LangGraphStreamStep {
  node: string;
  ts: number;
  iterationCount: number;
  messageCount: number;
  lastContent?: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}

export interface LangGraphStreamResult {
  steps: LangGraphStreamStep[];
  finalState: AgentStateType;
}

export interface LangGraphStreamOptions extends LangGraphRunnerOptions {
  onStep?: (step: LangGraphStreamStep) => void | Promise<void>;
}

export async function runLangGraphAgentStream(
  pool: Pool,
  options: LangGraphStreamOptions,
): Promise<LangGraphRunnerResult> {
  const { soul, prompt, threadId, timeoutSeconds = 300, useTools = true, onStep } = options;
  const startedAt = Date.now();
  const steps: LangGraphStreamStep[] = [];

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

    let finalState: AgentStateType | undefined;

    for await (const event of runAgentStream(pool, soul, prompt, finalThreadId, tools)) {
      const step: LangGraphStreamStep = {
        node: event.node,
        ts: event.ts,
        iterationCount: event.state.iterationCount,
        messageCount: event.state.messages.length,
        lastContent: event.state.messages[event.state.messages.length - 1]?.content,
        toolCalls: event.state.messages[event.state.messages.length - 1]?.toolCalls,
      };
      steps.push(step);
      finalState = event.state;

      if (onStep) {
        await onStep(step);
      }
    }

    if (!finalState) {
      return { code: 1, stdout: "", stderr: "LangGraph não produziu estado", timedOut: false };
    }

    const lastAssistant = [...finalState.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    const stdout = lastAssistant?.content ?? "(sem resposta)";

    const toolCalls: LangGraphToolCallSummary[] = finalState.messages
      .filter((m) => m.role === "assistant" && m.toolCalls?.length)
      .flatMap((m) =>
        m.toolCalls!.map((tc) => ({
          name: tc.name,
          args: tc.args,
          result: finalState!.messages
            .find((r) => r.role === "tool" && r.toolCallId === tc.id)
            ?.content?.slice(0, 500) ?? "(sem resultado)",
        })),
      );

    return {
      code: 0,
      stdout,
      stderr: "",
      timedOut: false,
      state: finalState,
      toolCalls: toolCalls.length ? toolCalls : undefined,
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
