import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { parseBody, sendJson, type RequestContext } from "./shared.js";

// e-mail/senha não têm regra de formato aqui de propósito — `createAccount`/
// `verifyLogin` (packages/core) já validam formato/força; o schema só garante
// que ambos os campos são strings (rejeita número/objeto/ausência com 400 em
// vez de deixar "" passar batido pro core).
const AuthCredentialsSchema = z.object({
  email: z.string(),
  password: z.string(),
});

/**
 * Rotas de conta do modo amigável (Fase 0): POST /auth/signup, POST
 * /auth/login, POST /auth/logout, GET /auth/me.
 *
 * Autenticação PARALELA ao token admin — estas rotas nunca exigem
 * ASSISTENTE_OS_DAEMON_TOKEN (signup/login têm que ser alcançáveis por
 * quem ainda não tem nenhum token). O rate limit por cliente do daemon
 * (server.ts) já se aplica a todas elas, igual a qualquer outra rota.
 */
export async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (!path.startsWith("/auth/")) return false;
  const { home } = context;

  if (req.method === "POST" && path === "/auth/signup") {
    const parsed = await parseBody(req, AuthCredentialsSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const { email, password } = parsed.data;
    const { loadConfig, getPool, createAccount, createAccountSession, isAssistenteOsError } = await import("@assistente-os/core");
    const pool = getPool(loadConfig({ home }).databaseUrl);
    try {
      const account = await createAccount(pool, email, password);
      const session = await createAccountSession(pool, account.id);
      sendJson(res, 201, { account: { id: account.id, email: account.email }, token: session.token, expiresAt: session.expiresAt });
    } catch (err) {
      if (isAssistenteOsError(err)) {
        sendJson(res, 400, { error: err.message, code: err.code });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (req.method === "POST" && path === "/auth/login") {
    const parsed = await parseBody(req, AuthCredentialsSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const { email, password } = parsed.data;
    const { loadConfig, getPool, verifyLogin, createAccountSession } = await import("@assistente-os/core");
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const account = await verifyLogin(pool, email, password);
    if (!account) {
      sendJson(res, 401, { error: "e-mail ou senha incorretos" });
      return true;
    }
    const session = await createAccountSession(pool, account.id);
    sendJson(res, 200, { account: { id: account.id, email: account.email }, token: session.token, expiresAt: session.expiresAt });
    return true;
  }

  if (req.method === "POST" && path === "/auth/logout") {
    const auth = req.headers.authorization;
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token) {
      const { loadConfig, getPool, deleteAccountSession } = await import("@assistente-os/core");
      const pool = getPool(loadConfig({ home }).databaseUrl);
      await deleteAccountSession(pool, token);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && path === "/auth/me") {
    const auth = req.headers.authorization;
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const { loadConfig, getPool, resolveAccountSession, getAccountById } = await import("@assistente-os/core");
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const session = token ? await resolveAccountSession(pool, token) : null;
    if (!session) {
      sendJson(res, 401, { error: "sessão inválida ou expirada" });
      return true;
    }
    const account = await getAccountById(pool, session.accountId);
    if (!account) {
      sendJson(res, 401, { error: "sessão inválida ou expirada" });
      return true;
    }
    sendJson(res, 200, { account: { id: account.id, email: account.email } });
    return true;
  }

  return false;
}
