/**
 * Rotas REST do Mission Runner (ORCA).
 *
 *   GET  /api/missions            -> lista missões declaradas
 *   POST /api/missions/:id/run    -> executa a missão (síncrono); body { soul? }
 *
 * Missões `full` transmitem `mission.step` via WebSocket durante a execução.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { sendJson, parseBody, optionalTrimmedString, type RouteHandler } from "./shared.js";
import { listMissions, runMission } from "../orchestrator/mission-runner.js";

const RunMissionSchema = z.object({ soul: optionalTrimmedString() });

export const handleMissions: RouteHandler = async (req, res, url, path, context) => {
  if (path === "/api/missions" && req.method === "GET") {
    sendJson(res, 200, { missions: listMissions() });
    return true;
  }

  const runMatch = path.match(/^\/api\/missions\/([^/]+)\/run$/);
  if (runMatch && req.method === "POST") {
    const missionId = decodeURIComponent(runMatch[1]!);
    const parsed = await parseBody(req, RunMissionSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const soul = parsed.data.soul ?? undefined;
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
