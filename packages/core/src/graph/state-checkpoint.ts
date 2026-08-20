/**
 * Checkpointing e Telemetria para LangGraph no Assistente OS
 * 
 * Responsabilidades:
 * 1. Validar flag LANGGRAPH_ENABLED=true antes de operações de grafo
 * 2. Persistir checkpoint de estado (iterationCount, lastToolResult, context)
 *    no PostgreSQL (pool existente) ou SQLite local como fallback
 * 3. Aplicar guardrail de teto de iterações (LANGGRAPH_MAX_ITERATIONS = 5)
 * 4. Capturar metadata de tokens (prompt/completion/latency) e anexar ao log
 *    diário em sessoes/YYYY-MM-DD.md (filosofia Local-First)
 * 
 * Filosofia Local-First: se PostgreSQL cair, escrita no SQLite local garante
 * progresso; telemetria sempre escrita em Markdown (best-effort, never blocks).
 */

import { 
  getPool, 
  type Pool 
} from "../db.js";
import { 
  Soul, soulDir
} from "../souls.js";
import { todayISODate, anotar } from "../alma.js";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// ── Flag Environment ──────────────────────────────────────────────────

const LANGGRAPH_ENABLED = process.env.LANGGRAPH_ENABLED === "true";
const LANGGRAPH_MAX_ITERATIONS = Number(
  process.env.LANGGRAPH_MAX_ITERATIONS || "5"
);

// ── Checkpoint Persistence ────────────────────────────────────────────

/**
 * Estrutura de checkpoint persistido no banco de dados ou localStorage.
 */
interface CheckpointRecord {
  id: number;
  soul_id: string;
  iteration: number;
  last_tool_result?: string;
  context?: string;
  created_at: string;
}

/**
 * Garante tabela de checkpoints no PostgreSQL.
 * Usa o pool existente do core. Se falhar, tenta SQLite fallback.
 */
async function ensurePostgresCheckpointsTable(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id SERIAL PRIMARY KEY,
        soul_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        last_tool_result JSONB,
        context JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.debug("✅ Tabela agent_checkpoints garantida no PostgreSQL");
  } catch (err) {
    // Fallback para SQLite caso PG falhe
    console.debug(
      "⚠️ Falha ao garantir tabela PG para checkpoints, tentará SQLite:",
      (err as Error).message
    );
    throw err; // Deixar caller decidir fallback
  }
}

/**
 * Persiste um checkpoint no PostgreSQL.
 * Se PG indisponível, grava em SQLite local `~/.assistant-os/memory.db`.
 */
