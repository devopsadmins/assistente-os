import type { Pool } from "pg";
import { nowIso } from "./costs.js";

export interface Familia {
  id: number;
  telefone: string;
  nomeFamilia: string;
  nomeCrianca: string | null;
  soulId: string;
  status: "pendente" | "ativo" | "suspenso";
  anamnesePhase: number;
  questionnaireData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Gera o soulId a partir do telefone.
 * Formato: familia_<telefone> (ex: familia_5511999999999)
 */
export function telefoneToSoulId(telefone: string): string {
  const clean = telefone.replace(/[^0-9]/g, "");
  return `familia_${clean}`;
}

/** Cria uma nova família e retorna o registro. */
export async function criarFamilia(pool: Pool, telefone: string, nomeFamilia: string, nomeCrianca?: string): Promise<Familia> {
  const soulId = telefoneToSoulId(telefone);
  const { rows } = await pool.query<FamiliaRow>(
    `INSERT INTO familias (telefone, nome_familia, nome_crianca, soul_id, status, anamnese_phase, questionnaire_data)
     VALUES ($1, $2, $3, $4, 'pendente', 0, '{}')
     RETURNING *`,
    [telefone, nomeFamilia, nomeCrianca ?? null, soulId],
  );
  const row = rows[0];
  if (!row) throw new Error("falha ao criar família");
  return rowToFamilia(row);
}

/** Busca família pelo telefone. */
export async function buscarFamiliaPorTelefone(pool: Pool, telefone: string): Promise<Familia | null> {
  const { rows } = await pool.query<FamiliaRow>(
    "SELECT * FROM familias WHERE telefone = $1",
    [telefone],
  );
  return rows[0] ? rowToFamilia(rows[0]) : null;
}

/** Busca família pelo ID. */
export async function buscarFamiliaPorId(pool: Pool, id: number): Promise<Familia | null> {
  const { rows } = await pool.query<FamiliaRow>(
    "SELECT * FROM familias WHERE id = $1",
    [id],
  );
  return rows[0] ? rowToFamilia(rows[0]) : null;
}

/** Busca família pelo soulId. */
export async function buscarFamiliaPorSoulId(pool: Pool, soulId: string): Promise<Familia | null> {
  const { rows } = await pool.query<FamiliaRow>(
    "SELECT * FROM familias WHERE soul_id = $1",
    [soulId],
  );
  return rows[0] ? rowToFamilia(rows[0]) : null;
}

/** Atualiza a fase da anamnese e/ou os dados do questionário. */
export async function atualizarAnamnese(
  pool: Pool,
  id: number,
  phase: number,
  data?: Record<string, unknown>,
): Promise<void> {
  if (data !== undefined) {
    await pool.query(
      `UPDATE familias SET anamnese_phase = $1, questionnaire_data = $2, updated_at = $3 WHERE id = $4`,
      [phase, JSON.stringify(data), nowIso(), id],
    );
  } else {
    await pool.query(
      `UPDATE familias SET anamnese_phase = $1, updated_at = $2 WHERE id = $3`,
      [phase, nowIso(), id],
    );
  }
}

/** Marca família como ativa. */
export async function ativarFamilia(pool: Pool, id: number): Promise<void> {
  await pool.query(
    `UPDATE familias SET status = 'ativo', updated_at = $1 WHERE id = $2`,
    [nowIso(), id],
  );
}

/** Lista famílias, opcionalmente filtrando por status. */
export async function listarFamilias(pool: Pool, status?: string): Promise<Familia[]> {
  const { rows } = status
    ? await pool.query<FamiliaRow>("SELECT * FROM familias WHERE status = $1 ORDER BY id", [status])
    : await pool.query<FamiliaRow>("SELECT * FROM familias ORDER BY id");
  return rows.map(rowToFamilia);
}

/** Conta famílias com status 'ativo'. */
export async function contarFamiliasAtivas(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT COUNT(*) AS n FROM familias WHERE status = 'ativo'",
  );
  return Number(rows[0]?.n ?? 0);
}

// --- internals ---

interface FamiliaRow {
  id: number;
  telefone: string;
  nome_familia: string;
  nome_crianca: string | null;
  soul_id: string;
  status: string;
  anamnese_phase: number;
  questionnaire_data: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToFamilia(row: FamiliaRow): Familia {
  let data: Record<string, unknown>;
  if (typeof row.questionnaire_data === "string") {
    try {
      data = JSON.parse(row.questionnaire_data) as Record<string, unknown>;
    } catch {
      data = {};
    }
  } else {
    data = row.questionnaire_data ?? {};
  }
  return {
    id: Number(row.id),
    telefone: String(row.telefone),
    nomeFamilia: String(row.nome_familia),
    nomeCrianca: row.nome_crianca == null ? null : String(row.nome_crianca),
    soulId: String(row.soul_id),
    status: String(row.status) as Familia["status"],
    anamnesePhase: Number(row.anamnese_phase),
    questionnaireData: data,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
