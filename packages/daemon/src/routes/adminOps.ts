import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { loadConfig, auditExecution } from "@assistente-os/core";
import { sendJson, parseBody, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";
import { createFullBackup, pruneOldBackups } from "../backup.js";

const BACKUP_RETENTION_DAYS = 7;

const DiscriminatorSchema = z.object({
  changesSummary: z.string().trim().min(1, "changesSummary é obrigatório (commits/stat/diff a julgar)"),
  taskId: z.string().trim().optional(),
  targetAgent: z.string().trim().optional(),
  testResults: z.string().optional(),
});

/**
 * Verbos operacionais hoje só na CLI, agora também por HTTP (Fase 3 do plano
 * de engine headless — docs/ENGINE-API.md) — `POST /admin/backup`,
 * `POST /admin/discriminator`. Exclusivas do token admin (ou chave de API
 * com escopo `admin`/`*`), mesma forma de adminPlans.ts/adminApiKeys.ts.
 *
 * `os migrate`/`os import-sc` ficam de fora de propósito: leem um caminho no
 * FILESYSTEM DE QUEM RODA A CLI, não faz sentido como upload remoto sem um
 * desenho próprio. `os trace`/`os manifest` já tinham GET /trace/:id e
 * GET /api/manifest — só formatam a mesma leitura, não precisam de rota nova.
 */
export async function handleAdminOps(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (path !== "/admin/backup" && path !== "/admin/discriminator") return false;
  if (req.method !== "POST") return false;

  if (getRequestAccountId(req) != null) {
    sendJson(res, 403, { error: "rota exclusiva do token admin" });
    return true;
  }

  if (path === "/admin/backup") {
    const config = loadConfig({ home: context.home });
    const backup = await createFullBackup(config.home, config.databaseUrl, config.backupDir);
    const pruned = await pruneOldBackups(config.backupDir, BACKUP_RETENTION_DAYS);
    sendJson(res, 201, {
      path: backup.path,
      bytes: backup.bytes,
      entries: backup.entries,
      pruned,
      warning: "o ZIP pode conter chaves/segredos do .env — trate como confidencial",
    });
    return true;
  }

  // /admin/discriminator — o cliente calcula o próprio resumo de mudanças
  // (commits/stat/diff, como `os discriminator` faz via git local) e manda
  // no corpo; o daemon não tem acesso ao git de quem chama.
  const parsed = await parseBody(req, DiscriminatorSchema);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return true;
  }
  const result = await auditExecution({
    taskId: parsed.data.taskId ?? "remoto",
    targetAgent: parsed.data.targetAgent ?? "desconhecido",
    changesSummary: parsed.data.changesSummary,
    testResults: parsed.data.testResults,
  });
  sendJson(res, 200, { ...result, ts: new Date().toISOString() });
  return true;
}
