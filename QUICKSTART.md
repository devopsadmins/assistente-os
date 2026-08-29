# Quick Start — Assistente OS

Guia completo para configurar e rodar o Assistente OS do zero.

## 1. Pré-requisitos

| Requisito | Versão mínima | Obrigatório? |
|-----------|---------------|-------------|
| Node.js | >= 22.5 | Sim |
| Ollama | Qualquer | Não (mas sem ele o tier `local` não funciona) |
| PostgreSQL + pgvector | 17+ | Não (o kernel.db usa SQLite; Postgres é para RAG/grafo) |
| `postgresql-client` (`pg_dump`) | Qualquer | Não (backup sem dump continua funcionando) |

## 2. Instalação

```bash
cd assistente-os
npm install
npm run build
```

Verificar que tudo compila:

```bash
npm run typecheck
npm test          # requer PostgreSQL rodando (ver seção 4)
```

## 3. Configuração

Crie o diretório home e o arquivo `.env`:

```bash
mkdir -p ~/.assistant-os
```

Crie `~/.assistant-os/.env` com as variáveis necessárias:

```env
# --- Banco de dados (PostgreSQL) ---
DATABASE_URL=postgres://assistente_os:assistente_os@localhost:5432/assistente_os

# --- Ollama (local-first) ---
OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5-coder:3b
OLLAMA_EMBED_MODEL=nomic-embed-text

# --- Roteador (opcional — padrão: local → zen → soul) ---
# ASSISTENTE_OS_ROUTER_TIERS=local,zen,soul

# --- Segurança (opcional) ---
# ASSISTENTE_OS_WEBHOOK_SECRET=<secret-para-HMAC>
# ASSISTENTE_OS_DAEMON_TOKEN=<token-para-acesso-remoto>
# ASSISTENTE_OS_MAX_TURNS=10

# --- Azure DevOps (opcional) ---
# ADO_ORG=sousalimaconsultoria
# ADO_PAT=<seu-pat>

# --- OpenCode Zen (opcional — free-tier via opencode.ai) ---
# ZEN_BASE_URL=https://opencode.ai/zen/v1
# ZEN_CHAT_MODEL=nemotron-3-ultra-free
# Uma chave só:
# ZEN_API_KEY=<chave>
# Ou várias, usadas em rodízio (round-robin) por chamada em chat/RAG/LangGraph —
# espalha o consumo entre até 7 chaves gratuitas. Lista separada por vírgula:
# ZEN_API_KEYS=<chave1>,<chave2>,<chave3>
# (alternativa: ZEN_API_KEY_1 .. ZEN_API_KEY_7, uma por variável)

# --- RAG (opcional) ---
# Reranker: reordena os chunks recuperados por relevância par (query, trecho)
# antes de cortar no limite. "cross-encoder" = modelo local sem custo; "llm" =
# pergunta 0-3 ao Ollama por trecho. NOTA (ADR-RAG-001 §6): o modelo default
# (Xenova/ms-marco-MiniLM-L-6-v2) é só-inglês e PIORA corpora PT-BR — aponte
# RAG_RERANK_CE_MODEL para um cross-encoder multilíngue (ex.: Xenova/bge-reranker-base).
# RAG_RERANK=cross-encoder
# RAG_RERANK_TOPN=20          # quantos candidatos buscar antes de reordenar
# RAG_RERANK_TOPK=5           # quantos manter após o rerank
# RAG_RERANK_CE_MODEL=Xenova/bge-reranker-base        # cross-encoder multilíngue (PT-BR ok)
# RAG_RERANK_BUDGET_MS=30000  # orçamento p/ reordenar 1 consulta; estourou -> ordem original (0 desliga)
# RAG_INJECTION_MODO=aviso    # aviso | recusar (descarta chunk de severidade alta)
# RAG_HNSW_EF_SEARCH=40       # ef_search fixo na busca vetorial (reprodutibilidade)
#
# Cache semântico do RAG (docs/RAG-CACHE.md) — acima do cache exato; acerta em
# paráfrase (cosseno do embedding >= threshold). Desligado por default.
# RAG_SEMANTIC_CACHE=on
# RAG_SEMANTIC_CACHE_THRESHOLD=0.85   # cosseno mínimo p/ hit (0.5–0.999)
# RAG_SEMANTIC_CACHE_TTL=60           # TTL das entradas em s (1–3600)
#
# Escalonamento por confiança do roteador (docs/ROUTER-ESCALATION.md) — após a
# resposta do tier local, sobe um degrau se ela for fraca. Desligado por default.
# ROUTER_ESCALATION=on
# ROUTER_ESCALATION_MIN_SCORE=0.55        # score RAG abaixo do qual aciona o juiz LLM
# ROUTER_ESCALATION_MIN_CHARS=40          # resposta menor que isto (trim) escala sem juiz
# ROUTER_ESCALATION_MAX_PER_SESSION=1     # teto de escalonamentos por sessão
# ROUTER_ESCALATION_COOLDOWN_MIN=10       # cooldown (min) entre escalonamentos da sessão
# ROUTER_ESCALATION_FAST_ONLY=1           # 0 = também escala em mode=pro
```

