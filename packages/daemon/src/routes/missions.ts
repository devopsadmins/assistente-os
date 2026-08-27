/**
 * Rotas REST do Mission Runner (ORCA).
 *
 *   GET  /api/missions            -> lista missões declaradas
 *   POST /api/missions/:id/run    -> executa a missão (síncrono); body { soul? }
 *
 * Missões `full` transmitem `mission.step` via WebSocket durante a execução.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, readJson, type RouteHandler } from "./shared.js";
import { listMissions, runMission } from "../orchestrator/mission-runner.js";

export const handleMissions: RouteHandler = async (req, res, url, path, context) => {
  if (path === "/api/missions" && req.method === "GET") {
    sendJson(res, 200, { missions: listMissions() });
    return true;
  }

  const runMatch = path.match(/^\/api\/missions\/([^/]+)\/run$/);
  if (runMatch && req.method === "POST") {
    const missionId = decodeURIComponent(runMatch[1]!);
    const parsed = await readJson(req);
    const soul =
      parsed.body && typeof parsed.body.soul === "string" && parsed.body.soul.trim()
        ? parsed.body.soul.trim()
        : undefined;
    try {
      const result = await runMission(missionId, {
        soulOverride: soul,
        onStep: (e) => {
          try {
            context.hub.broadcast({
              type: "mission.step",
              ts: Date.now(),
              missionId: e.missionId,
              index: e.index,
              total: e.total,
              stepType: e.type,
              ok: e.ok,
              note: e.note,
            });
          } catch {
            /* ws opcional */
          }
        },
      });
      sendJson(res, result.status === "failed" ? 207 : 200, result);
    } catch (err) {
      sendJson(res, 404, { error: (err as Error).message });
    }
    return true;
  }

  return false;
};
