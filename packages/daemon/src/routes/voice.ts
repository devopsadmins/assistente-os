import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, getPool, getSoul, route } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { sendJson, readJson, makeLocalFallbackProbe, type RequestContext } from "./shared.js";

/** Controle do pipeline de voz: POST /voice/start, POST /voice/stop, GET /voice/status */
export async function handleVoice(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, voiceHandler } = context;

  if (req.method === "POST" && path === "/voice/start") {
    if (!voiceHandler) {
      sendJson(res, 503, { error: "voice não habilitado (defina VOICE_ENABLED=true)" });
      return true;
    }
    try {
      const parsed = await readJson(req);
      const soulId: string = (parsed.body?.soul as string) ?? "";

      // Configura o handler de chat com a soul do request (ou sem handler se soul não informada)
      const soul = soulId ? getSoul(home, soulId) : null;
      if (soul) {
        voiceHandler.setOnChat(async (prompt: string) => {
          const config = loadConfig({ home });
          const built = await buildPrompt({ home, soul, prompt, config });
          const pool = getPool(config.databaseUrl);
          const decision = await route(pool, config, soul, makeLocalFallbackProbe(config.ollamaUrl), config.routerTiers);
          const model = soul.config.models?.chat ?? decision.target.model ?? "local";
          const result = await run!(built.fullPrompt, {
            cwd: soul.dir,
            model,
            timeoutSeconds: 120,
            agent: soul.config.agent ? soul.id : undefined,
            soulId: soul.id,
          });
          return result.stdout || "(sem resposta)";
        });
      }

      await voiceHandler.start();
      sendJson(res, 200, { ok: true, message: "pipeline de voz iniciado" });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (req.method === "POST" && path === "/voice/stop") {
    if (!voiceHandler) {
      sendJson(res, 503, { error: "voice não habilitado" });
      return true;
    }
    voiceHandler.stop();
    sendJson(res, 200, { ok: true, message: "pipeline de voz parado" });
    return true;
  }

  if (req.method === "GET" && path === "/voice/status") {
    if (!voiceHandler) {
      sendJson(res, 200, { enabled: false, running: false });
      return true;
    }
    sendJson(res, 200, { enabled: true, running: voiceHandler.isRunning });
    return true;
  }

  return false;
}
