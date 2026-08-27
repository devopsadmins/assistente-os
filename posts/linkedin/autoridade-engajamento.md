# Posts LinkedIn — Autoridade + Engajamento (sem citar nome do sistema)

---

## Post 1 — Arquitetura multi-tenant com isolamento real

**Hook:** A maioria dos "multi-tenant" SaaS compartilha banco e torce pra não vazar dados.

**Contexto:** Isolamento de verdade não é row-level security. É arquivo, processo, rede e custo separados por cliente — sem multiplicar infra por N.

**Insights:**
- Cada soul (cliente) roda em worktree git isolada + SQLite próprio (`kernel.db`, `memory.db`)
- Custos rastreados por chamada no kernel — fatura por uso real, não "seats"
- Daemon spawna `opencode run` headless sob demanda; zero idle cost
- Deploy: worktree → build → test → merge local → PR. Rollback = `git reset`

**Aplicação:** Isso elimina "noisy neighbor", vazamento cross-tenant e surpresa na fatura.

**Pergunta:** Como vocês resolvem isolamento de dados/custo em arquitetura shared-infra hoje?

#arquitetura #multitenant #saas #isolamento #custos

---

## Post 2 — Roteamento de modelos: não é "um modelo pra tudo"

**Hook:** Usar GPT-4o pra tudo é queimar dinheiro. Usar só local é alucinar em produção.

**Contexto:** O roteador certo escolhe *por tarefa*: classificação → local (rápido, barato); reasoning complexo → cloud (preciso); streaming → edge (latência).

**Insights:**
- Tier `local`: Ollama + fallback `@xenova/transformers` (zero cloud)
- Tier `zen`: modelos premium via provider (Claude, GPT) — só quando vale a pena
- Tier `soul`: modelo especializado por domínio (treinado no contexto do cliente)
- Router decide em <50ms com cache semântico de decisões anteriores

**Aplicação:** Reduz custo 60-80% vs "sempre cloud" mantendo qualidade onde importa.

**Pergunta:** Vocês roteiam por tarefa ou travam num único provider/modelo?

#llmops #roteamento #custoeficiencia #arquiteturaia #modelrouting

---

## Post 3 — RAG + Knowledge Graph: os dois, não "ou"

**Hook:** RAG acha o *qué*. Knowledge Graph sabe o *como* e *porquê* se conectam.

**Contexto:** Chunks + embeddings falham em relações multi-hop ("quem aprovou o contrato que originou o ticket X?"). Grafo resolve, mas não escala sozinho.

**Insights:**
- `memory.db` (SQLite por soul): chunks vetoriais + entidades/relações/observações
- Indexação idempotente: re-roda sem duplicar, detecta delta
- Busca híbrida: semântica (top-k) → expande no grafo (2-3 hops) → re-rank
- Degradação graciosa: sem Ollama → embedding local (transformers.js)

**Aplicação:** Respostas com provenance (cita chunk + mostra caminho no grafo).

**Pergunta:** Já precisaram de "raciocínio relacional" sobre docs e o RAG puro falhou?

#rag #knowledgegraph #memoriaia #buscahibrida #engenhariadeprompt

---

## Post 4 — Guardian: governança algorítmica com "human-in-the-loop" real

**Hook:** Agente erra → loga lição → 3ª reincidência = regra global proposta → humano aprova via Telegram. Isso é governança, não "guardrail".

**Contexto:** A maioria para em "system prompt + eval". Governança viva exige: incidente → causa raiz → regra corretiva → aprovação rastreável → propagação automática.

**Insights:**
- `soul_record_lesson`: agente registra erro + causa raiz + regra corretiva
- Após 3 reincidências do mesmo tópico → `guardian_promote_golden_rule`
- Aprovação **exige código 6 dígitos no Telegram** (prova de revisão humana)
- Aprovada → grava em `.opencode/rules/golden-rules.md` + `AGENTS.md` + prompt ativo de **todas** souls

**Aplicação:** Erro vira regra sistêmica uma vez, não repetido N vezes.

**Pergunta:** Como sua equipe transforma incidentes de agente em regras que *todos* os agentes passam a seguir?

#governancaia #guardrails #humanintheloop #qualidadedeia #engdesoftware

---

## Post 5 — Mission Runner (ORCA): automação composta, não "script"

**Hook:** `curl | bash` não escala. Automação de produção precisa: browser, agenda, ingest, validação, rollback — tudo versionado e auditável.

**Contexto:** Missão = DAG de etapas tipadas (L1/L2/L3) com modo `headless`/`guarded`/`full`. Cada etapa declara efeito externo e contrato de entrada/saída.

**Insights:**
- Etapas: `browser_navigate`, `browser_extract`, `agenda_add`, `action_execute`, `memory_index`
- Modo `guarded`: para em cada etapa, pede confirmação humana (auditoria)
- Modo `full`: roda autônomo, gera relatório + screenshots auditados (hash SHA-256)
- Persistência: `missions/<id>.json` versionado; re-executável, debugável

**Aplicação:** Onboarding de cliente, ingest de docs, deploy controlado — tudo como "missão" reprodutível.

**Pergunta:** Vocês versionam automações operacionais como código ou ainda têm "scripts soltos no servidor"?

#automacao #orca #missionrunner #devops #engenhariadeplataforma