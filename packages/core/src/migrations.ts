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
  {
    // Fila dedicada para extração de entidades/relações via LLM, disparada a
    // partir de addObservation() (memory/graph.ts). Não reaproveita `events`
    // porque processPendingEvents() roda TODO evento pelo pipeline pesado de
    // agente completo (buildPrompt/selectRoute/run), sem branch por tipo.
    id: "0007_entity_extraction_queue",
    sql: `
      CREATE TABLE IF NOT EXISTS entity_extraction_queue (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        soul TEXT NOT NULL,
        entity_name TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT,
        observation_id BIGINT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        processed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_entity_extraction_queue_status ON entity_extraction_queue (status);
      CREATE INDEX IF NOT EXISTS idx_entity_extraction_queue_soul ON entity_extraction_queue (soul, ts);
    `,
  },
  {
    // Gate G3 do Bloco G da norma v4.0: a tabela familias trata dado pessoal de
    // crianças (telefone, nomes) e dado sensível de saúde (anamnese/questionário)
    // sem base legal, finalidade ou retenção definidas. Esta migration adiciona as
    // colunas de governança de privacidade; o ciclo de vida (encerrarFamilia/
    // excluirFamilia/sweepRetencaoFamilias) vive em familias.ts.
    id: "0008_familias_privacidade",
    sql: `
      ALTER TABLE familias
        ADD COLUMN IF NOT EXISTS base_legal TEXT NOT NULL DEFAULT 'consentimento_responsavel',
        ADD COLUMN IF NOT EXISTS base_legal_sensivel TEXT NOT NULL DEFAULT 'tutela_saude_profissional',
        ADD COLUMN IF NOT EXISTS finalidade TEXT NOT NULL DEFAULT 'psicoterapia_familiar_infanto_juvenil',
        ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS retencao_ate TIMESTAMPTZ;
      COMMENT ON TABLE familias IS 'Famílias em acompanhamento (canal WhatsApp). Base legal: consentimento dos responsáveis (LGPD art. 7º I c/c art. 14) para contato/onboarding e tutela da saúde por profissional (art. 11 II f) para dados de anamnese. Retenção: durante o acompanhamento; exclusão total em cascata após retencao_ate (default FAMILIAS_RETENCAO_DIAS=1825 dias após encerramento). Ver docs/adr/ADR-PRIV-001.md.';
      COMMENT ON COLUMN familias.base_legal IS 'Base legal do dado pessoal comum (telefone/nomes): consentimento dos responsáveis — LGPD art. 7º I c/c art. 14.';
      COMMENT ON COLUMN familias.base_legal_sensivel IS 'Base legal do dado sensível de saúde (anamnese/questionário): tutela da saúde por profissional — LGPD art. 11 II f.';
      COMMENT ON COLUMN familias.finalidade IS 'Finalidade do tratamento: psicoterapia familiar e infanto-juvenil.';
      COMMENT ON COLUMN familias.encerrado_em IS 'Data de encerramento do acompanhamento; dispara a contagem do prazo de retenção.';
      COMMENT ON COLUMN familias.retencao_ate IS 'Prazo final de retenção; após essa data a rotina de retenção exclui o registro e todos os dados derivados da soul.';
    `,
  },
  {
    // Memória multi-turno real no chat: sessions.ts passa a rotacionar a
    // sessão aberta por inatividade (last_activity_at) em vez de deixá-la
    // aberta para sempre — corrige o lockout permanente de prompt_count >=
    // maxTurns (closeSession() nunca era chamado em produção) e dá um limite
    // claro pra "até onde volta o histórico". session_messages guarda os
    // turnos (usuário/assistente) usados como contexto nas próximas chamadas.
    id: "0009_session_history",
    sql: `
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

      CREATE TABLE IF NOT EXISTS session_messages (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        soul TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages (session_id, id);
    `,
  },
{
    // Cost/Usage Tracking: adiciona colunas de tokens e execution_mode ao router_history
    // para suportar Feature 3 do plano Orca (Enhanced Cost/Usage Tracking).
    id: "0010_cost_usage_tracking",
    sql: `
      ALTER TABLE router_history
        ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS completion_tokens INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_tokens INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS model_used TEXT,
        ADD COLUMN IF NOT EXISTS execution_mode TEXT;

      CREATE INDEX IF NOT EXISTS idx_router_history_mode_ts ON router_history (execution_mode, ts);
    `,
  },
  {
    // E1 (FinOps): getUsageSummary() passa a agregar SÓ linhas status='executed'
    // (execução real, com tokens). Índice parcial pra essa varredura por soul/período.
    id: "0011_router_history_executed_idx",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_router_history_executed
        ON router_history (soul, ts)
        WHERE status = 'executed';
    `,
  },
  {
    // E2 (multi-turno): sessão passa a ser por (soul, client_key) — sem isso dois
    // clientes/dispositivos conversando com a mesma soul compartilham histórico e
    // contador de turnos. client_key default 'default' preserva o comportamento
    // de instalação single-user.
    id: "0012_sessions_client_key",
    sql: `
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_key TEXT NOT NULL DEFAULT 'default';
      DROP INDEX IF EXISTS idx_sessions_soul_open;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_soul_client_open
        ON sessions (soul, client_key) WHERE ended_at IS NULL;
    `,
  },
  {
    // E9 (LGPD / ADR-PRIV-001 §7): evidência de consentimento dos responsáveis
    // (capturada fora do banco — canal WhatsApp) referenciada aqui. Uma família
    // não avança para 'ativo' sem essa referência (ver ativarFamilia).
    id: "0013_familias_consent_evidence",
    sql: `
      ALTER TABLE familias ADD COLUMN IF NOT EXISTS consent_evidence_ref TEXT;
      COMMENT ON COLUMN familias.consent_evidence_ref IS 'Referência à evidência de consentimento dos responsáveis (id/timestamp da mensagem ou mídia WhatsApp, responsável). Obrigatória para status = ativo — ADR-PRIV-001 §7.';
    `,
  },
  {
    // Higiene do índice RAG: content_hash permite pular re-embed de chunk cujo
    // conteúdo não mudou entre reindexações; updated_at carimba a última
    // sincronização (usado por indexStats().lastIndexedAt e pelo aviso de
    // "índice defasado" no `os memory <soul> status`).
    id: "0014_chunks_hygiene",
    sql: `
      ALTER TABLE chunks
        ADD COLUMN IF NOT EXISTS content_hash TEXT,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    `,
  },
  {
    // Onda 2 da remediação: trace de execução unificado. `trace_id` liga a linha
    // canônica em execution_logs aos spans por estágio (router/rag/ollama/…),
    // que antes só existiam efêmeros no WS `chat.step`. "Onde falhou" vira
    // consultável: `os trace <id>` / `GET /trace/:id`.
    id: "0015_execution_trace",
    sql: `
      ALTER TABLE execution_logs ADD COLUMN IF NOT EXISTS trace_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_execution_logs_trace ON execution_logs (trace_id);

      CREATE TABLE IF NOT EXISTS execution_spans (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        trace_id TEXT NOT NULL,
        soul TEXT NOT NULL,
        session_id BIGINT,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        seq INTEGER NOT NULL,
        module TEXT NOT NULL,
        message TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        elapsed_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_execution_spans_trace ON execution_spans (trace_id, seq);
    `,
  },
  {
    // Onda 3c: reaper de agenda. `claimDueAgenda` marca 'processing' sem carimbo
    // de quando — um crash entre claim e finish deixava o item preso pra sempre.
    // `claimed_at` permite ao reaper devolver itens presos há > N min pra fila
    // (ou falhar de vez se as tentativas esgotaram).
    id: "0016_agenda_claimed_at",
    sql: `ALTER TABLE agenda ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;`,
  },
  {
    // E12b: histórico de runs de avaliação de RAG (offline `os rag eval` e
    // amostragem online no chat) — rastreia drift de qualidade ao longo do
    // tempo, não só uma foto. Sem PII: só métricas e contagens.
    id: "0017_rag_eval_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS rag_eval_runs (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        soul TEXT,
        kind TEXT NOT NULL DEFAULT 'offline',
        n INTEGER NOT NULL DEFAULT 0,
        hit_at_1 DOUBLE PRECISION,
        hit_at_3 DOUBLE PRECISION,
        hit_at_5 DOUBLE PRECISION,
        mrr DOUBLE PRECISION,
        recall_at_5 DOUBLE PRECISION,
        adversarial_refusal_rate DOUBLE PRECISION,
        faithfulness_supported DOUBLE PRECISION,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_soul_ts ON rag_eval_runs (soul, ts);
    `,
  },
  {
    // Fase 0 do modo amigável multi-tenant: contas de cliente self-service,
    // paralelas ao token admin único (ASSISTENTE_OS_DAEMON_TOKEN) — não o
    // substitui. Nome "account_sessions" (não "sessions") porque a tabela
    // `sessions` já existe pra sessão de chat por soul (ver 0002); são
    // conceitos diferentes. token_hash guarda sha256 do token de sessão —
    // nunca o token em claro, igual ao padrão de clientKeyFor() no daemon.
    id: "0018_accounts",
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions (account_id);
    `,
  },
  {
    // Lista de capabilities/skills que o admin (modo especialista) libera pro
    // self-service escolher na criação/configurações de soul (modo amigável).
    // Vazia por padrão — sem nenhuma linha aqui, toda soul self-service
    // continua nascendo com capabilities:[] (comportamento da Fase 2, nunca
    // muda sozinho). `kind` distingue capability (do CAPABILITY_CATALOG) de
    // skill (nome de SKILL.md global) porque os dois catálogos são
    // independentes e um pattern podia colidir por acaso entre os dois.
    id: "0019_friendly_allowlist",
    sql: `
      CREATE TABLE IF NOT EXISTS friendly_allowlist (
        pattern TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('capability', 'skill')),
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (pattern, kind)
      );
    `,
  },
  {
    // Sub-projeto B (threads + streaming) — primeira fatia de backend, sem
    // nenhuma dependência de componente de front-end. `account_id` NULL =
    // thread do operador (token admin ASSISTENTE_OS_DAEMON_TOKEN), não uma
    // conta de cliente — o padrão já usado por outras tabelas escopadas por
    // conta desde 0018_accounts. `thread_id` em session_messages é nullable
    // de propósito: o /chat sem thread (uso direto via API/integrações,
    // comportamento atual) continua funcionando sem thread nenhuma.
    id: "0020_threads",
    sql: `
      CREATE TABLE IF NOT EXISTS threads (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        account_id BIGINT REFERENCES accounts (id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_threads_soul_account ON threads (soul, account_id, last_message_at DESC);

      ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES threads (id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_session_messages_thread ON session_messages (thread_id, id);
    `,
  },
];
