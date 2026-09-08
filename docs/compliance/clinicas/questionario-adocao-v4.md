# Questionário de Adoção v4.0 — Vertical Clínicas (`clinica_template`)

**Instrumento oficial de adoção da v4.0 — perfil AI-4 (confirmado via `standards_classify_profile`).**
Preenchido em 2026-09-07. ADR de adoção: [`ADR-PRIV-003`](../../adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md).
Perfil AI-4 exige todos os blocos: G + 1–14.

> Legenda: **Sim** = evidência anexada (Princípio 10). **Parcial** = observação + plano +
> prazo + owner. **Não** = sem controle hoje. Pendências numeradas (P1–P8) remetem à tabela
> §5 do `ADR-PRIV-003`.

## Bloco G — Gates de bloqueio

| G# | Pergunta | Resposta | Evidência / observação |
|---|---|---|---|
| G1 | Conflito entre obrigação legal e o fluxo atual? | **Sim** (aprovado) | Nenhum conflito identificado — `standards_gate_blockg` |
| G2 | Segredo/credencial exposta? | **Sim** (aprovado) | `TempVault`/`purgeCredentials` (`packages/core/src/security/temp-vault.ts`) |
| G3 | Dado pessoal sem base legal/finalidade/retenção? | **Não** (reprovado) | Base legal, finalidade e retenção pendentes — P1/P4 do `ADR-PRIV-003` |
| G4 | Transferência internacional sem avaliação? | **Não** (reprovado) | Provedor de mensageria ainda não escolhido — P6 |
| G5 | Ação irreversível sem aprovação humana? | **Não** (reprovado) | `clinic_prevent_noshow` seria `L3`, mas `MCP_ZERO_TRUST` desligado por padrão — P8 |

**Veredito** (`standards_gate_blockg`): **BLOCKED** — G3/G4/G5 reprovados, cada um virou item
de roadmap datado com owner no `ADR-PRIV-003` §5.

## Bloco 1 — Classificação do produto

| # | Pergunta | Resposta |
|---|---|---|
| 1.1 | Perfil declarado | **AI-4** (`standards_classify_profile`: dado sensível em runtime força reclassificação) |
| 1.2 | Multitenant? Isolamento/testes cross-tenant | A definir — P7 do ADR. Hoje `clinica_template` é soul única (template), sem tenant real; suíte de isolamento cross-tenant não existe |
| 1.3 | Dado sensível/biométrico em runtime? | **Sim** — procedimento médico e agenda de paciente (dado de saúde). Biometria real (fotos) a confirmar — P5 |
| 1.4 | Decisão automatizada com efeito jurídico/impacto relevante? | Parcial/a confirmar — `clinic_triage_lead` gera score que influencia priorização comercial; se afetar diretamente o atendimento do paciente, também dispara Bloco 14.1/14.2 |
| 1.5 | Dependência de IA em runtime? | **Sim** — mesmo router local-first (Ollama/Zen) do resto do repo |

## Bloco 2 — Governança e papéis

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 2.1 | Matriz RACI cobre o ciclo de vida completo? | Não | Só owners provisórios no `ADR-PRIV-003` (Identificação); RACI completo pendente |
| 2.2 | Segregação de funções controlada tecnicamente? | Parcial | Catálogo L1/L2/L3 + `authorizeExecution()` existe; efetividade depende de `MCP_ZERO_TRUST=on` (P8) |
| 2.3 | Ciclo de vida de ADR em uso? | Sim | Este processo — `docs/adr/ADR-PRIV-003-*.md`, versionado, com gatilhos de reavaliação (§8) |
| 2.4 | DPO nomeado com substituto e canal operacional? | Não | P3 pendente |
| 2.5 | Aceitações de risco residual em ata, com revisão? | Parcial | Exceção do Bloco 14 registrada no ADR §7 (validade + condição de encerramento); sem ata formal de órgão de governança ainda |

## Bloco 3 — Fornecedores, terceiros e nuvem

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 3.1 | Due diligence de fornecedores registrada? | Não | Depende do provedor de mensageria — P6 |
| 3.2 | Contratos cobrem LGPD/auditoria/incidente? | Não | Idem P6 |
| 3.3 | Provedor de IA sem treinamento/retenção de dados do cliente? | Não verificado | Herdaria a config Zen/Ollama já usada no repo geral — não auditado especificamente para clínicas |
| 3.4 | Modelo de responsabilidade compartilhada registrado? | Não | Pendente |
| 3.5 | Plano de saída com exportabilidade? | Não | Pendente |
| 3.6 | Região de processamento/DR avaliada (transferência)? | Não | Depende de P6 |

