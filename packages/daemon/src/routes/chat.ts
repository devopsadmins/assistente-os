import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { AssistenteOsConfig, Soul } from "@assistente-os/core";
import {
  loadConfig,
  getPool,
  isDbHealthy,
  recordCostCall,
  anotar,
  getSoul,
  todayISODate,
  sumCostBySoul,
  openSession,
  bumpSessionPrompt,
  recordSessionMessage,
  getRecentSessionMessages,
  sessionHistoryTurns,
  sessionHistoryMaxChars,
  recordExecution,
  recordExecutionSpan,
  logger,
  sanitizeUserPrompt,
  sanitizeLLMResponse,
  purgeCredentials,
  resolveTarget,
  recordRouterSelection,
  logFullAuditEntry,
  estimateTokens,
  nextZenApiKey,
} from "@assistente-os/core";
import type { RagChunk, RagInjectionFinding } from "@assistente-os/memory";
import { maxFindingSeverity, scoreAnswerFaithfulness } from "@assistente-os/memory";
import { recordRagEvalRun } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { runLangGraphAgentStream } from "../langgraph-runner.js";
import { routeFromPrompt, type ExecutionMode } from "../orchestrator/router.js";
import {
  escalationConfig,
  shouldEscalate,
  shouldRunJudge,
  judgeAnswer,
  nextEscalationTier,
  looksLikeRefusal,
  canEscalateSession,
  recordSessionEscalation,
} from "../orchestrator/escalation.js";
import { sendJson, readJson, makeLocalFallbackProbe, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";
import { chatRequests, chatLatency, tokensTotal, promptInjectionAlerts, ragRerankSeconds, ragCacheEvents, routerEscalation, ollamaPrefillSeconds, ollamaPromptEvalTokens } from "../observability/metrics.js";

export { ollamaChatStream, preparePromptContext, type ExecUsage, type PreparedPromptContext, type PreparePromptContextResult } from "../promptPipeline.js";
import { ollamaChat, handleChatDegraded, preparePromptContext, type ExecUsage } from "../promptPipeline.js";
import { handleChatBuffer } from "./chat/buffer.js";
import { handlePostChat } from "./chat/postChat.js";

/** Rotas de execução de prompt: GET /souls/:id/buffer, POST /souls/:id/chat, GET /souls/:id/langgraph/status|history */
export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub } = context;

  if (await handleChatBuffer(req, res, url, path, context)) return true;
  if (await handlePostChat(req, res, url, path, context)) return true;

  // ----- Endpoints LangGraph ──────────────────────────────────────────
  // /souls/:soul/langgraph/status - status do grafo
  // /souls/:soul/langgraph/history - histórico de execução
  const lgSoulMatch = path.match(/^\/souls\/([^/]+)\/langgraph\//);
  if (lgSoulMatch && (req.url?.includes("/langgraph/status") || req.url?.includes("/langgraph/history"))) {
    const soulId = decodeURIComponent(lgSoulMatch[1]!);
    const lgHome = context.home;
    const { loadConfig: loadConfigDyn } = await import("@assistente-os/core");
    const cfg = loadConfigDyn({ home: lgHome });
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const { probeLangGraph } = await import("../langgraph-runner.js");
    const ollamaUrl = cfg.ollamaUrl || "http://127.0.0.1:11434/v1";
    const probe = await probeLangGraph(ollamaUrl);

    if (req.url?.includes("/langgraph/status")) {
      const soul = getSoulDyn(lgHome, soulId);
      if (!soul) {
        sendJson(res, 404, { error: "Soul não encontrada" });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        soul: soul.id,
        ollamaAvailable: probe.ok,
        mode: soul.config.models?.chat || "auto",
        maxIterations: soul.config.agent?.guardrails?.maxIterations ?? 5,
      });
      return true;
    }

    if (req.url?.includes("/langgraph/history")) {
      // TODO: histórico real seria armazenado em checkpoint do LangGraph
      // Por enquanto retorna dados mockados indicando suporte
      sendJson(res, 200, {
        ok: true,
        soul: soulId,
        steps: [],
        message: "Histórico em breve - requires LangGraph checkpointer persistence",
      });
      return true;
    }
  }

  return false;
}
