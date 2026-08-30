# Deploy do zero + protocolo de teste da solução completa

Consolidação do trabalho de **2026-08-29/30**: remediação da análise crítica
(Ondas 0–3) + trilha RAG enterprise-ready (E11–E12). Este documento serve para
subir o sistema numa máquina limpa e validar o comportamento das mudanças.

> Ponto de referência do código: `main` após os PRs **#11–#20**.

---

## 1. O que foi entregue

### 1.1 Remediação da análise crítica (PRs #11–#17)

| Onda | PR | Entrega |
|---|---|---|
| **0 — Contenção** | #11 | `GET /health` público **não lista mais as souls** (ids `familia_<telefone>` = PII); `agenda` isolada por soul (`getAgendaItems(pool, doneFilter, soul?)`); transcrições de sessão + `auth.json` fora do versionamento; `GET /infra/status` reporta `postgres.ok=false` em vez de 500. |
| **1a — Zero Trust** | #12 | Gate central em `tools/call` + filtro de allowlist do agente LangGraph. `authorizeExecution` (autonomia × risco) tinha **1 caller** em todo o código; agora é o gate real. `authorizeExecution` ganhou `enforcePolicyGates?: boolean`. Validação de `args.soul` (`isValidSoulId`) em `skill_*`/`mission_run`. **Flag `MCP_ZERO_TRUST`, default `off`.** |
| **1b — Throttle** | #13 | Rate limit por cliente (`AOS_RATE_LIMIT`, default 600/60s) → `429` + `Retry-After`; semáforo de execuções caras (`AOS_MAX_CONCURRENT_EXEC`, default 8) → `503`. `packages/daemon/src/throttle.ts`. |
| **2 — Observabilidade** | #14 | **Trace unificado**: `x-trace-id` na resposta do chat + `execution_logs.trace_id` + tabela `execution_spans` (um span por estágio). `getTrace()`, `GET /trace/:id`, `os trace <id>`. Testes e2e `golden-path.live.ts` + `backup-restore.live.ts` (`RUN_E2E=1`, fora do CI). |
| **3a — Docs/config** | #15 | `docs/ARCHITECTURE.md` reescrito (descrevia design SQLite/Windows/Stitch); tool count reconciliado (**56**); `ASSISTENTE_OS_ROUTER_TIERS` passou a ser lido; **`.env.example`** na raiz. |
| **3b — Migrations** | #16 | `schema_migrations.sql_sha256` — `runMigrations` compara e avisa `DRIFT` (migração editada após aplicada), sem derrubar o boot. |
| **3c — Jobs de fundo** | #17 | Os 4 loops de background (`monitors`/`events`/`agenda`/`entity_extraction`) tinham `.catch(() => {})` — agora `logger.error` + counter `aos_background_job_errors_total{job}`. **Reaper de agenda** (migração `0016_agenda_claimed_at`): item preso em `processing` volta pra fila após `AOS_AGENDA_STALE_MINUTES` (15) ou falha após `AOS_AGENDA_MAX_ATTEMPTS` (3). |

### 1.2 RAG enterprise-ready (PRs #18–#20)

| Epic | PR | Entrega |
|---|---|---|
| **E11 — RAG auditável** | #18 | Citação no contexto do chat: `[<doc_key> · sim <score> · <data>] <trecho>` + diretriz explícita de constrained generation (antes só existia no `ragAnswer` do Prompt Garden, que o chat não usa). `RagChunk.indexedAt` (de `chunks.updated_at`). `computeRagConfidence(sources)` multi-sinal (`0.6·topScore + 0.25·concord + 0.15·(1−freshness)`) → `verdict.confidence`. **Modo "evidência insuficiente"** (`AOS_RAG_MIN_CONFIDENCE`, default `0` = off): abaixo do piso, o contexto não é injetado e o modelo é instruído a admitir a falta. |
| **E12a — fidelidade + adversariais** | #19 | `scoreAnswerFaithfulness(answer, sources)` — heurística: frase-afirmação com pouca sobreposição com as fontes = "não sustentada". `RagEvalCase.adversarial: true` → `runRagEval` reporta `adversarialRefusalRate`. `os rag eval --min-refusal` (default 0.8). |
| **E12b — rastreamento contínuo** | #20 | `runFaithfulnessEval(pool, cases, generate)` (generate injetável). Tabela `rag_eval_runs` (migração `0017`, **sem PII**) + `os rag eval --record` / `os rag eval --history [<soul>]`. Amostragem online: `AOS_RAG_FAITHFULNESS_SAMPLE` (0..1, default 0) pontua p% dos turnos de chat com RAG e grava `kind='online'`. |

