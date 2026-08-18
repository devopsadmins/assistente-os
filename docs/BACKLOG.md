# Backlog do Assistente OS

Backlog consolidado do projeto. Mantém o que está feito, as pendências de decisão e o roadmap por fases.

## Feito

### Fase 1 — núcleo (concluída)

- Monorepo npm workspaces com 5 pacotes (`core`, `memory`, `daemon`, `tools`, `cli`).
- Core: config, souls, `kernel.db`, custos, roteador local-first, migração.
- Memória: RAG (chunks + embeddings, degrada para literal) e grafo (entidades/relações/observações) em SQLite.
- Migração das 12 almas do SLC-OS (~770 arquivos) para `~/.assistant-os/souls/`.
- Daemon REST + WebSocket (porta 4310) validado com `opencode run` real no Windows.
- CLI `os` (status, souls, chat, memory, migrate, costs, daemon).
- Servidor MCP `assistente-os` (stdio) registrado no opencode global.
- Testes verdes (22 na fase; 7 no pacote tools) e typecheck limpo.

### Infra de credenciais

- 7 providers Zen registrados no `opencode.json` global (`zen-sousa`, `zen-devocional`, `zen-iecsjc`, `zen-evertongame`, `zen-escritor`, `zen-iso`, `zen-avancei`), cada um com `@ai-sdk/openai-compatible`, `baseURL https://opencode.ai/zen/v1` e chave via `{env:ZEN_*_API_KEY}`.
- Chaves do SLC-OS mapeadas para o `.env` da home (`~/.assistant-os/.env`).
- Stitch MCP: migrado para hosted MCP da Google (`https://stitch.googleapis.com/mcp`) com OAuth via `GOOGLE_MCP_CLIENT_ID`/`GOOGLE_MCP_CLIENT_SECRET` (mesmo client de gmail/drive/docs), substituindo o wrapper local `scripts/stitch-mcp.mjs` cujo token OAuth2 (`STITCH_ACCESS_TOKEN`) expirava sem renovação (401).

### Fase 2 — agendador (concluída, 2026-08-18)

- Tabela `agenda` no `kernel.db` ganhou `status`/`attempt`/`last_error`; `claimDueAgenda`/`finishAgendaItem` (`packages/core/src/kernelDb.ts`) espelham o padrão claim/finish já usado por `events.ts`.
- Loop de despacho em background no daemon (`packages/daemon/src/agenda.ts`, `processDueAgenda`): claim → monta contexto da soul → `selectRoute` → `opencode run` → registra custo/execution → finaliza. Rodando a cada 30s (unref) + disparo imediato via `setImmediate` em `POST /agenda`, igual ao padrão de `/events`.
- REST: `GET /agenda` (filtro `?status=`), `POST /agenda`. CLI: `os agenda add`/`os agenda list`. WS: `agenda.added`/`agenda.processed`.
- Corrigido bug pré-existente em `addAgendaItem`: nunca persistia `due_at` e quebrava ao ler o id inserido (`last_insert_rowid()` chamado como método em vez de via `SELECT ... .get()`) — agenda estava de fato inoperante antes desta fase.
- Corrigido `action_execute` (MCP) para marcar o item da agenda como concluído/falho após o despacho síncrono; sem isso o loop do daemon reprocessaria o mesmo item.
- Removido `packages/core/src/scheduler.ts` (não exportado, não usado, e quebrado — abria um `kernel.db` descartável em vez do real).

### Fase 3 — ferramentas do agente (concluída, 2026-08-18)

- Já existia mais do que o roadmap registrava: 14 tools MCP cobrindo busca (`memory_search`, `graph_list`), memória (`memory_index`, `memory_status`, `observation_add`) e ação (`action_execute`, `soul_anotar`, `soul_licao`, `soul_decidir`) — `docs/MCPS.md` só documentava 9. Atualizado para refletir as 16 atuais.
- Adicionadas `agenda_add`/`agenda_list` (MCP) para o próprio agente agendar tarefas via F2, fechando o ciclo entre F2 e F3.

### Fallback do roteador no chat interativo (concluído, 2026-08-18)

