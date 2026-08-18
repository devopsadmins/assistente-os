import type { Pool } from "pg";
import { nowIso } from "./costs.js";

export interface MonitorRecord {
  id: number;
  ts: string;
  name: string;
  url: string;
  expectedCode: number;
  status: "unknown" | "checking" | "up" | "down";
  latencyMs: number | null;
  httpCode: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
}

export interface AddMonitorInput {
  name: string;
  url: string;
  expectedCode?: number;
}

export async function addMonitor(pool: Pool, input: AddMonitorInput): Promise<MonitorRecord> {
  const { rows } = await pool.query(
    `INSERT INTO monitors (ts, name, url, expected_code, status, latency_ms, http_code, last_error, last_checked_at)
     VALUES ($1, $2, $3, $4, 'unknown', NULL, NULL, NULL, NULL)
     RETURNING *`,
    [nowIso(), input.name, input.url, input.expectedCode ?? 200],
  );
  return rowToMonitor(rows[0]);
}

export async function listMonitors(pool: Pool): Promise<MonitorRecord[]> {
  const { rows } = await pool.query("SELECT * FROM monitors ORDER BY id ASC");
  return rows.map(rowToMonitor);
}

export async function getMonitor(pool: Pool, id: number): Promise<MonitorRecord | null> {
  const { rows } = await pool.query("SELECT * FROM monitors WHERE id = $1", [id]);
  return rows[0] ? rowToMonitor(rows[0]) : null;
}

export async function deleteMonitor(pool: Pool, id: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM monitors WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function updateMonitorResult(
  pool: Pool,
  id: number,
  result: { status: "up" | "down" | "unknown"; latencyMs?: number | null; httpCode?: number | null; lastError?: string | null },
): Promise<void> {
  await pool.query(
    `UPDATE monitors SET status = $1, latency_ms = $2, http_code = $3, last_error = $4, last_checked_at = $5 WHERE id = $6`,
    [result.status, result.latencyMs ?? null, result.httpCode ?? null, result.lastError ?? null, nowIso(), id],
  );
}

function rowToMonitor(row: Record<string, unknown>): MonitorRecord {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    name: String(row.name),
    url: String(row.url),
    expectedCode: Number(row.expected_code),
    status: String(row.status) as MonitorRecord["status"],
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    httpCode: row.http_code == null ? null : Number(row.http_code),
    lastError: row.last_error == null ? null : String(row.last_error),
    lastCheckedAt: row.last_checked_at == null ? null : String(row.last_checked_at),
  };
}