### Variáveis de ambiente importantes

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `ASSISTENTE_OS_HOME` | `~/.assistant-os` | Diretório raiz (souls, configs, backups) |
| `DATABASE_URL` | `postgres://assistente_os:assistente_os@localhost:5432/assistente_os` | Conexão PostgreSQL |
| `OLLAMA_URL` | `http://localhost:11434` | Endpoint do Ollama |
| `OLLAMA_CHAT_MODEL` | `qwen2.5-coder:3b` | Modelo de chat |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Modelo de embeddings |
| `AOS_HOST` | `127.0.0.1` | Bind address do daemon |
| `AOS_PORT` | `4310` | Porta do daemon |
| `ZEN_API_KEYS` | — | Chaves OpenCode Zen em rodízio (round-robin por chamada); vírgula-separadas. Alternativas: `ZEN_API_KEY_1..7` ou `ZEN_API_KEY` (uma só) |
| `ZEN_CHAT_MODEL` | `nemotron-3-ultra-free` | Modelo usado no tier `zen` |
| `RAG_RERANK` | `off` | Reranker do RAG: `off` \| `cross-encoder` (local) \| `llm`. **Modelo default só-inglês piora PT-BR** — ver [ADR-RAG-001 §6](docs/adr/ADR-RAG-001.md). Latência em `aos_rag_rerank_seconds` |
| `RAG_RERANK_CE_MODEL` | `Xenova/ms-marco-MiniLM-L-6-v2` | Modelo do cross-encoder. Para PT-BR: `Xenova/bge-reranker-base` (multilíngue, verificado). Lido em runtime |
| `RAG_RERANK_BUDGET_MS` | `30000` | Orçamento p/ reordenar 1 consulta; estourou → volta à ordem por score original. `0` desliga o teto |
| `RAG_INJECTION_MODO` | `aviso` | Screening de prompt injection em chunks de RAG: `aviso` \| `recusar` |
| `RAG_HNSW_EF_SEARCH` | `40` | `ef_search` fixado na busca vetorial HNSW (reprodutibilidade) |
| `RAG_SEMANTIC_CACHE` | `off` | Cache semântico do RAG (`on` liga). `_THRESHOLD` `0.85`, `_TTL` `60`. Ver [docs/RAG-CACHE.md](docs/RAG-CACHE.md) |
| `REDIS_URL` | — | Se setada, o daemon conecta o cache em camadas ao Redis no boot → cache exato e semântico do RAG **compartilhados entre instâncias**. Sem ela, só memória do processo |
| `ROUTER_ESCALATION` | `off` | Escalonamento por confiança do roteador (`on` liga). `_MIN_SCORE` `0.55`, `_MIN_CHARS` `40`, `_MAX_PER_SESSION` `1`, `_COOLDOWN_MIN` `10`, `_FAST_ONLY` `1`. Juiz LLM local + tetos por sessão. Ver [docs/ROUTER-ESCALATION.md](docs/ROUTER-ESCALATION.md) |
| `MCP_ZERO_TRUST` | `off` | `on` liga o enforcement de **autonomia × nível de risco** no gate de tools do MCP e do agente LangGraph (`ask` bloqueia L3 sem confirmação; `suggest` bloqueia L2/L3). Desligado = só a allowlist (comportamento pré-Onda-1). A **allowlist** e o **filtro de tools do LangGraph** valem sempre. Ligar só depois de declarar `autonomy`/`approvalPolicy` nas souls |
| `AOS_RATE_LIMIT` | `600` | Máx. de requisições por cliente por janela (`X-Client-Id` \| hash do token \| IP). Estouro → `429` + `Retry-After`. `0` desliga. `_WINDOW_SEC` `60` |
| `AOS_MAX_CONCURRENT_EXEC` | `8` | Máx. de execuções caras simultâneas (`/chat`, `/api/missions/*`, `/api/pipelines/*`). Estouro → `503` sem fila. `0` desliga |

> Um `.env.example` na raiz do repo lista todas as variáveis com valores de
> exemplo — copie o que precisar para `~/.assistant-os/.env`.

## 4. PostgreSQL (obrigatório)

