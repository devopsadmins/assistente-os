import type { Pool } from "pg";

/**
 * Planos de conta (modo amigável self-service) — quais modelos as souls de
 * uma conta podem usar na criação + teto de gasto diário agregado por
 * conta. Mesma forma de `friendlyAllowlist.ts` (admin configura um
 * catálogo, self-service só escolhe dentro dele), aplicada a modelo/gasto
 * em vez de capability/skill. Migração 0025_account_plans.
 */

export interface PlanRecord {
  id: string;
  displayName: string;
  allowedModels: string[];
  dailySpendLimit: number | null;
  createdAt: string;
}

function rowToPlan(row: Record<string, unknown>): PlanRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    allowedModels: Array.isArray(row.allowed_models) ? row.allowed_models.map(String) : [],
    dailySpendLimit: row.daily_spend_limit == null ? null : Number(row.daily_spend_limit),
    createdAt: String(row.created_at),
  };
}

export async function listPlans(pool: Pool): Promise<PlanRecord[]> {
  const { rows } = await pool.query("SELECT * FROM plans ORDER BY id");
  return rows.map(rowToPlan);
}

export async function getPlan(pool: Pool, id: string): Promise<PlanRecord | null> {
  const { rows } = await pool.query("SELECT * FROM plans WHERE id = $1", [id]);
  return rows[0] ? rowToPlan(rows[0]) : null;
}

/** Cria ou substitui um plano inteiro (não incremental — reflete exatamente o que o admin salvou). */
export async function upsertPlan(
  pool: Pool,
  plan: { id: string; displayName: string; allowedModels: string[]; dailySpendLimit: number | null },
): Promise<PlanRecord> {
  const { rows } = await pool.query(
    `INSERT INTO plans (id, display_name, allowed_models, daily_spend_limit)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       allowed_models = EXCLUDED.allowed_models,
       daily_spend_limit = EXCLUDED.daily_spend_limit
     RETURNING *`,
    [plan.id, plan.displayName, plan.allowedModels, plan.dailySpendLimit],
  );
  return rowToPlan(rows[0]);
}

/** Falha se o plano ainda tiver contas atribuídas (FK accounts.plan_id) — chamador decide a mensagem. */
export async function deletePlan(pool: Pool, id: string): Promise<void> {
  await pool.query("DELETE FROM plans WHERE id = $1", [id]);
}