## Bloco 4 — Privacidade no produto (LGPD)

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 4.1 | Classificação da informação por tipo de dado? | Parcial | Sabemos que é dado de saúde (sensível); taxonomia completa (comum/sensível/biométrico) depende de P5 |
| 4.2 | Retention schedule versionado, com descarte? | Não | P4 pendente (não herdar `FAMILIAS_RETENCAO_DIAS`=1825 por analogia) |
| 4.3 | AIP/DPIA como gate de engenharia? | Não | Não implementado |
| 4.4 | ROPA atualizado e sincronizado com código? | Não | Depende de P1–P4 |
| 4.5 | Consentimento específico, com prova e revogação? | Não | Padrão reaproveitável existe (`consent_evidence_ref`, domínio famílias — `ADR-PRIV-001` §8 P2), ainda não portado |
| 4.6 | Fluxo de direitos do titular autenticado, com prazo? | Parcial | Padrão reaproveitável (`encerrarFamilia`/`excluirFamilia`/`sweepRetencaoFamilias`, `packages/core/src/familias.ts`) — plano: replicar equivalente para clínicas na Fase 2 |
| 4.7 | Rito de notificação de incidente? | Não | Gap geral do repo, não específico de clínicas |
| 4.8 | Exclusão alcança RAG/embeddings/memória? | Parcial | Padrão de famílias já cobre isso (`ADR-PRIV-001` §3.6: cascata em `chunks`/`entities`/`relations`/etc.) — replicar na Fase 2 |

## Bloco 5 — Segurança operacional

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 5.1 | Segredos em cofre, com rotação testada? | Parcial | `TempVault` existe; rotação por tipo específica de credencial de clínica não testada |
| 5.2 | Algoritmos não aprovados proibidos? | Não avaliado | — |
| 5.3 | MFA obrigatório? | N/A por ora | Sem fluxo de auth de usuário final de clínica ainda |
| 5.4 | SLA de patch ≥ 95%? | Não medido | — |
| 5.5 | Revisão de acesso periódica? | Não | — |
| 5.6 | Monitoramento de integridade/acesso privilegiado? | Parcial | Prometheus/Sentry genéricos do repo (`aos_*`), nada específico de clínicas |

## Bloco 6 — Rastreabilidade e evidências

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 6.1 | Evidências mínimas acessíveis para auditoria? | Sim | Este questionário + `ADR-PRIV-003`, versionados em `docs/` |
| 6.2 | Rastreabilidade norma ↔ ISO/LGPD/42001 por módulo? | Parcial | Feito no ADR; não propagado a todos os artefatos ainda |
| 6.3 | Referências externas fixadas por versão? | Sim | Artigos LGPD citados no `ADR-PRIV-003` |

## Bloco 7 — IA: Governança de modelos

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 7.1 | Inventário de modelos versionado? | Parcial | `docs/AI-INVENTORY.md` existe genericamente; entrada específica de clínicas a adicionar (paper trail, item 9 do plano) |
| 7.2 | Threat model documentado? | Não | — |
| 7.3 | Kill switch / circuit breaker testado? | Parcial | `maxTurns`/`maxIterations`/`dailyLimitTokens` existem (`packages/core/src/config.ts`, `soul-spec.ts`); "desligar já" dedicado não existe |
| 7.4 | Avaliação de viés/equidade? | Não | — |
| 7.5 | Plano de resposta a incidente de modelo? | Não | — |
| 7.6 | Contrato provedor proíbe treinamento com dados do cliente? | Não verificado | Herdado da config Zen/Ollama geral, não auditado para este domínio |

## Bloco 8 — IA: Agent Harness

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 8.1 | Agentes com identidade única/rastreável? | Sim | `soul_id` |
| 8.2 | Ações categorizadas (leitura/escrita/irreversível)? | Sim | Catálogo L1/L2/L3 (`packages/core/src/policy.ts`) |
| 8.3 | Human-in-the-loop para irreversíveis? | Parcial | Mecanismo existe (`authorizeExecution()`), mas `MCP_ZERO_TRUST` desligado por padrão — P8 |
| 8.4 | Log imutável de decisões/ações? | Sim | Audit trail (`logFullAuditEntry`) já existe no repo |
| 8.5 | Orquestração multi-agente com segregação? | N/A | Clínicas não usa múltiplos agentes por ora |

