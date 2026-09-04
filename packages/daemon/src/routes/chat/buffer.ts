import type { IncomingMessage, ServerResponse } from "node:http";
import { getSoul, loadConfig } from "@assistente-os/core";
import { buildPrompt } from "../../context.js";
import { sendJson, type RequestContext } from "../shared.js";

export async function handleChatBuffer(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;
  const bufferMatch = path.match(/^\/souls\/([^/]+)\/buffer$/);
  if (!bufferMatch || req.method !== "GET") return false;
  const soul = getSoul(home, decodeURIComponent(bufferMatch[1]!));
  if (!soul) {
    sendJson(res, 404, { error: "soul não encontrada" });
    return true;
  }
  const config = loadConfig({ home });
  const prompt = url.searchParams.get("prompt") ?? "";
  const built = await buildPrompt({ home, soul, prompt, config, withRag: prompt.trim().length > 0 });
  sendJson(res, 200, {
    soul: soul.id,
    builtAt: new Date().toISOString(),
    files: built.files,
    contextChars: built.contextChars,
    tokenEstimate: Math.ceil(built.contextChars / 4),
    ragVerdict: built.verdict,
    systemPrompt: built.fullPrompt,
  });
  return true;
}
