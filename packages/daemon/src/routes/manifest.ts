/**
 * GET /api/manifest — execution manifest reproduzível (E8.2 / gate AI-3).
 * Autenticado por Bearer via dispatcher.
 */
import type { RouteHandler } from "./shared.js";
import { sendJson } from "./shared.js";
import { loadConfig, getPool, buildExecutionManifest } from "@assistente-os/core";

export const handleManifest: RouteHandler = async (req, res, url, path, context) => {
  if (path !== "/api/manifest" || req.method !== "GET") return false;
  const pool = getPool(loadConfig({ home: context.home }).databaseUrl);
  const manifest = await buildExecutionManifest({ home: context.home, pool });
  sendJson(res, 200, manifest);
  return true;
};
