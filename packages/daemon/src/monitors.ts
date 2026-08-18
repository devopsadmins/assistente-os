import { loadConfig, getPool, listMonitors, updateMonitorResult, type MonitorRecord } from "@assistente-os/core";

/**
 * Verifica todos os sites monitorados com um GET e timeout curto.
 * Devolve a lista atualizada; cada registro leva status up/down + latência.
 */
export async function checkMonitors(home: string): Promise<MonitorRecord[]> {
  const config = loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const monitors = await listMonitors(pool);
  for (const m of monitors) {
    const started = Date.now();
    try {
      const res = await fetch(m.url, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": "assistente-os-monitor" },
        signal: AbortSignal.timeout(5000),
      });
      const up = m.expectedCode === 0 || res.status === m.expectedCode;
      await updateMonitorResult(pool, m.id, {
        status: up ? "up" : "down",
        latencyMs: Date.now() - started,
        httpCode: res.status,
        lastError: up ? null : `HTTP ${res.status} (esperado ${m.expectedCode})`,
      });
    } catch (err) {
      await updateMonitorResult(pool, m.id, {
        status: "down",
        latencyMs: Date.now() - started,
        httpCode: null,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return listMonitors(pool);
}
