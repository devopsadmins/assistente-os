import type { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { nowIso } from "./costs.js";
import { AssistenteOsError } from "./errors.js";

/**
 * Chaves de API com escopo — a 3ª credencial aceita pelo daemon, além do
 * token admin único (abre tudo) e da sessão de conta (modo amigável). Uma
 * chave é uma credencial NÃO-admin com uma allowlist explícita de escopos,
 * revogável, opcionalmente presa a uma conta.
 *
 * Pensada para uma aplicação cliente independente na LAN consumir o motor
 * sem carregar o token mestre nem uma sessão de login de 30 dias.
 * Ver docs/ENGINE-API.md.
 */

/** Prefixo do texto em claro — ajuda a reconhecer a chave num .env / header. */
const KEY_PREFIX = "aos_";

export interface ApiKeyRecord {
  /** sha256(chave em claro) em hex. NÃO é segredo — a chave em claro só sai de createApiKey. */
  keyHash: string;
  label: string;
  scopes: string[];
  /** Conta dona (herda o escopo de posse de soul). null = chave de serviço/operador. */
  accountId: number | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function rowToApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    keyHash: String(row.key_hash),
    label: String(row.label),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    accountId: row.account_id == null ? null : Number(row.account_id),
    createdAt: String(row.created_at),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    lastUsedAt: row.last_used_at == null ? null : String(row.last_used_at),
  };
}

export interface CreateApiKeyInput {
  label: string;
  scopes: string[];
  accountId?: number | null;
  /** dias até expirar; ausente/0 = sem expiração. */
  expiresInDays?: number;
}

/** Cria a chave e devolve o texto em claro UMA vez (só aqui). Grava só o hash. */
export async function createApiKey(pool: Pool, input: CreateApiKeyInput): Promise<{ key: string; record: ApiKeyRecord }> {
  const label = input.label?.trim();
  if (!label) throw new AssistenteOsError("E_VALIDATION", "label é obrigatório");
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new AssistenteOsError("E_VALIDATION", "scopes deve ter ao menos um escopo (use ['*'] para acesso total)");
  }
  const raw = KEY_PREFIX + randomBytes(32).toString("hex");
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
  const { rows } = await pool.query(
    `INSERT INTO api_keys (key_hash, label, scopes, account_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [hashApiKey(raw), label, input.scopes, input.accountId ?? null, nowIso(), expiresAt],
  );
  return { key: raw, record: rowToApiKey(rows[0]) };
}

/** Lista as chaves (sem o texto em claro, que não existe mais). Inclui revogadas/expiradas. */
export async function listApiKeys(pool: Pool): Promise<ApiKeyRecord[]> {
  const { rows } = await pool.query("SELECT * FROM api_keys ORDER BY created_at DESC");
  return rows.map(rowToApiKey);
}

/**
 * null = chave ausente / revogada / expirada. Não lança — caminho quente de
 * toda requisição autenticada por chave. Best-effort em last_used_at (não
 * bloqueia a resolução se a UPDATE falhar).
 */
export async function resolveApiKey(pool: Pool, raw: string): Promise<ApiKeyRecord | null> {
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
  const { rows } = await pool.query("SELECT * FROM api_keys WHERE key_hash = $1", [hashApiKey(raw)]);
  const row = rows[0];
  if (!row) return null;
  const record = rowToApiKey(row);
  if (record.revokedAt) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return null;
  pool
    .query("UPDATE api_keys SET last_used_at = $1 WHERE key_hash = $2", [nowIso(), record.keyHash])
    .catch(() => {
      /* telemetria de uso é best-effort */
    });
  return record;
}

/** Revoga por key_hash (o valor devolvido por listApiKeys). Idempotente. false = não encontrada. */
export async function revokeApiKey(pool: Pool, keyHash: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE api_keys SET revoked_at = $1 WHERE key_hash = $2 AND revoked_at IS NULL",
    [nowIso(), keyHash],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Um escopo é `*` (tudo, inclusive admin), um domínio (`chat`, `souls`,
 * `memory`, `admin`, …, os valores de `domain` em REST_ROUTES), ou
 * `<domínio>:read` / `<domínio>:write`.
 *
 * Domínio `mcp` (Fase 2, `POST /mcp`) é especial: QUALQUER `mcp:<família>`
 * já basta pra alcançar a rota — o refinamento por família de verdade
 * (guardian, souls, browser, …) é feito de novo, com precisão, DENTRO de
 * `routes/mcp.ts` (`scopeAllowsTool`), porque só ali dá pra ver qual tool o
 * corpo JSON-RPC está chamando. Sem este caso especial, uma chave com só
 * `mcp:souls` (sem o `mcp` genérico) nunca alcançaria `/mcp` — o gate
 * genérico de domínio não entende sufixo de família, só `:read`/`:write`.
 */
export function scopeAllows(scopes: readonly string[], domain: string, method: string): boolean {
  if (scopes.includes("*")) return true;
  const isRead = method.toUpperCase() === "GET";
  for (const s of scopes) {
    if (s === domain) return true;
    if (s === `${domain}:read` && isRead) return true;
    if (s === `${domain}:write` && !isRead) return true;
    if (domain === "mcp" && s.startsWith("mcp:")) return true;
  }
  return false;
}