---

## 2. Variáveis de ambiente novas

Todas em `~/.assistant-os/.env`. **Defaults preservam o comportamento anterior** —
o `.env.example` na raiz do repo tem a lista completa.

| Variável | Default | Para o teste, usar |
|---|---|---|
| `MCP_ZERO_TRUST` | `off` | `off` (ver §4.7 antes de ligar — precisa `autonomy` nas souls) |
| `AOS_RATE_LIMIT` / `AOS_RATE_WINDOW_SEC` | `600` / `60` | manter; baixar p/ `10` num teste dedicado de 429 |
| `AOS_MAX_CONCURRENT_EXEC` | `8` | manter; `1` num teste dedicado de 503 |
| `AOS_AGENDA_STALE_MINUTES` / `AOS_AGENDA_MAX_ATTEMPTS` | `15` / `3` | manter |
| `AOS_RAG_MIN_CONFIDENCE` | `0` (off) | **`0.4`** — liga o modo "evidência insuficiente" |
| `AOS_RAG_CONCORD_FLOOR` / `_TARGET` | `0.5` / `3` | manter |
| `AOS_RAG_STALE_DAYS` | `365` | manter |
| `AOS_RAG_FAITHFULNESS_SAMPLE` | `0` (off) | **`0.3`** — amostra 30% dos turnos p/ `rag_eval_runs` |
| `AOS_RAG_FAITHFULNESS_MIN_OVERLAP` | `0.35` | manter |
| `ASSISTENTE_OS_ROUTER_TIERS` | `local,zen,soul` | manter |
| `RUN_E2E` | — | `1` só ao rodar os testes `.live.ts` |
| `RAG_RERANK` + `RAG_RERANK_CE_MODEL` | `off` | `cross-encoder` + `Xenova/bge-reranker-base` (medir) |
| `RAG_SEMANTIC_CACHE` | `off` | `on` (medir taxa de hit) |
| `ROUTER_ESCALATION` | `off` | `on` (precisa Ollama vivo) |

---

## 3. Deploy do zero (máquina limpa)

### 3.a — Instalador guiado (recomendado)

```bash
git clone <repo> assistente-os && cd assistente-os
npm run setup            # scripts/setup.sh — interativo
```

O `setup.sh` faz tudo da §3.b: checa pré-requisitos (Node ≥ 22.16, Docker,
Ollama, `pg_dump`), roda `npm ci` + `build` + `typecheck`, monta
`~/.assistant-os/.env` perguntando o essencial (Postgres compose ou externo,
`OLLAMA_*`, `AOS_HOST`/porta, **gera um `ASSISTENTE_OS_DAEMON_TOKEN` forte**,
chaves Zen opcionais, e um pacote de **flags de teste** — `AOS_RAG_MIN_CONFIDENCE=0.4`,
`AOS_RAG_FAITHFULNESS_SAMPLE=0.3`, `RAG_RERANK=cross-encoder` + `bge-reranker-base`,
`RAG_SEMANTIC_CACHE=on`, `ROUTER_ESCALATION=on`), sobe o Postgres, aplica as
migrações (`os status`), oferece indexar a 1ª soul e, opcional, `pm2 start`.
**Idempotente** — faz backup do `.env` antes de mexer, nunca apaga dados.

- `npm run setup -- --yes` — não-interativo (defaults + `.env` atual).
- `npm run setup -- --pm2` — sobe via PM2 ao final.
- `npm run setup -- --skip-build` — re-run rápido (pula `npm ci`/`build`).

> **`MCP_ZERO_TRUST` NÃO é ligado pelo instalador.** Exige `agent.autonomy` nos
> `config.json` das souls, senão nega toda tool L3. Ligar à mão depois (§4.7).

### 3.b — Manual (o que o instalador faz por baixo)

