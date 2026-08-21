export interface Migration {
  id: string;
  sql: string;
}

/**
 * Migrações do banco único do Assistente OS (kernel + memória/RAG).
 * Aplicadas em ordem por runMigrations() (db.ts), controladas por schema_migrations.
 * Embutidas como string (não arquivos .sql soltos) para não depender de copiar
 * assets no build/Docker — tsc já compila este arquivo como qualquer outro.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: "0001_extensions",
    sql: `CREATE EXTENSION IF NOT EXISTS vector;`,
  },
  {
    id: "0002_kernel_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS cost_calls (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        soul TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ok',
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cost_calls_soul_ts ON cost_calls (soul, ts);
      CREATE INDEX IF NOT EXISTS idx_cost_calls_provider ON cost_calls (provider);

      CREATE TABLE IF NOT EXISTS router_history (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        soul TEXT NOT NULL,
        tier TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ok',
        latency_ms INTEGER,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_router_history_soul_ts ON router_history (soul, ts);

      CREATE TABLE IF NOT EXISTS agenda (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        soul TEXT,
        title TEXT NOT NULL,
        body TEXT,
        due_at TIMESTAMPTZ,
        done BOOLEAN NOT NULL DEFAULT false,
        done_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agenda_due ON agenda (due_at);

      CREATE TABLE IF NOT EXISTS events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        type TEXT NOT NULL,
        payload JSONB,
        soul TEXT,
        signature TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        processed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
      CREATE INDEX IF NOT EXISTS idx_events_soul_ts ON events (soul, ts);

      CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        prompt_count INTEGER NOT NULL DEFAULT 0,
        max_turns INTEGER NOT NULL DEFAULT 10,
        budget_cap DOUBLE PRECISION
      );
      -- Garante no máx. 1 sessão aberta por soul mesmo sob concorrência real
      -- (SQLite era single-writer síncrono; Postgres não é). Substitui o padrão
      -- antigo de "SELECT pra ver se existe, senão INSERT" por INSERT ... ON
      -- CONFLICT sobre este índice único parcial.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_soul_open ON sessions (soul) WHERE ended_at IS NULL;

      CREATE TABLE IF NOT EXISTS execution_logs (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_id BIGINT REFERENCES sessions(id),
        soul TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        kind TEXT NOT NULL DEFAULT 'chat',
        prompt_hash TEXT,
        model TEXT,
        tier TEXT,
        files_loaded INTEGER NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        context_chars INTEGER NOT NULL DEFAULT 0,
        verdict TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_execution_logs_soul_ts ON execution_logs (soul, ts);

      CREATE TABLE IF NOT EXISTS monitors (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        expected_code INTEGER NOT NULL DEFAULT 200,
        status TEXT NOT NULL DEFAULT 'unknown',
        latency_ms DOUBLE PRECISION,
        http_code INTEGER,
        last_error TEXT,
        last_checked_at TIMESTAMPTZ
      );
    `,
  },
  {
    id: "0003_memory_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS entities (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'unknown',
        properties JSONB,
        UNIQUE (soul, name)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_soul ON entities (soul);

      CREATE TABLE IF NOT EXISTS relations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        from_name TEXT NOT NULL,
        rel TEXT NOT NULL,
        to_name TEXT NOT NULL,
        properties JSONB,
        UNIQUE (soul, from_name, rel, to_name)
      );
      CREATE INDEX IF NOT EXISTS idx_relations_soul ON relations (soul);

      CREATE TABLE IF NOT EXISTS observations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        body TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_observations_soul ON observations (soul, entity_name);

      -- Índice derivado (fonte da verdade = Markdown). doc_key = arquivo::indice.
      -- embedding: dimensão 768 (nomic-embed-text via Ollama, embedders.ts default).
      CREATE TABLE IF NOT EXISTS chunks (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        doc_key TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        embedding vector(768),
        UNIQUE (soul, doc_key)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_soul ON chunks (soul);
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
    `,
  },
  {
    id: "0004_familias",
    sql: `
      CREATE TABLE IF NOT EXISTS familias (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        telefone TEXT NOT NULL UNIQUE,
        nome_familia TEXT NOT NULL,
        nome_crianca TEXT,
        soul_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pendente',
        anamnese_phase INTEGER NOT NULL DEFAULT 0,
        questionnaire_data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_familias_telefone ON familias (telefone);
    `,
  },
  {
    // familias.telefone já é UNIQUE (0004), o que cria um índice único implícito;
    // idx_familias_telefone era um segundo índice redundante sobre a mesma coluna.
    id: "0005_drop_redundant_familias_telefone_index",
    sql: `DROP INDEX IF EXISTS idx_familias_telefone;`,
  },
  {
    // Antes criada ad hoc via CREATE TABLE IF NOT EXISTS a cada checkpoint
    // (packages/core/src/graph/state-checkpoint.ts) — movida para o mecanismo
    // de migrations como o resto do schema.
    id: "0006_agent_checkpoints",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id SERIAL PRIMARY KEY,
        soul_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        last_tool_result JSONB,
        context JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_soul ON agent_checkpoints (soul_id);
    `,
  },
];
