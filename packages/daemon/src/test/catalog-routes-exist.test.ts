/**
 * Fase 5 do plano de engine headless (docs/ENGINE-API.md): guard de drift na
 * outra direção do `mcp-catalog.test.ts` (que compara `TOOLS` real × catálogo
 * de tools) — aqui é `REST_ROUTES` × dispatch real de `server.ts`.
 *
 * Achado que motivou este teste: três entradas em `REST_ROUTES` (herdadas
 * sem verificar da lista antiga mantida à mão em `llms-txt.ts`, que a Fase 0
 * deveria ter substituído) não correspondiam a NENHUM handler real —
 * `GET /graph/:soulId`, `GET /memory/status`, `POST /memory/search` — só
 * existiam com o soul no path (`/souls/:id/graph` etc.). O catálogo é
 * documentação viva (`/llms.txt`, `/api/capabilities`, `/api/openapi.json`);
 * uma entrada fantasma vaza pra fora do repo. Removidas; este teste garante
 * que uma rota GET catalogada sempre bate com um handler de verdade — sem
 * criar souls/threads/etc., só distinguindo "a rota existe e disse
 * not-found/negou" (mensagem específica do handler) de "nenhum handler
 * reconheceu esse path" (fallback genérico de `handle()` em server.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";
import { REST_ROUTES } from "../routes/catalog.js";

const ADMIN_TOKEN = "admin-test-token";
// Só dígitos: satisfaz tanto os regex `(\d+)` (threadId, agenda/monitor/familia
// id) quanto os `[^/]+`/`[A-Za-z0-9-]{8,64}` mais soltos (soul id, /trace/:id).
// 12 dígitos cobre o mínimo de 8 chars do trace.
const PLACEHOLDER = "123456789012";

test("toda rota GET catalogada bate com um handler real (não cai no fallback 404 genérico)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-routecheck-"));
  const db = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const getRoutes = REST_ROUTES.filter((r) => r.method === "GET");
    assert.ok(getRoutes.length >= 30, `esperava >= 30 rotas GET catalogadas, achei ${getRoutes.length}`);

    for (const route of getRoutes) {
      const concretePath = route.path.replace(/:[A-Za-z0-9_]+/g, PLACEHOLDER);
      const res = await fetch(`${base}${concretePath}`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
      const body: unknown = await res.json().catch(() => null);
      const generic =
        res.status === 404 &&
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        (body as { error: unknown }).error === `rota não encontrada: GET ${concretePath}`;
      assert.ok(
        !generic,
        `${route.method} ${route.path} (${concretePath}) não bate com nenhum handler real — entrada fantasma no catálogo?`,
      );
    }
  } finally {
    await daemon.close();
    await db.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