Toda a persistência derivada (RAG + grafo, sessões, custos, agenda, eventos,
`execution_logs`) vive no PostgreSQL com **pgvector**. O markdown em
`~/.assistant-os/souls/` é a fonte canônica; o Postgres é reconstruível.

### Via Docker Compose (recomendado)

```bash
docker compose up -d postgres
```

Isso cria um container `pgvector/pgvector:pg17` com:
- Usuário: `assistente_os`
- Senha: `assistente_os`
- Database: `assistente_os`
- Porta: `5432`

### Via instalação nativa

```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER assistente_os WITH PASSWORD 'assistente_os';"
sudo -u postgres psql -c "CREATE DATABASE assistente_os OWNER assistente_os;"
sudo -u postgres psql -d assistente_os -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## 5. Ollama (local-first)

O roteador tenta o Ollama primeiro (`tier local`). Sem ele, o sistema degrada para `zen` (free-tier cloud).

```bash
# Instalar Ollama (se ainda não instalado)
curl -fsSL https://ollama.com/install.sh | sh

# Iniciar o servidor
ollama serve

# Baixar os modelos necessários (em outro terminal)
ollama pull qwen2.5-coder:3b      # chat
ollama pull nomic-embed-text       # embeddings
```

Verificar que o Ollama está respondendo:

```bash
curl http://localhost:11434/api/tags
```

### Fallback de embeddings

Se o Ollama estiver offline, o sistema usa `@xenova/transformers` (`multilingual-e5-base`) como fallback local (sem rede, ~20ms de latência). A busca semântica continua funcionando.

## 6. Primeira Soul

Souls são personas AI isoladas, cada uma com seu contexto, memória e grafo de conhecimento.

### Estrutura de uma soul

```
~/.assistant-os/souls/<id>/
├── config.json       # metadados (nome, descrição, provider)
├── perfil.md         # personalidade
├── contexto.md       # contexto de negócio
├── licoes.md         # lições aprendidas
├── pessoas.md        # diretório de pessoas
├── soul.md           # definição da soul
├── sessoes/          # histórico de sessões
└── sources/          # fontes de conhecimento (md, txt)
```

### Criar uma soul manualmente

```bash
mkdir -p ~/.assistant-os/souls/meu-assistente

cat > ~/.assistant-os/souls/meu-assistente/config.json << 'EOF'
{
  "name": "Meu Assistente",
  "description": "Assistente pessoal para tarefas gerais",
  "provider": "ollama",
  "model": "qwen2.5-coder:3b",
  "dailyLimit": 100
}
EOF

cat > ~/.assistant-os/souls/meu-assistente/perfil.md << 'EOF'
# Perfil
Assistente técnico, direto e prático. Fala português brasileiro.
EOF

cat > ~/.assistant-os/souls/meu-assistente/contexto.md << 'EOF'
# Contexto
Trabalho com desenvolvimento de software e ops.
EOF
```

### Definir como soul ativa

```bash
npm run os soul meu-assistente ativa
```

## 7. Comandos Essenciais

```bash
# Status do sistema
npm run os status

# Listar souls
npm run os souls

# Ver config de uma soul
npm run os soul meu-assistente

# Chat com uma soul
npm run os chat meu-assistente "qual é o meu contexto?"

# Indexar memória (RAG)
npm run os memory meu-assistente index

# Busca semântica
npm run os memory meu-assistente search "assuntos recentes"

# Status da memória (chunks + grafo)
npm run os memory meu-assistente status

# Knowledge graph
npm run os graph meu-assistente list

# Custos por soul
npm run os costs

# Agenda
npm run os agenda add meu-assistente "Revisar documentação"
npm run os agenda list
```

## 8. Daemon REST + WebSocket

O daemon expõe uma API REST e WebSocket para integração com UIs, webhooks e automações.

```bash
# Iniciar (porta padrão: 4310)
npm run os daemon

# Em outro terminal, testar:
curl http://127.0.0.1:4310/health
```

### Principais endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Status + lista de souls |
| GET | `/souls` | Lista todas as souls |
| GET | `/souls/:id` | Detalhe de uma soul |
| GET | `/souls/:id/context` | Contexto concatenado |
| POST | `/souls/:id/chat` | Chat headless (body: `{ prompt, tier? }`) |
| POST | `/souls/:id/memory/search` | Busca RAG (body: `{ query, k? }`) |
| GET | `/souls/:id/graph` | Knowledge graph |
| GET | `/sessions/stats` | Total de sessões |
| GET | `/costs` | Custos por soul |
| GET | `/router/status` | Status do roteador |
| POST | `/agenda` | Criar tarefa agendada |
| GET | `/agenda?status=pending` | Listar tarefas |
| POST | `/events` | Webhook (requer HMAC) |
| WS | `/` | WebSocket event hub |

### Acesso remoto (Cloudflare Tunnel)

O `docker compose` lê `TUNNEL_TOKEN` de `.env` na raiz do repo — que deve ser
um symlink pro `.env` real da instalação (`~/.assistant-os/.env`), pra cada
clone/máquina usar suas próprias credenciais sem nada de secreto no git:

```bash
# Setup (uma vez por clone)
ln -s ~/.assistant-os/.env .env
echo "TUNNEL_TOKEN=<seu token do Cloudflare Zero Trust>" >> ~/.assistant-os/.env

