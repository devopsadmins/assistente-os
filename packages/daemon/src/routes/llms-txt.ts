import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, listSouls } from "@assistente-os/core";
import type { RequestContext } from "./shared.js";
import {
  REST_ROUTES,
  SSE_EVENTS,
  WS_EVENT_TYPES,
  ERROR_CODES,
  MCP_TOOL_CATALOG,
  CLI_ONLY_VERBS,
  SERVER_VERSION,
} from "./catalog.js";

/**
 * `GET /llms.txt`, `GET /api/capabilities` e `GET /api/openapi.json` derivam
 * TODOS de `routes/catalog.ts` — a fonte única de verdade do contrato HTTP.
 * Não repita listas de rota/tool aqui.
 */

function buildLlmsTxt(home: string): string {
  const souls = listSouls(home);
  const byDomain = new Map<string, typeof REST_ROUTES[number][]>();
  for (const r of REST_ROUTES) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }

  const routeLines: string[] = [];
  for (const [domain, routes] of byDomain) {
    routeLines.push("", `### ${domain}`);
    for (const r of routes) {
      routeLines.push(`- \`${r.method} ${r.path}\` — ${r.description} _(auth: ${r.auth}${r.streaming ? ", SSE" : ""})_`);
    }
  }

  const toolsByFamily = new Map<string, typeof MCP_TOOL_CATALOG[number][]>();
  for (const t of MCP_TOOL_CATALOG) {
    const arr = toolsByFamily.get(t.family) ?? [];
    arr.push(t);
    toolsByFamily.set(t.family, arr);
  }
  const toolLines: string[] = [];
  for (const [family, tools] of toolsByFamily) {
    toolLines.push("", `### ${family}`);
    for (const t of tools) toolLines.push(`- **${t.name}**: ${t.description}`);
  }

  return [
    "# terrasIA",
    "",
    'Copiloto residente API-first, local-first. Cada "soul" é um perfil vivo de',
    "conhecimento (markdown canônico + RAG derivado em pgvector). Este documento",
    "é gerado de `routes/catalog.ts` para ingestão headless por agentes externos.",
    "",
    `Versão do servidor: ${SERVER_VERSION}`,
    "",
    "## Rotas REST + WebSocket",
    ...routeLines,
    "",
    "## Eventos SSE (POST /souls/:id/threads/:threadId/messages/stream)",
    "",
    ...SSE_EVENTS.map((e) => `- \`${e.type}\` — ${e.description}`),
    "",
    "## Eventos do hub WebSocket",
    "",
    ...WS_EVENT_TYPES.map((t) => `- \`${t}\``),
    "",
    "## Catálogo de MCP Tools",
    ...toolLines,
    "",
    "## Códigos de erro estáveis",
    "",
    ...ERROR_CODES.map((e) => `- \`${e.code}\` (HTTP ${e.httpStatus}) — ${e.description}`),
    "",
    "## Verbos só-CLI (ainda sem rota HTTP — Fase 3 do plano de engine)",
    "",
    ...CLI_ONLY_VERBS.map((v) => `- \`os ${v.verb}\` — ${v.description}${v.remoteViable ? "" : " _(local; não faz sentido remoto)_"}`),
    "",
    "## Souls registradas",
    "",
    ...(souls.length
      ? souls.map((s) => `- \`${s.id}\`${s.config.description ? ` — ${s.config.description}` : ""}`)
      : ["_nenhuma soul registrada_"]),
    "",
    "## Autenticação",
    "",
    "`Authorization: Bearer <…>` com uma de três credenciais: token admin",
    "(`ASSISTENTE_OS_DAEMON_TOKEN`, abre tudo); sessão de conta (token de",
    "`/auth/login`); ou chave de API `aos_…` (criada em `POST /admin/api-keys`,",
    "limitada aos escopos concedidos — `*`, um `domain` de rota, ou",
    "`<domain>:read`/`:write`). `/health` é público; `auth: admin` exige token",
    "admin ou chave com escopo `admin`; `auth: hmac` são webhooks assinados. O",
    "WebSocket aceita o token via `?token=` na URL. CORS: opt-in via",
    "`ASSISTENTE_OS_CORS_ORIGINS`.",
    "",
  ].join("\n");
}

/** GET /llms.txt — catálogo do sistema em markdown. */
export async function handleLlmsTxt(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "GET" || path !== "/llms.txt") return false;
  const config = loadConfig({ home: context.home });
  res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
  res.end(buildLlmsTxt(config.home));
  return true;
}

/** GET /api/capabilities — contrato consolidado em JSON. */
export async function handleCapabilities(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "GET" || path !== "/api/capabilities") return false;

  const config = loadConfig({ home: context.home });
  const souls = listSouls(config.home);

  const capabilities = {
    system: { name: "terrasIA", version: SERVER_VERSION, localFirst: true },
    souls: souls.map((s) => ({ id: s.id, name: s.config.name, description: s.config.description })),
    restEndpoints: REST_ROUTES,
    sseEvents: SSE_EVENTS,
    wsEvents: WS_EVENT_TYPES,
    mcpTools: MCP_TOOL_CATALOG,
    errorCodes: ERROR_CODES,
    cliOnlyVerbs: CLI_ONLY_VERBS,
  };

  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(capabilities, null, 2));
  return true;
}

/** Converte `/souls/:id/threads/:threadId` → `/souls/{id}/threads/{threadId}` (OpenAPI). */
function toOpenApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const openApiPath = path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path: openApiPath, params };
}

/** GET /api/openapi.json — OpenAPI 3.1 mínimo gerado de REST_ROUTES. */
export async function handleOpenApi(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  _context: RequestContext,
): Promise<boolean> {
  if (req.method !== "GET" || path !== "/api/openapi.json") return false;

  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of REST_ROUTES) {
    if (r.method === "WS") continue;
    const { path: oaPath, params } = toOpenApiPath(r.path);
    const method = r.method.toLowerCase();
    paths[oaPath] ??= {};
    paths[oaPath][method] = {
      summary: r.description,
      tags: [r.domain],
      operationId: `${method}_${oaPath.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      security: r.auth === "public" ? [] : [{ bearerAuth: [] }],
      parameters: params.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      })),
      responses: {
        "200": { description: r.streaming ? "text/event-stream (SSE)" : "OK" },
        "400": { description: "E_VALIDATION" },
        "401": { description: "não autorizado" },
        "403": { description: "E_AUTHZ / escopo insuficiente" },
        "429": { description: "rate limit ou E_BUDGET" },
      },
    };
  }

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "terrasIA — assistente-os engine",
      version: SERVER_VERSION,
      description: "Gerado de packages/daemon/src/routes/catalog.ts. Ver docs/ENGINE-API.md.",
    },
    servers: [{ url: "http://127.0.0.1:4310" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Token admin ou sessão de conta." },
      },
    },
    paths,
  };

  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(spec, null, 2));
  return true;
}