- `POST /souls/:id/chat` e o `onChat` do pipeline de voz trocaram `selectRoute` (degrau único, sem sonda) por `route()` com uma sonda barata e segura de repetir (`makeLocalFallbackProbe` em `packages/daemon/src/server.ts`): `GET /api/tags` no Ollama (não roda inferência) para o degrau `local`; `zen`/`soul` são considerados disponíveis (sem health check equivalente pelo daemon). Se o Ollama local não responder, cai para `zen` automaticamente — a execução real do prompt continua acontecendo uma única vez, no degrau vencedor da sonda.
- Corrigido de quebra o `onChat` da voz: abria `openKernelDb(...)` a cada turno e nunca fechava (handle vazando); agora usa `try/finally`.
- Novo teste (`daemon: chat cai para o próximo degrau quando o Ollama local não responde`) aponta `OLLAMA_URL` para uma porta sem listener e confirma que a chamada mockada é executada no tier `zen`.
- **Achado ao investigar:** há um terceiro teste pré-existente desatualizado, `daemon: exposição remota exige token` — espera que `startDaemon({host:"0.0.0.0"})` sem token *rejeite* a Promise, mas o código atual só loga um aviso (`server.ts` ~linha 149) e segue escutando. Comportamento mudou em algum commit anterior não relacionado ao trabalho desta sessão; teste não corrigido (fora de escopo aqui — decidir se o comportamento correto é voltar a rejeitar ou manter o aviso antes de arrumar o teste). Junto com os 2 testes de chat já citados (`chat executa...`, `chat retorna limite...`) que ainda falham por causa do fetch direto ao Ollama bypassando o mock `run`, são 3 testes de `daemon.test.ts` desatualizados no total.

### Cleanup de credenciais Stitch (concluído, 2026-08-18)

- O caminho registrado antes (`~/.assistant-os/.env`) estava errado — os dois `.env` do projeto (repo-root e `~/.assistant-os/.env`, ambos fora do git) já estavam limpos. O segredo real vivia em `~/.config/opencode/.env` (config global do opencode, também fora do repo): removidas as linhas `STITCH_ACCESS_TOKEN` (token OAuth2 expirado) e `STITCH_PROJECT_ID`.
- Removido `scripts/stitch-mcp.mjs` (wrapper local obsoleto do repo) e o diretório `scripts/` (ficou vazio).
- **Descoberto na limpeza:** `docs/MCPS.md` e `docs/ARCHITECTURE.md` afirmavam que o MCP `stitch` hospedado já usava OAuth de verdade (`GOOGLE_MCP_CLIENT_ID`/`GOOGLE_MCP_CLIENT_SECRET`), mas a config viva em `~/.config/opencode/opencode.jsonc` na verdade usa um bearer token estático (`headers.authorization: "bearer {env:stitch_access_token}"`) — o mesmo padrão frágil que a "migração" deveria ter substituído. Com o token removido, a entrada `stitch` do opencode.jsonc fica sem credencial até o OAuth ser de fato configurado; `docs/MCPS.md` atualizado para refletir isso. Ver pendência abaixo.

### Correções de produção (concluídas, 2026-08-18, sessão Claude Code)

- **Tier local destravado no chat.** O modelo `qwen2.5-coder:3b` não estava baixado no Ollama (`docker exec memoria-ollama ollama pull ...`) e, depois, o `fetch()` do Node abortava com "fetch failed" genérico aos 300s (headersTimeout do undici) — tempo que o prompt grande das souls excede em CPU. Trocado por `node:http` (`ollamaChat` em `packages/daemon/src/server.ts`) que respeita o `timeoutSeconds` da requisição (até 600s) e reporta a causa real (corpo do erro do Ollama, `timedOut` em timeout). De quebra: o campo `model` do body agora é respeitado no tier ollama (antes era ignorado).
- **Upload não trava mais a UI.** `POST /souls/:id/upload` reindexava a soul INTEIRA (`indexDirectory`, ~320 arquivos re-embedados via Ollama = horas em CPU) antes de responder — o navegador ficava preso em "enviando…". Agora responde imediatamente após salvar/extrair, indexa só os arquivos novos (`indexFile`) em background e avisa via WS `index.done`; a UI mostra "indexando em segundo plano…" → "indexado: N chunks". Reindex completo continua na CLI (`os memory index`).
- **Senha do Postgres realinhada.** A senha do role `assistente_os` no `memoria-db` divergia do `.env` (alterada por fora ~16:05) — toda conexão nova falhava com "password authentication failed"; a aba TELEMETRIA expunha isso a cada poll (283 falhas nos logs). Corrigido com `ALTER ROLE ... PASSWORD` para o valor do `.env` (fonte de verdade). **Atenção:** quem reprovisionar o banco deve usar a senha do `~/.assistant-os/.env`, nunca gerar outra.

### Decisões descartadas

