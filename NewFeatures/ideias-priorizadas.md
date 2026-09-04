# Ideias — Backlog Especulativo, Priorizado

**Data:** 2026-09-04
**Natureza:** consolidação dos 6 documentos originais da pasta `NewFeatures/` (`governanca.md`, `analise-atendimento-clientes.md`, `Editorial.md`, `mcp-tools-propostas.md`, `projetos-github.md`, `skills-propostas.md`) — **removidos após esta consolidação**. Nenhum item aqui está aprovado ou compromissado; é matéria-prima de brainstorm, não backlog validado.

**Origem do material:** parte vem de fontes externas — "Manual de Engenharia de Prompt da KloxAI Academy (2026)", 127 fontes agregadas no NotebookLM, e uma triagem de repositórios do GitHub (`projetos-github.md` era, literalmente, uma conversa colada de outra sessão de IA). Vários números citados (score de corte "15/20", faithfulness "F ≥ 0.95", health score 0-100) **não foram calibrados** com dado real do sistema — são pontos de partida, não contratos.

**Duplicação identificada e já resolvida aqui:** três dos documentos originais propunham variações da mesma ideia — um portão de qualidade "Generator vs. Discriminator" (`governanca.md` PROP-04 com RAGAS Faithfulness, `projetos-github.md` com um `dev-cycle-graph` completo em LangGraph + código, e `skills-propostas.md` com a skill `dev-cycle-graph`). Consolidados no item **11** abaixo como uma única proposta.

**Revisão crítica externa (`revisao-critica-backlog.md`, "Manus AI", 2026-09-04) — aplicada:** apontou que os itens 5, 9 e 10 tratavam como "a construir" capacidades que **já existem no monorepo**. Verificado em código (não só aceito por argumento): `sales_get_lead_brief`, `spec_grill_plan` e `soul_generate_aiia` já são tools MCP funcionais (`packages/tools/src/index.ts`). Os três itens abaixo foram reescritos como gap analysis/delta, não construção do zero. A recomendação da mesma revisão de **não promover o item 11** (esteira Generator↔Discriminator) foi mantida e reforçada.

## Como ler

- 🟢 **Tier 1** — barato, baixo risco, pode entrar direto no backlog atual quando houver capacidade.
- 🟡 **Tier 2** — valor médio-alto, mas precisa de validação (cliente/caso real puxando) antes de virar código.
- 🔴 **Tier 3** — escopo grande, decisão de produto necessária antes de começar.
- ⚪ **Referência** — não é feature própria, é material de estudo/triagem de ferramentas de terceiros.

---

## 🟢 Tier 1 — baixo esforço, baixo risco

1. **Cláusulas anti-alucinação em souls analíticas** — Ancoragem ("responda só com base nos fragmentos recuperados"), Incerteza Explícita ("não foram encontradas evidências suficientes"), Rastreabilidade/Citação (arquivo+seção de origem), Proibição de Inferência. Só texto em `~/.assistant-os/souls/<soulId>/SOUL.md`, sem código novo. *(origem: governanca.md PROP-03)*

2. **Hierarquia de contexto para prefix caching** — ordenar `packages/daemon/src/context.ts` em 3 camadas por estabilidade: (1) estático — guardrails/FinOps/definições de MCP tools ordenadas lexicograficamente, (2) semi-estático — `SOUL.md`/`perfil.md`, (3) dinâmico — chunks RAG + histórico + mensagem do usuário. Reduz custo de token de entrada (estimativa da fonte: até 90%, não verificada aqui) e melhora TTFT. *(origem: governanca.md PROP-05)*

3. **Padronização C.A.R.E.S. + tags XML nos prompts de sistema** — template `<role>`/`<hard_rules>`/`<golden_rules>`/`<task_scope>`/`<examples>`/`<output_format>`/`<verification>` em `packages/daemon/src/context.ts` (`buildClaudeSystemPrompt`). Montagem determinística, amigável a prefix-cache. *(origem: governanca.md PROP-02)*