# Via Docker Compose
docker compose up -d tunnel

# Ou manualmente
cloudflared tunnel run --url http://127.0.0.1:4310
```

### Processo com PM2

```bash
# Opm2 já está configurado em ecosystem.config.cjs
pm2 start ecosystem.config.cjs
pm2 logs assistente-os
```

## 9. Backup e Recovery

### Criar backup

```bash
npm run os backup
# Saída: backup-2026-08-19T12-00-00-abc12345.zip em ~/.assistant-os/
```

O backup inclui:

| Conteúdo | Obrigatório? |
|----------|-------------|
| `souls/` (todas as souls) | Sim |
| `.env` (chaves, senhas) | Sim |
| `active.json` | Sim |
| `kernel.db` (custos, agenda, eventos) | Sim |
| `config.local.json` | Se existir |
| `database.dump` (PostgreSQL via `pg_dump`) | Se `postgresql-client` instalado |

### O que o backup NÃO inclui

- Sessões de chat anteriores (em `sessoes/`, mas são markdowns — incluídos como arquivos)
- Estado do Ollama (modelos precisam ser baixados novamente)

### Restore manual

```bash
# 1. Descompactar
unzip backup-*.zip -d ~/.assistant-os/

# 2. Restaurar banco (se o dump existe)
pg_restore --clean --if-exists -d "$DATABASE_URL" database.dump

# 3. Reiniciar daemon
npm run os daemon
```

### Segurança

- O ZIP contém `.env` com chaves de API — **armazene em local seguro**
- Permissões do arquivo: `0o600` (somente owner)
- Manifesto interno (`manifest.json`) indica se o dump foi incluído (`database.ok`)

### Restore sem pg_dump

Se o backup foi feito sem `pg_dump` (binário ausente), o manifesto terá `"database": { "ok": false, "error": "..." }`. Nesse caso, apenas os arquivos de configuração e souls são restaurados — os dados de RAG/grafo (chunks, embeddings, entidades) precisam ser re-indexados:

```bash
npm run os memory <soul> index
```

### Automação (cron)

```bash
# Backup diário às 3h
0 3 * * * cd /path/to/assistente-os && npm run os backup 2>> ~/.assistant-os/backup.log

# Rotação: manter últimos 7 backups
0 4 * * * find ~/.assistant-os -name "backup-*.zip" -mtime +7 -delete
```

## 10. Troubleshooting

### Ollama não responde

```
Erro: fetch failed / Connection refused
```

```bash
# Verificar se está rodando
curl http://localhost:11434/api/tags

# Se não estiver, iniciar
ollama serve

# Se estiver no Docker, verificar se o host.docker.internal resolve
docker exec <container> curl http://host.docker.internal:11434/api/tags
```

### PostgreSQL: password authentication failed

```
Error: password authentication failed for user "assistente_os"
```

A senha do `.env` diverge da senha real do role. Corrigir:

```bash
sudo -u postgres psql -c "ALTER ROLE assistente_os WITH PASSWORD 'assistente_os';"
```

### pg_dump ausente (backup sem dump)

```
aviso: dump do banco falhou, backup segue só com os arquivos
```

Instalar o cliente PostgreSQL:

```bash
# Ubuntu/Debian
sudo apt install postgresql-client

# macOS
brew install postgresql@17
```

O backup continua funcionando sem `pg_dump` — apenas os dados de RAG/grafo não são incluídos.

### Testes falham

```bash
# Verificar se PostgreSQL está rodando (testes o usam)
docker compose up -d postgres

# Rodar testes com DATABASE_URL
DATABASE_URL=postgres://assistente_os:assistente_os@localhost:5432/assistente_os npm test
```

### Build com erros de tipo

```bash
npm run build     # compila tudo
npm run typecheck # verifica tipos sem emitir
```

## 11. Próximos passos

- [Arquitetura detalhada](docs/ARCHITECTURE.md)
- [Ferramentas MCP](docs/MCPS.md)
- [Provedores gratuitos](docs/FREE_PROVIDERS.md)
- Status e pendências: seção **Status** do [README](README.md)
