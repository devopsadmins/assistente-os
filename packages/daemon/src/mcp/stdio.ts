import { createInterface } from "node:readline";
import { loadConfig, getPool, runMigrations } from "@assistente-os/core";
import { McpServer } from "./kernel.js";

/**
 * Lê mensagens JSON-RPC de stdin (uma por linha) e responde em stdout —
 * transporte usado pelo binário `os-mcp` (`packages/tools`), consumido por
 * opencode/Claude Desktop. Ver `mcp/http.ts` para o transporte de rede.
 */
export async function startStdio(home: string): Promise<void> {
  const server = new McpServer({ home });
  await runMigrations(getPool(loadConfig({ home }).databaseUrl));
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    void server
      .handleMessage(msg)
      .then((res) => {
        if (res) process.stdout.write(JSON.stringify(res) + "\n");
      })
      .catch(() => {
        /* ignora */
      });
  });
}
