import type { IncomingMessage } from "node:http";
import { loadConfig, getPool, resolveAccountSession, resolveApiKey, type ApiKeyRecord } from "@assistente-os/core";

/**
 * Contexto de conta resolvido pra UMA requisição (modo amigável, Fase 1).
 *
 * `RequestContext` (shared.ts) é construído uma vez no boot do daemon e
 * compartilhado por todas as requisições concorrentes — não dá pra pendurar
 * estado por-requisição nele sem uma corrida entre requisições simultâneas.
 * Um WeakMap chaveado pelo próprio `req` (único por requisição, coletado
 * pelo GC depois) resolve isso sem tocar no tipo `RequestContext`/
 * `RouteHandler` usado por todas as ~20 rotas existentes.
 */
const ACCOUNT_BY_REQ = new WeakMap<IncomingMessage, number>();

/** Chamado só pelo gate central em server.ts, depois de validar a sessão. */
export function setRequestAccountId(req: IncomingMessage, accountId: number): void {
  ACCOUNT_BY_REQ.set(req, accountId);
}

/**
 * accountId da conta autenticada por sessão nesta requisição, ou
 * `undefined` se a requisição veio autenticada pelo token admin (acesso
 * total, sem escopo de conta) ou não exige auth (ex. /health).
 */
export function getRequestAccountId(req: IncomingMessage): number | undefined {
  return ACCOUNT_BY_REQ.get(req);
}

export function bearerToken(req: IncomingMessage): string {
  const auth = req.headers.authorization;
  return typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

/**
 * Chamado pelo gate central em server.ts quando o Bearer recebido NÃO bate
 * com o token admin — tenta resolvê-lo como sessão de conta. `null` = nem
 * admin nem conta válida (a chamadora decide 401).
 */
export async function resolveAccountBearer(bearer: string, home: string): Promise<number | null> {
  if (!bearer) return null;
  const pool = getPool(loadConfig({ home }).databaseUrl);
  const session = await resolveAccountSession(pool, bearer);
  return session?.accountId ?? null;
}

/**
 * Chamado pelo gate central em server.ts quando o Bearer NÃO bate com o token
 * admin — tenta resolvê-lo como chave de API com escopo (prefixo `aos_`).
 * `null` = não é uma chave válida/ativa; o gate então tenta o caminho de
 * sessão de conta antes de recusar.
 */
export async function resolveApiKeyBearer(bearer: string, home: string): Promise<ApiKeyRecord | null> {
  if (!bearer) return null;
  const pool = getPool(loadConfig({ home }).databaseUrl);
  return resolveApiKey(pool, bearer);
}
