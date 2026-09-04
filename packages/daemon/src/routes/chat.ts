import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "./shared.js";

export { ollamaChatStream, preparePromptContext, type ExecUsage, type PreparedPromptContext, type PreparePromptContextResult } from "../promptPipeline.js";
import { handleChatBuffer } from "./chat/buffer.js";
import { handlePostChat } from "./chat/postChat.js";
import { handleChatLanggraphStatus } from "./chat/langgraphStatus.js";

/** Rotas de execução de prompt: GET /souls/:id/buffer, POST /souls/:id/chat, GET /souls/:id/langgraph/status|history */
export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (await handleChatBuffer(req, res, url, path, context)) return true;
  if (await handlePostChat(req, res, url, path, context)) return true;
  if (await handleChatLanggraphStatus(req, res, url, path, context)) return true;

  return false;
}
