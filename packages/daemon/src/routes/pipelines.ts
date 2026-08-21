import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, type RequestContext } from "./shared.js";

/** Pipelines de ingestão de conhecimento: email e reunião. */
export async function handlePipelines(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  // ── Email → Knowledge Pipeline ───────────────────────────────────────
  if (req.method === "POST" && path === "/api/pipelines/email-ingest") {
    try {
      const { emailIngestPipeline } = await import("../pipelines/email-ingest.js");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { rawEmailBody } = JSON.parse(body);
          const result = await emailIngestPipeline(rawEmailBody);
          sendJson(res, 200, {
            status: "completed",
            conhecimentoPath: result.conhecimentoPath,
            topicos: result.extractionResult.topicos.length,
            decisoes: result.extractionResult.decisoes.length,
            acoes: result.extractionResult.acoes.length,
            lições: result.extractionResult.licoes?.length || 0,
          });
        } catch (err) {
          console.error("Email ingest error:", err);
          sendJson(res, 500, { error: "Pipeline failed" });
        }
      });
      sendJson(res, 202, { status: "queued", message: "Pipeline email iniciada" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return true;
  }

  // ── Meeting Ingest Pipeline ──────────────────────────────────────────
  if (req.method === "POST" && path === "/api/pipelines/meeting-ingest") {
    try {
      const { meetingIngestPipeline } = await import("../pipelines/meeting-ingest.js");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { filePath } = JSON.parse(body);
          const result = await meetingIngestPipeline(filePath);
          sendJson(res, 200, {
            status: "completed",
            meetingPath: result.meetingPath,
            decisoes: (result.meetingPayload.decisoes ?? []).length,
            acoes: (result.meetingPayload.acoes ?? []).length,
            objeccoes: (result.meetingPayload.objeccoes ?? []).length,
            resumo: (result.meetingPayload.resumo ?? "").slice(0, 60) + "...",
          });
        } catch (err) {
          console.error("Meeting ingest error:", err);
          sendJson(res, 500, { error: "Pipeline failed" });
        }
      });
      sendJson(res, 202, { status: "queued", message: "Pipeline meeting iniciada" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return true;
  }

  return false;
}
