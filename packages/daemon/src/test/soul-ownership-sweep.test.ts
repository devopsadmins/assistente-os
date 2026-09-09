/**
 * Fase 5 do plano de engine headless (endurecer isolamento — docs/ENGINE-API.md):
 * varredura automática, DERIVADA DE REST_ROUTES, de toda rota GET escopada por
 * soul — não uma lista de casos escrita à mão que fica pra trás quando alguém
 * adiciona uma rota. Achado ao construir isto: `GET /souls/:id` (sem segmento
 * seguinte) escapava do gate central (`soulBelongsToAccount`, server.ts) — o
 * regex antigo exigia uma barra DEPOIS do id, então só cobria `/souls/:id/…`.
 * Uma conta sem nenhuma soul lia o config completo de qualquer soul de
 * qualquer conta só sabendo o id. Corrigido (`(?:\/|$)`); este teste garante
 * que uma regressão futura no regex — ou uma rota nova que escape do gate por
 * algum outro motivo — quebra a suíte, não só o achado manual.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";
import { REST_ROUTES } from "../routes/catalog.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-ownersweep-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Toda rota GET catalogada cujo primeiro segmento variável é a própria soul (`/souls/:id...` ou `/graph/:soulId`). */
function soulScopedGetRoutes(): { method: string; path: string }[] {
  return REST_ROUTES.filter(
    (r) =>
      r.method === "GET" &&
      (r.auth === "token" || r.auth === "account") &&
      (/^\/souls\/:[A-Za-z0-9_]+(\/|$)/.test(r.path) || /^\/graph\/:[A-Za-z0-9_]+$/.test(r.path)),
  );
}

test("catálogo tem rotas GET escopadas por soul suficientes pra varrer (não regride pra lista vazia)", () => {
  const routes = soulScopedGetRoutes();
  assert.ok(routes.length >= 8, `esperava >= 8 rotas GET escopadas por soul, achei ${routes.length}`);
});

test("nenhuma rota GET escopada por soul (derivada de REST_ROUTES) devolve dado de soul de outra conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const jsonFetch = async (url: string, init?: RequestInit): Promise<{ status: number; body: any }> => {
      const res = await fetch(url, init);
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const signup = async (email: string) => {
      const r = await jsonFetch(`${base}/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "senha-forte-123" }),
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return { accountId: r.body.account.id as number, token: r.body.token as string };
    };

    const owner = await signup("dona@exemplo.com");
    const stranger = await signup("estranha@exemplo.com");

    createSoul(home, "alvo", { name: "alvo", ownerAccountId: owner.accountId });
    writeFileSync(join(home, "souls", "alvo", "perfil.md"), "# alvo\n");

    const routes = soulScopedGetRoutes();
    assert.ok(routes.length > 0, "nada pra varrer — provável regressão em soulScopedGetRoutes()");

    for (const route of routes) {
      // troca o primeiro :param pelo id da soul-alvo e qualquer :param
      // remanescente (ex.: :threadId) por um placeholder — o gate central
      // roda ANTES do handler olhar pro sub-recurso, então o placeholder não
      // interfere no que este teste verifica.
      const concretePath = route.path
        .replace(/:[A-Za-z0-9_]+/, "alvo")
        .replace(/:[A-Za-z0-9_]+/g, "1");
      const res = await fetch(`${base}${concretePath}`, { headers: { authorization: `Bearer ${stranger.token}` } });
      assert.equal(
        res.status,
        403,
        `${route.method} ${route.path} (${concretePath}) devolveu ${res.status} pra conta sem relação com a soul — esperava 403`,
      );
    }

    // controle positivo: a própria dona alcança a soul normalmente (confirma
    // que o 403 acima é isolamento, não um bug que bloqueia todo mundo).
    const ownRoute = routes.find((r) => r.path === "/souls/:id");
    if (ownRoute) {
      const ok = await fetch(`${base}/souls/alvo`, { headers: { authorization: `Bearer ${owner.token}` } });
      assert.equal(ok.status, 200);
    }
  } finally {
    await daemon.close();
    await cleanup();
  }
});
