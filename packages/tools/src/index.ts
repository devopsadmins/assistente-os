#!/usr/bin/env node
import { join } from "node:path";
import { loadConfig } from "@assistente-os/core";
import { startStdio } from "@assistente-os/daemon";

/**
 * Binário `os-mcp` — lançador stdio fino do kernel MCP.
 *
 * O kernel (McpServer, TOOLS, FAMILY_HANDLERS, authorizeTool, …) e o próprio
 * transporte stdio (`startStdio`) moraram aqui até a Fase 2 do plano de
 * engine headless (docs/ENGINE-API.md), quando foram realocados pra
 * `packages/daemon/src/mcp/` — `tools` já dependia de `@assistente-os/daemon`
 * (`runOpenCode`, `meetingIngestPipeline`, `createWorktree`, etc.), então o
 * daemon importar `tools` de volta pra montar `/mcp` (transporte HTTP,
 * `routes/mcp.ts`) seria ciclo. Este arquivo só decide "estou sendo rodado
 * como `os-mcp` de verdade?" e, se sim, sobe o stdio.
 */
export { McpServer, TOOLS, FAMILY_HANDLERS, authorizeTool, SERVER_NAME, MCP_SERVER_VERSION, type Tool, type ToolContext, type ToolHandler } from "@assistente-os/daemon";
export { startStdio };

if (process.argv[1] && process.argv[1].endsWith(join("dist", "index.js"))) {
  const config = loadConfig();
  void startStdio(config.home);
}
