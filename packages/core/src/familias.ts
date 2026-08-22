import type { Pool } from "pg";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nowIso } from "./costs.js";
import { isValidSoulId } from "./souls.js";

export interface Familia {
  id: number;
  telefone: string;
  nomeFamilia: string;
  nomeCrianca: string | null;
  soulId: string;
  status: "pendente" | "ativo" | "suspenso" | "encerrado";
  anamnesePhase: number;
  questionnaireData: Record<string, unknown>;
  baseLegal: string;
  baseLegalSensivel: string;
  finalidade: string;
  encerradoEm: string | null;
  retencaoAte: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Prazo de retenção pós-encerramento, em dias (LGPD art. 18 VI). Configurável via FAMILIAS_RETENCAO_DIAS. */
export const FAMILIAS_RETENCAO_DIAS_PADRAO = 1825;

export function familiasRetencaoDias(): number {
  const raw = process.env.FAMILIAS_RETENCAO_DIAS;
  if (!raw) return FAMILIAS_RETENCAO_DIAS_PADRAO;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : FAMILIAS_RETENCAO_DIAS_PADRAO;
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

/**
 * Encerra o acompanhamento de uma família: status → 'encerrado' e retencao_ate =
 * agora + prazo (default familiasRetencaoDias()). A eliminação em si só acontece
 * quando o sweep roda após o vencimento — ou imediatamente via excluirFamilia().
 */
export async function encerrarFamilia(
  pool: Pool,
  id: number,
  opts: { retencaoDias?: number } = {},
): Promise<Familia | null> {
  const dias = opts.retencaoDias ?? familiasRetencaoDias();
  const agora = nowIso();
  const retencaoAte = new Date(Date.now() + dias * 86400000).toISOString();
  const { rows } = await pool.query<FamiliaRow>(
    `UPDATE familias
     SET status = 'encerrado', encerrado_em = $1, retencao_ate = $2, updated_at = $1
     WHERE id = $3
     RETURNING *`,
    [agora, retencaoAte, id],
  );
  return rows[0] ? rowToFamilia(rows[0]) : null;
}

/** Famílias encerradas cujo prazo de retenção já venceu (alvo do sweep). */
export async function listarFamiliasVencidas(pool: Pool): Promise<Familia[]> {
  const { rows } = await pool.query<FamiliaRow>(
    "SELECT * FROM familias WHERE status = 'encerrado' AND retencao_ate IS NOT NULL AND retencao_ate <= now() ORDER BY id",
  );
  return rows.map(rowToFamilia);
}

export interface ExclusaoFamilia {
  familiaId: number;
  soulId: string;
  /** Linhas apagadas por tabela (apenas tabelas com rowCount > 0). */
  linhasPorTabela: Record<string, number>;
  soulDirRemovido: boolean;
}

/**
 * Eliminação total dos dados da família (LGPD art. 18 VI), em cascata por soul:
 * logs/sessões/eventos/agenda/fila de extração/memória (observações, relações,
 * entidades, embeddings RAG), checkpoints do agente e a própria linha de familias —
 * tudo numa transação; por fim remove o diretório da soul em disco.
 * Métricas operacionais sem conteúdo pessoal (cost_calls, router_history) são preservadas.
 */
export async function excluirFamilia(
  pool: Pool,
  soulsRoot: string,
  id: number,
): Promise<ExclusaoFamilia | null> {
  const familia = await buscarFamiliaPorId(pool, id);
  if (!familia) return null;
  const soulId = familia.soulId;
  if (!isValidSoulId(soulId)) throw new Error(`soulId inválido para exclusão: ${JSON.stringify(soulId)}`);

  // [tabela, coluna] — execution_logs antes de sessions (FK sessions.id).
  const alvos: Array<[string, string]> = [
    ["execution_logs", "soul"],
    ["sessions", "soul"],
    ["events", "soul"],
    ["agenda", "soul"],
    ["entity_extraction_queue", "soul"],
    ["observations", "soul"],
    ["relations", "soul"],
    ["entities", "soul"],
    ["chunks", "soul"],
    ["agent_checkpoints", "soul_id"],
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const linhasPorTabela: Record<string, number> = {};
    for (const [tabela, coluna] of alvos) {
      const r = await client.query(`DELETE FROM ${tabela} WHERE ${coluna} = $1`, [soulId]);
      if ((r.rowCount ?? 0) > 0) linhasPorTabela[tabela] = r.rowCount!;
    }
    const rf = await client.query("DELETE FROM familias WHERE id = $1", [id]);
    linhasPorTabela["familias"] = rf.rowCount ?? 0;
    await client.query("COMMIT");

    let soulDirRemovido = false;
    const dir = join(soulsRoot, soulId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      soulDirRemovido = true;
    }
    return { familiaId: id, soulId, linhasPorTabela, soulDirRemovido };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Rotina de retenção (idempotente): exclui em cascata toda família encerrada
 * cujo retencao_ate já venceu. Chamada pelo daemon num timer diário.
 */
export async function sweepRetencaoFamilias(
  pool: Pool,
  soulsRoot: string,
): Promise<ExclusaoFamilia[]> {
  const vencidas = await listarFamiliasVencidas(pool);
  const resultados: ExclusaoFamilia[] = [];
  for (const f of vencidas) {
    resultados.push((await excluirFamilia(pool, soulsRoot, f.id))!);
  }
  return resultados;
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
  base_legal: string;
  base_legal_sensivel: string;
  finalidade: string;
  encerrado_em: string | null;
  retencao_ate: string | null;
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
    baseLegal: String(row.base_legal),
    baseLegalSensivel: String(row.base_legal_sensivel),
    finalidade: String(row.finalidade),
    encerradoEm: row.encerrado_em ? String(row.encerrado_em) : null,
    retencaoAte: row.retencao_ate ? String(row.retencao_ate) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