```bash
# 3.1 Pré-requisitos
#   Node >= 22.16 · Docker (Postgres) · Ollama (opcional — sem ele o tier
#   `local` e o --faithfulness ficam indisponíveis) · pg_dump (backup completo)

# 3.2 Clone + build
git clone <repo> assistente-os && cd assistente-os
npm ci
npm run build
npm run typecheck        # deve passar limpo

# 3.3 Postgres (pgvector)
docker compose up -d postgres
#   cria pgvector/pgvector:pg17 em localhost:5432, user/pass/db = assistente_os

# 3.4 Config
mkdir -p ~/.assistant-os
cp .env.example ~/.assistant-os/.env
#   edite o .env: DATABASE_URL, OLLAMA_URL/MODELs, e os flags de teste da §2

# 3.5 Migrações + smoke
npm run os status
#   roda as migrações (0001..00NN) e imprime souls/ollama/degraus.
#   Se aparecer "[migrations] DRIFT" aqui numa instalação limpa, é bug — reportar.

# 3.6 Criar uma soul e indexar  (a criação é via MCP soul_create; sem CLI direto)
#   monte uma pasta ~/.assistant-os/souls/teste/ com perfil.md + sources/*.md e:
npm run os memory teste index
npm run os memory teste status     # confere chunks/files/lastIndexedAt

# 3.7 Subir o daemon
npm run os daemon                  # porta 4310; /health público
```

---

## 4. Protocolo de teste de comportamento

Cada item abaixo valida uma entrega. Rodar com o daemon no ar (`localhost:4310`);
onde houver token, mandar `Authorization: Bearer <ASSISTENTE_OS_DAEMON_TOKEN>`.

### 4.1 `/health` não vaza souls  (Onda 0)
```bash
curl -s localhost:4310/health
# esperado: {"ok":true,"service":"assistente-os"}  — SEM campo "souls"
curl -s -H "Authorization: Bearer $TOK" localhost:4310/souls | jq '.[].id'
# a lista completa só aqui, com token
```

### 4.2 Trace unificado  (Onda 2)
```bash
R=$(curl -s -D /tmp/h -H "Authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"prompt":"como reinicio o pm2?","tier":"local"}' \
  localhost:4310/souls/teste/chat)
TID=$(grep -i '^x-trace-id:' /tmp/h | tr -d '\r' | awk '{print $2}')
npm run os trace "$TID"
# esperado: a linha canônica + timeline de spans (+Nms): chat, rag, router,
#           ollama/opencode, persistencia. Um span 'level=err' aponta ONDE falhou.
echo "$R" | jq '.ragVerdict.confidence, (.ragVerdict.sources[0] | {doc,score,indexedAt})'
```

### 4.3 Citação + confidence  (E11)
- A resposta (`stdout`) deve **citar a fonte** entre colchetes (ex.: `[pm2.md::1]`).
- `ragVerdict.confidence` = `{ score, level, signals:{topScore,concord,freshnessDays,freshnessPenalty} }`.
- `ragVerdict.sources[].indexedAt` presente.

### 4.4 Modo "evidência insuficiente"  (E11)
```bash
# com AOS_RAG_MIN_CONFIDENCE=0.4 no .env (reinicie o daemon):
curl -s -H "Authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"prompt":"qual a taxa Selic projetada para 2035?","tier":"local"}' \
  localhost:4310/souls/teste/chat | jq '.stdout, .ragVerdict.motivo'
# esperado: a resposta admite objetivamente que não há evidência suficiente na
#           base; ragVerdict.motivo == "confidence_below_floor"
```

### 4.5 `os rag eval` + histórico  (E12)
```bash
# golden set real em ~/.assistant-os/rag-golden.jsonl (uma linha por caso;
# formato em docs/RAG-EVAL.md). Marque casos fora de escopo com "adversarial":true.
npm run os rag eval teste --record                    # hit@k + refusal rate, grava o run
npm run os rag eval teste --faithfulness --record     # + fidelidade (usa Ollama)
npm run os rag eval teste --history                   # evolução ao longo do tempo
# gate manual: --min-hit1 0.7 --min-refusal 0.8
```

### 4.6 Rate limit / concorrência  (Onda 1b)
```bash
# com AOS_RATE_LIMIT=10:
for i in $(seq 1 15); do
  curl -s -o /dev/null -w "%{http_code} " -H "x-client-id: flood" localhost:4310/souls
done; echo
# esperado: 200 x10 depois 429; header Retry-After no 429.

# com AOS_MAX_CONCURRENT_EXEC=1: duas chamadas /chat simultâneas → a 2ª = 503.
```

