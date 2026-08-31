import type { Pool } from "pg";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { nowIso } from "./costs.js";
import { AssistenteOsError } from "./errors.js";

/**
 * Contas de cliente self-service (modo amigável, Fase 0 —
 * ver docs/PLANO-CRIACAO-SOULS.md e o plano de UI multi-tenant).
 *
 * Caminho de autenticação PARALELO ao token admin único
 * (ASSISTENTE_OS_DAEMON_TOKEN) — não o substitui nem o enfraquece. O token
 * admin continua abrindo tudo (modo especialista); uma sessão de conta só
 * autoriza as rotas do modo amigável, escopadas às próprias souls da conta
 * (escopo aplicado pelas rotas que chamam resolveAccountSession, não aqui).
 */

export interface AccountRecord {
  id: number;
  email: string;
  createdAt: string;
}

export interface AccountSession {
  token: string;
  accountId: number;
  expiresAt: string;
}

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_DAYS = 30;

/** `scrypt` nativo (node:crypto) — sem dependência nova de hashing de senha. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rowToAccount(row: Record<string, unknown>): AccountRecord {
  return {
    id: Number(row.id),
    email: String(row.email),
    createdAt: String(row.created_at),
  };
}

/**
 * Cria a conta. `E_VALIDATION` se o e-mail já existe (unique constraint) ou
 * se a senha for curta demais — validação mínima de servidor, a rota decide
 * a mensagem final ao cliente.
 */
export async function createAccount(pool: Pool, email: string, password: string): Promise<AccountRecord> {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) throw new AssistenteOsError("E_VALIDATION", "e-mail inválido");
  if (password.length < 8) throw new AssistenteOsError("E_VALIDATION", "senha precisa ter ao menos 8 caracteres");
  try {
    const { rows } = await pool.query(
      "INSERT INTO accounts (email, password_hash, created_at) VALUES ($1, $2, $3) RETURNING *",
      [normalized, hashPassword(password), nowIso()],
    );
    return rowToAccount(rows[0]);
  } catch (err) {
    // 23505 = unique_violation (Postgres) — e-mail já cadastrado.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AssistenteOsError("E_VALIDATION", "e-mail já cadastrado");
    }
    throw err;
  }
}

/** null = credenciais inválidas (não distingue "e-mail não existe" de "senha errada" — evita enumeração). */
export async function verifyLogin(pool: Pool, email: string, password: string): Promise<AccountRecord | null> {
  const { rows } = await pool.query("SELECT * FROM accounts WHERE email = $1", [normalizeEmail(email)]);
  const row = rows[0];
  if (!row || !verifyPassword(password, String(row.password_hash))) return null;
  return rowToAccount(row);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Gera um token de sessão novo (devolvido em claro só nesta resposta) e grava só o hash. */
export async function createAccountSession(pool: Pool, accountId: number): Promise<AccountSession> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    "INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [hashToken(token), accountId, nowIso(), expiresAt],
  );
  return { token, accountId, expiresAt };
}

/** null = token ausente/inválido/expirado. Não lança — chamado no caminho quente de toda requisição autenticada por conta. */
export async function resolveAccountSession(pool: Pool, token: string): Promise<{ accountId: number } | null> {
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT account_id, expires_at FROM account_sessions WHERE token_hash = $1",
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) return null;
  return { accountId: Number(row.account_id) };
}

export async function deleteAccountSession(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM account_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function getAccountById(pool: Pool, accountId: number): Promise<AccountRecord | null> {
  const { rows } = await pool.query("SELECT * FROM accounts WHERE id = $1", [accountId]);
  return rows[0] ? rowToAccount(rows[0]) : null;
}
