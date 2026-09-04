import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, type RequestContext } from "../shared.js";

/** GET /souls/:id/langgraph/status|history */
export async function handleChatLanggraphStatus(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
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
    const { probeLangGraph } = await import("../../langgraph-runner.js");
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