## Bloco 9 — IA: Evaluation Harness

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 9.1 | Dataset de eval versionado? | Não | `clinic_triage_lead` sem dataset de avaliação ainda |
| 9.2 | Métricas por caso de uso definidas? | Não | — |
| 9.3 | Eval contínua no CI/CD? | Não | — |
| 9.4 | Red teaming / adversarial testing? | Não | Coberto pela exceção formal (`ADR-PRIV-003` §7) |
| 9.5 | Limiares de deploy automatizados? | Não | — |

## Bloco 10 — IA: Contexto, RAG e Memória

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 10.1 | Fonte de dados versionada, lineage/freshness? | Parcial | Infra RAG genérica do repo (chunks/pgvector) existe; sem dado de clínica indexado ainda |
| 10.2 | Chunking/embedding/retrieval validados? | Parcial | Infra genérica validada no repo; não específico de clínicas |
| 10.3 | Controle de acesso a dados no RAG (tenant/role)? | Não | Depende do modelo de multitenancy — P7 |
| 10.4 | Memória de agente com TTL/escopo/retenção? | Parcial | Padrão genérico existe; retenção específica de clínicas depende de P4 |
| 10.5 | Exclusão propaga a embeddings/caches/índices? | Parcial | Padrão de famílias cobre isso; replicar na Fase 2 |

## Bloco 11 — IA: Tool Runtime

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 11.1 | Tools categorizadas por risco? | Sim (planejado) | `clinic_triage_lead`/`clinic_prevent_noshow` entram no catálogo L1/L2/L3 na Fase 2 |
| 11.2 | Sandbox de tools não confiáveis? | N/A | Tools rodam no mesmo processo sandboxado das demais famílias do repo |
| 11.3 | Timeout/retry/circuit breaker por tool? | Não confirmado | Pendência técnica da Fase 2 (envio de WhatsApp/e-mail) |
| 11.4 | Auditoria de invocação de tool? | Sim | Audit trail genérico já cobre chamadas de tool (mesmo padrão usado nos testes do daemon, SPEC-HR3) |

## Bloco 12 — IA: Observabilidade

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 12.1 | Traces distribuídos (LLM/tools/RAG/agentes)? | Parcial | `x-trace-id`/`execution_spans` genéricos existem, não específicos de clínicas |
| 12.2 | Métricas de custo/latência/tokens por modelo? | Sim | `aos_tokens_total`/`aos_chat_latency_seconds` genéricos já existem |
| 12.3 | Alertas de drift configurados? | Não | — |
| 12.4 | Dashboard de qualidade de resposta? | Não | — |

## Bloco 13 — IA: Protocolos MCP/A2A

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 13.1 | Versão de protocolo fixada (não "latest")? | Sim | MCP stdio JSON-RPC 2.0, mesmo runtime das demais famílias |
| 13.2 | Handshake/auth/schemas/erro/cancelamento testados? | Não confirmado | Cobrir nos testes da Fase 2 (`clinic-tools.test.ts`) |
| 13.3 | Streaming/progress notifications validados? | N/A | Tools de clínicas não são streaming |
| 13.4 | Interoperabilidade A2A verificada? | N/A | Repo não usa A2A |

## Bloco 14 — IA: Riscos Avançados (exclusivo AI-4)

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 14.1 | Explicabilidade (LGPD art. 20)? | Não | Coberto pela exceção formal — `ADR-PRIV-003` §7 |
| 14.2 | Contestação + revisão humana? | Não | Idem |
| 14.3 | Robustez adversarial (prompt injection/jailbreak)? | Não | Idem |
| 14.4 | AIP com stakeholder externo? | Não | Idem |
| 14.5 | Seguro/reserva financeira para dano irreversível? | Não | Idem |

## Conclusão

| Campo | Valor |
|---|---|
| Gates reprovados (Bloco G) — com item de roadmap | G3, G4, G5 — ver `ADR-PRIV-003` §5 (P1, P4, P5, P6, P8) |
| ADRs a criar a partir dos blocos | `ADR-PRIV-003` (este) — cobre G3/G4/G5 e a exceção do Bloco 14; nenhum ADR adicional identificado nesta rodada |
| Artefatos a criar / lacunas | Ver `mapa-artefatos-lacunas.md` (mesma pasta) |
| Exceções com owner, validade e condição de encerramento | 1 — Bloco 14 completo, ver `ADR-PRIV-003` §7 |
| Declaração de conformidade emitida | Ver `declaracao-conformidade.md` — estado "Não conforme" (Bloco G BLOCKED) |