### 4.7 Zero Trust  (Onda 1a)
```bash
# 1) editar ~/.assistant-os/souls/teste/config.json:
#    "agent": { "autonomy": "suggest", "permissions": { "tools": ["memory_search"] } }
# 2) MCP_ZERO_TRUST=on no .env do processo que roda o MCP (packages/tools)
# 3) via o agente/MCP, chamar uma tool L2/L3 (ex.: observation_add) →
#    negado com "[Security 42001] autonomy 'suggest' bloqueia ...".
# Com MCP_ZERO_TRUST=off (default) o comportamento é o de antes (só allowlist).
```

### 4.8 Reaper de agenda  (Onda 3c)
```bash
# agende uma tarefa; mate o daemon (kill -9) durante o despacho; suba de novo.
# Após AOS_AGENDA_STALE_MINUTES (baixe p/ 1 no teste), o item volta a 'pending'
# e é reivindicado de novo (ou 'failed' se attempt >= AOS_AGENDA_MAX_ATTEMPTS).
psql "$DATABASE_URL" -c "SELECT id,status,attempt,claimed_at FROM agenda ORDER BY id DESC LIMIT 5"
```

### 4.9 Checksum de migração  (Onda 3b)
```bash
# edite o SQL de uma migração JÁ APLICADA (ex.: 0014) e suba o daemon:
npm run os status 2>&1 | grep DRIFT
# esperado: "[migrations] DRIFT: '0014_...' foi editada depois de aplicada ..."
# (não derruba o boot). REVERTA a edição depois.
```

### 4.10 Jobs de fundo + métricas  (Onda 3c)
```bash
curl -s -H "Authorization: Bearer $TOK" localhost:4310/metrics | grep -E \
  'aos_background_job_errors_total|aos_agenda_queue_depth|aos_events_pending'
```

### 4.11 Amostragem online de fidelidade  (E12b)
```bash
# com AOS_RAG_FAITHFULNESS_SAMPLE=0.3, faça ~10 chats com RAG e depois:
npm run os rag eval teste --history        # devem aparecer linhas kind='online'
```

### 4.12 e2e guardados  (Onda 2)
```bash
npm --workspace @assistente-os/daemon run build
RUN_E2E=1 node --test packages/daemon/dist/test/golden-path.live.js       # Ollama real
RUN_E2E=1 node --test packages/cli/dist/test/backup-restore.live.js       # docker + pg_restore
```

---

## 5. Fases E13 (o teste "zero → real")

Este documento **é** o runbook da Fase 1/3. Executar na outra máquina:

- **Fase 1 — cold start**: seguir §3 numa instalação limpa. Medir: tempo de setup,
  erros de 1ª execução, se a resposta degrada bem quando não há contexto (deve
  admitir a falta, não alucinar — §4.4).
- **Fase 2 — volume real**: indexar centenas/milhares de documentos do domínio
  (fiscal/contábil no caso da Elebece). Medir: tempo de `os memory <soul> index`,
  qualidade do retrieval em escala (§4.5), memória/CPU de Ollama + Xenova.
- **Fase 3 — setup representativo**: rodar §4.5 (`--faithfulness --record`) e
  §4.11 nesse ambiente; `os rag eval --history` vira o **relatório de prontidão**
  (hit@1, refusal rate, faithfulness, latência) — material para a proposta comercial.

---

## 6. Caveats / o que NÃO esperar

- **Flags OFF por default.** Sem ligar os da §2, o comportamento é o de antes
  (exceto a citação + a diretriz no prompt de RAG, que são mais restritivas e não
  quebram).
- **`MCP_ZERO_TRUST=on` sem `autonomy` nas souls** nega toda tool L3
  (`action_execute`, `git_commit_push`, `browser_*`, `mission_run`, …). Ligar só
  depois de declarar `autonomy`/`approvalPolicy` nos `config.json`.
- **Suíte do daemon é flaky sob concorrência alta** (timeout de init do Xenova /
  probe do Ollama) — pré-existente; roda verde isolada e no CI (menos paralelo).
- **Golden set é dado de cliente.** O `rag-golden.sample.jsonl` do repo é fixture
  de CI; o real vive em `~/.assistant-os/rag-golden.jsonl`.
- **Não feito** (backlog): Onda 3d (centralizar ~58 `process.env` soltos + schema),
  Onda 3e (quebrar `handleChat` 640 l. e `tools/index.ts` 1859 l.), decisão
  multi-tenant, ADR-PRIV-002 (perfil AI-4 famílias), service token do Cloudflare
  Access, medição dos toggles OFF em staging.