- **Bytebot como executor de ações de UI (F3)** — avaliado (2026-08-15) e descartado (2026-08-17): agente desktop self-hosted (Docker, Ubuntu+XFCE, `bytebotd` porta 9990, agent NestJS 9991, MCP SSE em `/mcp`, LiteLLM proxy). Conflita com o princípio "sem Docker" do projeto (ARCHITECTURE.md:3); não entra como dependência do núcleo. Se a necessidade de automação de UI (forms, 2FA, extração de arquivos) voltar, avaliar alternativa sem container.
- **Ferramentas Azure DevOps nativas no `packages/tools`** — descartado (2026-08-18): o `tools` é o MCP que o assistente-os EXPÕE (souls/memória/grafo), não integrações que ele consome. O MCP oficial `@azure-devops/mcp` já cobre o caso; duplicar viraria manutenção permanente (auth, API churn) com zero capacidade nova — e não resolveria o chat da interface, que hoje não tem tool-calling em nenhum tier (ver F5).

## Pendências de decisão

- [ ] **Mapear soul → provider Zen** ("a quem pertence"). Decisão adiada pelo usuário. Chaves identificadas até agora: `iecsjc` (auth.json do opencode) e `sousa` (default do SLC-OS). As demais 5 chaves ficam registradas sem uso.
- [ ] **Completar OAuth dos MCPs Google** — reiniciar o opencode para disparar o fluxo de autorização do `stitch` remoto e reautorizar gmail/drive/docs (todos retornaram `Unauthorized` com o mesmo client OAuth). Agora mais urgente para o `stitch`: a entrada em `opencode.jsonc` está sem credencial (bearer token estático removido na limpeza acima) até isso ser feito.
- [ ] **MCP `standards` com caminho Windows quebrado** — `opencode.json` do repo aponta `D:/Projetos/projeto0/...`, inexistente nesta máquina Linux. Corrigir o caminho ou desabilitar a entrada (gera erro/latência a cada run do opencode no repo).
- [ ] **Autenticação do `@azure-devops/mcp`** — confirmar `az login` ou PAT disponível para o daemon/opencode; sem isso as ferramentas aparecem mas falham ao chamar.

## Roadmap por fases

| Fase | Escopo | Status |
|---|---|---|
| **F1** | Núcleo, memória, migração, daemon, CLI, MCP | Concluída |
| **F2** | Agendador: tabela `agenda` no `kernel.db` + dispatch de `opencode run` | Concluída (2026-08-18) |
| **F3** | Ferramentas do agente (busca, memória, ação) | Concluída (2026-08-18) |
| **F4** | Hosting + Stitch MCP em produção | Parcial (MCP já validado) |
| **F5** | Plataforma de agentes (visão: superar o OpenClaw) | Planejada (2026-08-18) |

### F5 — plataforma de agentes (visão: superar o OpenClaw)

Visão do usuário (2026-08-18): centralizar várias coisas no assistente-os até ele ser uma plataforma de agentes melhor que o OpenClaw. Os diferenciais já existentes são a orquestração (router local-first com custos/teto por soul, memória RAG+grafo por soul, servidor MCP próprio, observabilidade) — a briga não se ganha no modelo local (hardware é o gargalo; Ollama é fallback, não protagonista). Itens em ordem de impacto:

1. [ ] **Tool-calling no chat da interface.** Hoje o chat é só texto em todos os tiers: `local` chama o Ollama direto (sem tools) e `zen`/`soul` rodam opencode na pasta da soul, que não enxerga os MCPs do `opencode.json` do repo. Fazer: (a) mover/registrar MCPs úteis na config global `~/.config/opencode/opencode.jsonc`; (b) campo `tier` no body de `POST /souls/:id/chat` + dropdown na UI para forçar `zen`/`soul` quando a tarefa precisa de ferramentas.
2. [ ] **Canais de entrada (WhatsApp/Telegram/e-mail).** Pendurar um gateway de canais no `POST /events` (HMAC já existe; cloudflared já roda na máquina para expor webhook). É o coração do OpenClaw — aqui entra como produtor de eventos, reaproveitando o loop claim/finish existente.
3. [ ] **Sessões multi-turno reais no chat.** Hoje cada prompt é um tiro isolado (a tabela `sessions` só conta turnos). Persistir histórico de mensagens por sessão e injetá-lo no prompt (com orçamento de tokens — lembrar que o contexto default do Ollama é 2048).
4. [ ] **Skills por soul.** Instruções/ferramentas declarativas que cada soul carrega (estilo skills do opencode/Claude Code), versionadas na pasta da soul.

## Padrão

- Segredos nunca em `opencode.json`; usam `{env:VAR}` e ficam no `.env` da home (`~/.assistant-os/.env`), fora do git.
- MCP local com comando direto (sem `npx -y` para pacotes locais).
- Provas de custo imutáveis em `cost_calls`; decisões do roteador em `router_history`.
