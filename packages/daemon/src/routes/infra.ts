import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { loadConfig, getPool, eventStats, listMonitors, listExecutions } from "@assistente-os/core";
import { sendJson, type RequestContext } from "./shared.js";

/** GET /infra/status — snapshot de saúde do daemon (Ollama, Postgres, sistema, RAG, eventos, monitores). */
export async function handleInfra(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  if (req.method === "GET" && path === "/infra/status") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const { listSouls } = await import("@assistente-os/core");
    const souls = listSouls(home).map((s) => s.id);

    /* --- Ollama --- */
    let ollamaOk = false;
    let ollamaLatencyMs: number | null = null;
    let ollamaModels = 0;
    try {
      const t0 = Date.now();
      const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      ollamaOk = r.ok;
      ollamaLatencyMs = Date.now() - t0;
      if (r.ok) {
        const data = (await r.json()) as { models?: unknown[] };
        ollamaModels = data.models?.length ?? 0;
      }
    } catch {
      ollamaOk = false;
    }

    /* --- Postgres --- */
    const { rows: sizeRows } = await pool.query<{ bytes: string }>("SELECT pg_database_size(current_database()) AS bytes");
    const pgKernelBytes = Number(sizeRows[0]?.bytes ?? 0);
    let pgVersion = "";
    let pgTables = 0;
    let pgConnections = 0;
    try {
      const [verRows, tblRows, connRows] = await Promise.all([
        pool.query<{ version: string }>("SELECT version() AS version"),
        pool.query<{ count: string }>("SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public'"),
        pool.query<{ count: string }>("SELECT count(*) AS count FROM pg_stat_activity WHERE state = 'active'"),
      ]);
      pgVersion = verRows.rows[0]?.version ?? "";
      pgTables = Number(tblRows.rows[0]?.count ?? 0);
      pgConnections = Number(connRows.rows[0]?.count ?? 0);
    } catch {
      /* best-effort */
    }

    /* --- memory.db (SQLite fallback file) --- */
    let memoryBytes = 0;
    try {
      const sqlitePath = join(home, "memory.db");
      if (existsSync(sqlitePath)) {
        const st = await stat(sqlitePath);
        memoryBytes = st.size;
      }
    } catch {
      /* ignore */
    }

    /* --- Linux / sistema --- */
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    const cpuModel = cpus[0]?.model ?? "unknown";
    const loadAvg = os.loadavg(); // [1min, 5min, 15min]
    const ramTotal = os.totalmem();
    const ramFree = os.freemem();
    const ramUsed = ramTotal - ramFree;
    const cpuPercent = cpuCount > 0 ? Math.round(((loadAvg[0] ?? 0) / cpuCount) * 1000) / 10 : 0;
    let diskUsed = 0;
    let diskTotal = 0;
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync("df", ["-B1", "/"]);
      const lines = stdout.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1]!.trim().split(/\s+/);
        diskTotal = Number(parts[1]) || 0;
        diskUsed = Number(parts[2]) || 0;
      }
    } catch {
      /* ignore */
    }

    /* --- RAG --- */
    let ragChunks = 0;
    try {
      const { rows: chunkRows } = await pool.query<{ count: string }>("SELECT count(*) AS count FROM chunks");
      ragChunks = Number(chunkRows[0]?.count ?? 0);
    } catch {
      /* chunks table may not exist yet */
    }

    sendJson(res, 200, {
      ok: true,
      service: "assistente-os",
      ts: new Date().toISOString(),
      daemon: { tier: "local" },
      souls: { total: souls.length, ids: souls },
      ollama: { ok: ollamaOk, url: config.ollamaUrl, latencyMs: ollamaLatencyMs, models: ollamaModels },
      databases: { kernelBytes: pgKernelBytes, memoryBytes },
      postgres: { version: pgVersion, tables: pgTables, connections: pgConnections },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        uptime: Math.round(os.uptime()),
        cpuModel,
        cpuCount,
        cpuPercent,
        loadAvg: loadAvg.map((v) => Math.round(v * 100) / 100),
        ramUsed,
        ramTotal,
        diskUsed,
        diskTotal,
      },
      rag: { chunks: ragChunks },
      router: { tiers: config.routerTiers },
      events: await eventStats(pool),
      monitors: await listMonitors(pool),
      executions: await listExecutions(pool, undefined, 5),
    });
    return true;
  }

  return false;
}
