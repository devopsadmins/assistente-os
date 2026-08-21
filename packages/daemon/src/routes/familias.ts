import type { IncomingMessage, ServerResponse } from "node:http";
import { getPool, loadConfig, listarFamilias, buscarFamiliaPorId, criarFamilia, contarFamiliasAtivas } from "@assistente-os/core";
import { sendJson, type RequestContext } from "./shared.js";

/** Rotas de famílias (onboarding do canal WhatsApp familiar): /familias, /familias/:id, /familias/:id/onboarding */
export async function handleFamilias(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  if (req.method === "GET" && path === "/familias") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const statusFilter = new URL(req.url ?? "", "http://localhost").searchParams.get("status") ?? undefined;
    const familias = await listarFamilias(pool, statusFilter);
    const ativas = await contarFamiliasAtivas(pool);
    sendJson(res, 200, { total: familias.length, ativas, familias });
    return true;
  }

  const familiaMatch = path.match(/^\/familias\/(\d+)$/);
  if (familiaMatch && req.method === "GET") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const id = Number(familiaMatch[1]);
    const familia = await buscarFamiliaPorId(pool, id);
    if (!familia) {
      sendJson(res, 404, { error: "família não encontrada" });
      return true;
    }
    sendJson(res, 200, familia);
    return true;
  }

  if (req.method === "POST" && path === "/familias") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    let rawBody = "";
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", async () => {
      try {
        const { telefone, nomeFamilia, nomeCrianca } = JSON.parse(rawBody) as {
          telefone?: string;
          nomeFamilia?: string;
          nomeCrianca?: string;
        };
        if (!telefone || !nomeFamilia) {
          return sendJson(res, 400, { error: "telefone e nomeFamilia são obrigatórios" });
        }
        const ativas = await contarFamiliasAtivas(pool);
        if (ativas >= 10) {
          return sendJson(res, 429, { error: "limite de famílias atingido", limite: 10, ativas });
        }
        try {
          const familia = await criarFamilia(pool, telefone, nomeFamilia, nomeCrianca);
          sendJson(res, 201, familia);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("unique")) {
            return sendJson(res, 409, { error: "telefone já cadastrado" });
          }
          throw err;
        }
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return true;
  }

  const onboardingMatch = path.match(/^\/familias\/(\d+)\/onboarding$/);
  if (onboardingMatch && req.method === "GET") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const id = Number(onboardingMatch[1]);
    const familia = await buscarFamiliaPorId(pool, id);
    if (!familia) {
      sendJson(res, 404, { error: "família não encontrada" });
      return true;
    }
    const phaseNames = ["infanto-juvenil", "psicoterapia-familiar"];
    const currentPhase = familia.anamnesePhase;
    const isComplete = currentPhase >= 2;
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, familia.soulId);
    sendJson(res, 200, {
      familia,
      phase: currentPhase,
      phaseName: phaseNames[currentPhase] ?? "concluido",
      complete: isComplete,
      soulExists: !!soul,
    });
    return true;
  }

  return false;
}