4. **Pack de venda "AI-First OS" + comparativo vs. Hermes** — compilar diferenciais já implementados (guardian OTP, temp vault, worktrees ORCA, roteamento em tiers, content filter, 4º loop) em deck/demo. É compilação de material existente, não código. `plano-demonstracao-cto` já é ponto de partida. *(origem: analise-atendimento-clientes.md #1)*

---

## 🟡 Tier 2 — valor médio-alto, validar antes de construir

5. **Dossiê pré-call automatizado** — ⚠️ **correção pós-revisão crítica (verificado em código, 2026-09-04): `sales_get_lead_brief` já existe e funciona** (`packages/tools/src/index.ts:373,1322`). Não é feature nova — é **gap analysis**: falta só `sales_prepare_demo` e `sales_roi_pack` (esses sim ausentes) + empacotar os três numa skill `revisao-pre-venda`. Esforço real é bem menor do que "construir do zero". Só compensa se houver pipeline comercial ativo puxando isso. *(origem: mcp-tools-propostas.md §2.1, skills-propostas.md §2.1)*

6. **Catálogo de "flows validados por nicho"** — registrar o que o 1º cliente de cada vertical ensina pra entregar o 2º/3º mais rápido (curva de reuso 30→60→80% do playbook citado). Alto valor de margem, mas só faz sentido com 2+ clientes do mesmo nicho — hoje não há massa crítica confirmada. *(origem: analise-atendimento-clientes.md #4)*

7. **Auditoria de RAG por cliente (enterprise-grade)** — skill `auditoria-rag-empresarial` + tools `sales_client_rag_audit`/`compliance_audit_rag`: coverage, precision@k, recall@k, contaminação, higiene de grafo temporal. Bom diferencial de venda ("relatório de prontidão"), esforço médio, mas depende de `graph_list` e amostra de queries reais do domínio do cliente. *(origem: mcp-tools-propostas.md §2.1/§2.2, skills-propostas.md §2.3)*

8. **Oferta "Segurança para IA" como serviço à parte** — empacotar ISO 42001/ANPD/OWASP/guardrails (guardian, content filter, temp vault, AIIA.md já existem) usando material já pronto (12 slides + infográfico Mermaid). *(origem: analise-atendimento-clientes.md #2)*

9. **Validador P.Q.A. automatizado de prompts de skills** — ⚠️ **correção pós-revisão crítica (verificado em código, 2026-09-04): `spec_grill_plan` já existe e funciona** (`packages/tools/src/index.ts:385,1332`, fluxo de 2 fases já implementado). O P.Q.A. não é uma tool nova paralela — é um **scorecard/modo de auditoria sobre o Spec Grill existente**, não um subsistema novo. Nota de corte "< 15/20" ainda não foi calibrada — pilotar como relatório informativo antes de virar gate bloqueante. *(origem: governanca.md PROP-01)*

10. **Runbook de onboarding LGPD/ANPD** — ⚠️ **correção pós-revisão crítica (verificado em código, 2026-09-04): `soul_generate_aiia` já existe e funciona** (`packages/tools/src/index.ts:277,1231` — gera/regrava `AIIA.md` da soul, idempotente). O artefato central já existe; o valor real da ideia está só na **orquestração** (fluxo de onboarding, validação de `consent_evidence_ref`, evidência regulatória coordenada) — renomear mentalmente pra "orquestração de onboarding LGPD", não "gerar AIIA.md". **Depende de fechar ADR-PRIV-002/AI-005 primeiro** (já está em `backlog-atual.md`) — não duplicar o trabalho do ADR aqui, só a automação em cima dele. *(origem: mcp-tools-propostas.md §2.2, skills-propostas.md §2.2)*

---

## 🔴 Tier 3 — escopo grande, decisão de produto antes de codar

11. **Esteira automatizada Generator↔Discriminator via LangGraph** *(consolidação de 3 propostas originais — ver nota de duplicação no topo)*. Grafo `spec_grill → generator → discriminator (score≥95) → safe_merge / record_lesson`, com `MemorySaver`, guardrail de 5 iterações, e integração com `worktree-manager.ts`. **Não promover.** Confirmado que sobrepõe mecanismos já existentes (`spec_grill_plan`, Guardian/golden-rules, worktrees) e — mais importante — reduz revisão humana exatamente onde o risco de merge é maior. Se algum dia isso for reconsiderado: medir primeiro o fluxo manual atual (onde ele realmente trava) e automatizar só o gargalo observado, não o ciclo inteiro. *(origem: governanca.md PROP-04, projetos-github.md §"gstack", skills-propostas.md §2.4)*

12. **Soul `editorial-commander` + pipeline editorial completo** — scaffolding de soul (`SOUL.md`/`perfil.md`/`contexto.md`/`licoes.md`), 3 tools (`editorial_add_idea`, `editorial_get_pipeline_status`, `editorial_generate_drafts`) e skill `editorial-vertical`, com loop de sinais semanal (commits/ADRs sem cobertura editorial). Automação de marketing de conteúdo (Substack/DEV/Medium/LinkedIn) pra prospecção inbound. Sem sinal de demanda validada ainda — é aposta de canal, não pedido de cliente. *(origem: Editorial.md, mcp-tools-propostas.md §2.3, skills-propostas.md §2.5)*

13. **Monitor de gargalos preditivos / Inteligência Gerencial** — skill `monitor-gargalos-clientes` + tools `client_health_score`/`bottleneck_alert`: health score 0-100, alertas de leads perdidos/no-show/follow-up/SLA. Precisa de histórico de dados de clientes suficiente pra calibrar os thresholds — prematuro com a base atual de clientes. *(origem: analise-atendimento-clientes.md #10, mcp-tools-propostas.md §2.5, skills-propostas.md §2.6)*

14. **Integração Lago (faturamento por uso) + Novu (notificações multicanal)** — só faz sentido quando/se o produto for exposto como API cobrada por volume/tokens pra terceiros. Hoje não há esse modelo de cobrança ativo. *(origem: analise-atendimento-clientes.md #7, mcp-tools-propostas.md §1)*

15. **MCP externos de suporte** — Postgres analytics (read-only, queries de custo/uso/qualidade RAG), Google Drive (OAuth2 PKCE, ingestão de docs do cliente no RAG). Infra de apoio às ideias 6/7/13 acima, não standalone — só priorizar junto com o item que os consome. *(origem: mcp-tools-propostas.md §1)*

16. **MCP wrapper para WhatsApp (sobre Baileys)** — provavelmente desnecessário: o canal WhatsApp já é nativo no daemon (Baileys, SP6-01), sem precisar de camada MCP extra. Reavaliar só se surgir um caso de uso que precise expor isso como tool pra um agente externo. *(origem: mcp-tools-propostas.md §1)*

---

## ⚪ Referência — triagem de ferramentas externas

*(origem: `projetos-github.md`, que era uma lista de ~14 ferramentas de mercado avaliada em outra sessão de IA — não é feature própria do assistente-os)*

**Vale estudar o padrão, não necessariamente adotar a ferramenta:**
- **gstack** (Garry Tan/Claude Code) — fluxos Plan/Review/QA; o padrão já foi absorvido no item 11 acima.
- **shadcn/ui** — padrão de componente entregue direto no projeto (sem dependência pesada); já é essencialmente o que `packages/ui` faz hoje.
- **Last 30 Days** — pesquisa de mercado/dores em redes sociais (Reddit, X); pode alimentar descoberta de gargalos pra prospecção.

**Úteis só em caso de uso específico futuro:**
- **OpenReplay** — gravação de sessão de usuário, só relevante com tráfego externo relevante.
- **Claude for Legal** — prompts de referência oficiais da Anthropic; vale inspecionar pra calibrar a soul jurídica/NDA.
- **Papermark** — tracking de quem abriu proposta comercial em PDF.
- **Cap Software** — geração de demo em vídeo.
- **Formbricks** — pesquisas de CSAT/NPS in-app.

**Descartados** (avaliação já feita no material original, mantida aqui por registro):
- **Dify** — conflita com o LangGraph próprio (StateGraph determinístico + guardrails FinOps).
- **Supabase** — conflita com a arquitetura local-first (Markdown canônico + Postgres/pgvector nativo).
- **qm** (Y Combinator) — já coberto por souls departamentais + catálogo de MCP tools.
- **"Marketing skills for AI agents"** — skills de Marketing/CRO/SEO/Copywriting já mapeadas e concluídas no monorepo.

---

## Próximo passo sugerido

Nada aqui está aprovado. Pra puxar um item pra execução: promova pro `backlog-atual.md` citando o número deste arquivo, com prioridade P0–P3 e esforço estimado, no mesmo formato dos outros `docs/BACKLOG-*.md`.