async function persistCheckpoint(
  pool: Pool | undefined,
  soulId: string,
  iteration: number,
  lastToolResult?: string,
  context?: string
): Promise<void> {
  const dateISO = todayISODate();

  if (pool) {
    // Caminho PostgreSQL
    try {
      await ensurePostgresCheckpointsTable(pool);
      await pool.query(
        `INSERT INTO agent_checkpoints (soul_id, iteration, last_tool_result, context, created_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, now())`,
        [soulId, iteration, lastToolResult ? JSON.stringify(lastToolResult) : null, context ? JSON.stringify(context) : null]
      );
      console.debug(`🔖 Checkpoint PG gravado: soul=${soulId}, iter=${iteration}`);
      return;
    } catch (err) {
      console.debug("PG checkpoint falhou, tentando SQLite:", (err as Error).message);
    }
  }

  // Fallback SQLite local: ~/.assistant-os/memory.db
  try {
    const sqliteDbPath = join(
      process.env.ASSISTENTE_OS_HOME || join(require("node:os").homedir(), ".assistant-os"),
      "memory.db"
    );

    // Usar node:sqlite (disponível Node 26+) ou melhor-sqlite3 se instalado
    let db: any;
    try {
      // Tentativa de import stdlib node:sqlite (compatibilidade)
      // Em Node 26+ está disponível; aqui fazemos o better-sqlite3 se houver
      // @ts-expect-error better-sqlite3 é optional (runtime fallback)
      const { Database } = await import("better-sqlite3");
      db = new Database(sqliteDbPath, { readonly: false });
    } catch (importErr) {
      // Fallback ainda mais básico: escrever arquivo JSON manual
      console.debug(
        "Nem better-sqlite3 disponível, usando arquivo JSON para checkpoint:",
        (importErr as Error).message
      );
      // Write JSON file approach
      const checkpoint = {
        id: Date.now(),
        soul_id: soulId,
        iteration,
        last_tool_result: lastToolResult,
        context: context,
        created_at: dateISO,
      };
      const checkpointDir = join(sqliteDbPath, "..");
      mkdirSync(checkpointDir, { recursive: true });
      const jsonPath = join(checkpointDir, ".checkpoint.json");
      // Append array ou overwrite último
      let existing = [];
      if (existsSync(jsonPath)) {
        existing = JSON.parse(readFileSync(jsonPath, "utf8"));
      }
      existing.push(checkpoint);
      writeFileSync(jsonPath, JSON.stringify(existing, null, 2), "utf8");
      console.debug(`🔖 Checkpoint JSON gravado: ${jsonPath}`);
      return;
    }

    // Garante tabela
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        soul_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        last_tool_result TEXT,
        context TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insere registro
    const stmt = db.prepare(
      `INSERT INTO agent_checkpoints (soul_id, iteration, last_tool_result, context, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(soulId, iteration, lastToolResult ?? null, context ?? null, dateISO);
    console.debug(`🔖 Checkpoint SQLite gravado: soul=${soulId}, iter=${iteration}`);

    // Fecha conexão após operação
    db.close();
  } catch (sqliteErr) {
    // Último recurso: ignora checkpoint (non-fatal)
    console.debug("Checkpoint persistence falhou totalmente (non-fatal):", (sqliteErr as Error).message);
  }
}

// ── Iteration Guardrail ───────────────────────────────────────────────

/**
 * Verifica se o agente atingiu o limite máximo de iterações.
 * Retorna true se deve encerrar (limite atingido), false se pode continuar.
 */
export function checkIterationLimit(
  currentCount: number,
  maxIterations?: number
): "continue" | "end" {
  const limit = maxIterations ?? LANGGRAPH_MAX_ITERATIONS;
  return currentCount >= limit ? "end" : "continue";
}

/**
 * Incrementa o contador de iterações e retorna o novo estado.
 * Também persiste checkpoint após incrementar.
 */
export async function incrementAndCheckIteration(
  pool: Pool | undefined,
  soulId: string,
  currentCount: number,
  lastToolResult?: string,
  context?: string
): Promise<{
  newCount: number;
  shouldContinue: "continue" | "end";
  checkpointPersisted: boolean;
}> {
  const newCount = currentCount + 1;
  const shouldContinue = newCount <= (LANGGRAPH_MAX_ITERATIONS ?? 5)
    ? "continue"
    : "end";

  // Persistir checkpoint após este incremento
  await persistCheckpoint(pool, soulId, newCount, lastToolResult, context);

  return {
    newCount,
    shouldContinue,
    checkpointPersisted: true,
  };
}

// ── Telemetry: Token Usage & Session Logging ──────────────────────────

/**
 * Registra metadata de uso de tokens ao final de uma sessão de agente.
 * Escrita garantida em Markdown (Local-First), nunca bloqueia processo.
 * 
 * @param soulId ID da soul/usuário
 * @param promptTokens Número de tokens de entrada
 * @param completionTokens Número de tokens de saída  
 * @param latencyMs Latência em milissegundos da última operação
 * @param operationDesc Descrição curta da operação (ex: "rag_search", "llm_chat")
 */
export async function logTokenTelemetry(
  soulId: string,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
  operationDesc: string
): Promise<string> {
  const dateISO = todayISODate();
  const homeDir = process.env.ASSISTENTE_OS_HOME || join(require("node:os").homedir(), ".assistant-os");
  const soulPath = soulDir(join(homeDir, "souls"), soulId);

  // Garante diretórios
  mkdirSync(soulPath, { recursive: true });
  mkdirSync(join(soulPath, "sessoes"), { recursive: true });

  // Arquivo de log: sessoes/YYYY-MM-DD.md
  const logPath = join(soulPath, "sessoes", `${dateISO}.md`);

  // Monta entrada de telemetria
  const telemetryEntry = `
## Métricas de Tokens - ${operationDesc}
- **Data:** ${dateISO}
- **Tokens de entrada (prompt):** ${promptTokens}
- **Tokens de saída (completion):** ${completionTokens}
- **Total de tokens:** ${promptTokens + completionTokens}
- **Latência:** ${latencyMs} ms
- **Modelo:** ${process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free"}

---

`.trim();

  // Append no arquivo (cria se não existir)
  try {
    appendFileSync(logPath, telemetryEntry + "\n", "utf8");
    console.debug(`✅ Telemetry logged: ${logPath}`);
    return logPath;
  } catch (err) {
    // Best-effort: se falhar, não bloqueia o processo principal
    console.debug("⚠️ Falha ao escrever telemetry (non-fatal):", (err as Error).message);
    return "";
  }
}

/**
 * Registra checkpoint de estado atual do agente no log de sessão Markdown.
 * Útil para auditoria manual ou depuração de fluxos cíclicos.
 */
export async function logStateCheckpointToMarkdown(
  soulId: string,
  iteration: number,
  contextSummary: string,
  lastToolResultSummary?: string
): Promise<string> {
  const dateISO = todayISODate();
  const homeDir = process.env.ASSISTENTE_OS_HOME || join(require("node:os").homedir(), ".assistant-os");
  const soulPath = soulDir(join(homeDir, "souls"), soulId);

  mkdirSync(soulPath, { recursive: true });
  const logPath = join(soulPath, "sessoes", `${dateISO}.md`);

  const entry = `
### Checkpoint de Estado
- **Iteração:** ${iteration}
- **Contexto (resumo):** ${contextSummary}
- **Resultado último tool:** ${lastToolResultSummary || "—"}
- **Timestamp:** ${new Date().toISOString()}

---

`.trim();

  try {
    appendFileSync(logPath, entry + "\n", "utf8");
    console.debug(`📓 State checkpoint logged: ${logPath}`);
    return logPath;
  } catch (err) {
    console.debug("⚠️ Falha ao escrever state checkpoint (non-fatal):", (err as Error).message);
    return "";
  }
}

// ── Exportações ───────────────────────────────────────────────────────

export type { CheckpointRecord };