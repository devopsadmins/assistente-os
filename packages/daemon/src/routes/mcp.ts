import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "../mcp/kernel.js";
import { sendJson, readJson, type RequestContext } from "./shared.js";
import { getRequestAccountId, getRequestApiKeyScopes } from "./accountAuth.js";
import { MCP_TOOL_CATALOG } from "./catalog.js";

/**
 * `POST /mcp` — JSON-RPC 2.0 sobre HTTP pro kernel MCP (Fase 2 do plano de
 * engine headless, docs/ENGINE-API.md). Uma requisição, uma resposta — não é
 * o streamable-HTTP completo da spec MCP (sem stream SSE de servidor, sem
 * sessão resumível); suficiente pra `tools/list`/`tools/call` de um cliente
 * app, que é o caso de uso real hoje. Upgrade pra streamable-HTTP fica pra
 * quando um cliente MCP de verdade (não o app próprio) precisar.
 *
 * **Admin-only, de propósito** (mesmo padrão de `/admin/*`/`/familias/*`):
 * o kernel MCP não tem noção de `ownerAccountId` — só allowlist de tool por
 * soul (`soul.config.agent.permissions.tools`), pensado pra um operador
 * confiável rodando localmente (Claude Desktop/opencode via stdio). Abrir
 * pra sessão de conta self-service deixaria uma conta chamar `graph_walk`/
 * `soul_chat`/etc. contra a soul de OUTRA conta — mesma classe de vazamento
 * que a Fase 5 fechou em `GET /souls/:id`, só que pior (execução, não só
 * leitura). Um app cliente independente usa uma **chave de API de serviço**
 * (`account_id` nulo, escopo `mcp` ou `mcp:<família>`) — não uma sessão de
 * conta nem uma chave presa a conta.
 */
export async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (path !== "/mcp" || req.method !== "POST") return false;

  if (getRequestAccountId(req) != null) {
    sendJson(res, 403, { error: "rota exclusiva do token admin ou de chave de API de serviço (sem conta)" });
    return true;
  }

  const { body, error } = await readJson(req);
  if (error || body === null) {
    sendJson(res, error === "too_large" ? 413 : 400, { error: "corpo JSON-RPC inválido ou ausente" });
    return true;
  }

  const method = typeof body.method === "string" ? body.method : "";
  if (method === "tools/call") {
    const params = body.params as { name?: unknown } | undefined;
    const toolName = typeof params?.name === "string" ? params.name : "";
    if (!scopeAllowsTool(getRequestApiKeyScopes(req), toolName)) {
      sendJson(res, 403, { error: `chave de API sem escopo pra tool '${toolName}'`, code: "E_AUTHZ" });
      return true;
    }
  }

  const server = getMcpServer(context.home);
  const result = await server.handleMessage(body);
  if (result === null) {
    // notificação JSON-RPC (initialize/cancelled/progress): sem corpo de resposta.
    res.writeHead(204);
    res.end();
    return true;
  }
  sendJson(res, 200, result);
  return true;
}

/**
 * `undefined` = não autenticado por chave de API (token admin — sem
 * restrição extra). `*`/`admin`/`mcp` = qualquer tool. `mcp:<família>` =
 * só as tools daquela família (`MCP_TOOL_CATALOG`).
 */
function scopeAllowsTool(scopes: readonly string[] | undefined, toolName: string): boolean {
  if (!scopes) return true;
  if (scopes.includes("*") || scopes.includes("admin") || scopes.includes("mcp")) return true;
  const family = MCP_TOOL_CATALOG.find((t) => t.name === toolName)?.family;
  return !!family && scopes.includes(`mcp:${family}`);
}

// Uma instância por `home` — evita reconstruir loadConfig() a cada
// requisição; o McpServer em si não guarda estado por-chamada.
const serversByHome = new Map<string, McpServer>();

function getMcpServer(home: string): McpServer {
  let server = serversByHome.get(home);
  if (!server) {
    server = new McpServer({ home });
    serversByHome.set(home, server);
  }
  return server;
}
