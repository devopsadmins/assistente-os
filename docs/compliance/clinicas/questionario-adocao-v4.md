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
| G3 | Dado pessoal sem base legal/finalidade/retenção? | **Sim** (aprovado) | Base legal (LGPD art. 11 II "f" — P1), finalidade e retenção provisória de 1825 dias (P4) decididas — `ADR-PRIV-003` §2 |
| G4 | Transferência internacional sem avaliação? | **Sim** (aprovado) | Evolution API self-hosted (P6) — mesma infra já usada no canal WhatsApp do repo, sem fornecedor novo |
| G5 | Ação irreversível sem aprovação humana? | **Sim** (aprovado) | `clinic_prevent_noshow` hardcoded em `dryRun: true`; `MCP_ZERO_TRUST` fica desligado por decisão (P8), condição de reabertura registrada |

**Veredito** (`standards_gate_blockg`, reavaliado após P1–P8): **approved** — todos os 5 gates
aprovados com evidência, `ADR-PRIV-003` §1.

## Bloco 1 — Classificação do produto

| # | Pergunta | Resposta |
|---|---|---|
| 1.1 | Perfil declarado | **AI-4** (`standards_classify_profile`: dado sensível em runtime força reclassificação) |
| 1.2 | Multitenant? Isolamento/testes cross-tenant | **Não, nesta fase** (P7) — protótipo sem clínica real, `clinica_template` é soul única. Isolamento cross-tenant fica pra decidir no onboarding da 1ª clínica real |
| 1.3 | Dado sensível/biométrico em runtime? | **Sim** (saúde) / **Não** (biométrico — P5: sem fotos/reconhecimento facial nesta fase) |
| 1.4 | Decisão automatizada com efeito jurídico/impacto relevante? | Parcial/a confirmar — `clinic_triage_lead` gera score que influencia priorização comercial; se afetar diretamente o atendimento do paciente, também dispara Bloco 14.1/14.2 |
| 1.5 | Dependência de IA em runtime? | **Sim** — mesmo router local-first (Ollama/Zen) do resto do repo |

## Bloco 2 — Governança e papéis

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 2.1 | Matriz RACI cobre o ciclo de vida completo? | Não | Só owners provisórios no `ADR-PRIV-003` (Identificação); RACI completo pendente |
| 2.2 | Segregação de funções controlada tecnicamente? | Parcial | Catálogo L1/L2/L3 + `authorizeExecution()` existe; efetividade depende de `MCP_ZERO_TRUST=on` (P8) |
| 2.3 | Ciclo de vida de ADR em uso? | Sim | Este processo — `docs/adr/ADR-PRIV-003-*.md`, versionado, com gatilhos de reavaliação (§8) |
| 2.4 | DPO nomeado com substituto e canal operacional? | Parcial | DPO provisório nomeado (P3 — Everton Lima); substituto e canal operacional formal ainda pendentes |
| 2.5 | Aceitações de risco residual em ata, com revisão? | Parcial | Exceção do Bloco 14 registrada no ADR §7 (validade + condição de encerramento); sem ata formal de órgão de governança ainda |

## Bloco 3 — Fornecedores, terceiros e nuvem

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 3.1 | Due diligence de fornecedores registrada? | N/A | Evolution API self-hosted (P6) — mesmo fornecedor/infra já em uso no repo, sem due diligence nova a fazer |
| 3.2 | Contratos cobrem LGPD/auditoria/incidente? | N/A | Idem — sem fornecedor novo |
| 3.3 | Provedor de IA sem treinamento/retenção de dados do cliente? | Não verificado | Herdaria a config Zen/Ollama já usada no repo geral — não auditado especificamente para clínicas |
| 3.4 | Modelo de responsabilidade compartilhada registrado? | Não | Pendente, não bloqueante (sem fornecedor novo) |
| 3.5 | Plano de saída com exportabilidade? | Não | Pendente, não bloqueante (sem fornecedor novo) |
| 3.6 | Região de processamento/DR avaliada (transferência)? | Parcial | Evolution self-hosted na própria infra do repo (P6); tráfego de protocolo WhatsApp ainda toca a rede da Meta — mesma exposição já aceita pelo canal existente, não uma transferência nova |

## Bloco 4 — Privacidade no produto (LGPD)

| # | Pergunta | Sim/Par/Não | Evidência |
|---|---|---|---|
| 4.1 | Classificação da informação por tipo de dado? | Sim | Dado comum (nome/telefone/agenda) vs. sensível de saúde (procedimento/histórico) — sem biométrico (P5). `ADR-PRIV-003` §2 |
| 4.2 | Retention schedule versionado, com descarte? | Parcial | 1825 dias decidido (P4), **provisório** até confirmar com conselho profissional — mecanismo de descarte (migration/sweep) ainda não implementado em código (Fase 2 futura, molde: `familias.ts`) |
| 4.3 | AIP/DPIA como gate de engenharia? | Não | Não implementado — coberto pela exceção formal do Bloco 14 nesta fase de protótipo |
| 4.4 | ROPA atualizado e sincronizado com código? | Parcial | Insumos decididos (base legal, finalidade, retenção — `ADR-PRIV-003` §2); documento ROPA formal ainda não escrito |
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
| 8.3 | Human-in-the-loop para irreversíveis? | Parcial | Mecanismo existe e testado (`authorizeExecution()`, `clinic-tools.test.ts` — bloqueia `clinic_prevent_noshow` com `autonomy: suggest` sob `MCP_ZERO_TRUST=on`), mas a env var fica desligada por padrão em produção — P8 |
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
| 11.1 | Tools categorizadas por risco? | **Sim** | `clinic_triage_lead` = `L2`, `clinic_prevent_noshow` = `L3` (`packages/core/src/policy.ts`) |
| 11.2 | Sandbox de tools não confiáveis? | N/A | Tools rodam no mesmo processo sandboxado das demais famílias do repo |
| 11.3 | Timeout/retry/circuit breaker por tool? | N/A por ora | `clinic_prevent_noshow` roda em dry-run (não faz chamada de rede real); vira pendência real só quando o provedor de mensageria (P6) for integrado de fato |
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
| 13.2 | Handshake/auth/schemas/erro/cancelamento testados? | **Sim** | `packages/tools/src/test/clinic-tools.test.ts` (8 testes: score, dry-run, validação de input, allowlist, gate L3) |
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
| Gates reprovados (Bloco G) — com item de roadmap | **Nenhum** — G1–G5 todos aprovados após P1–P8 (`ADR-PRIV-003` §1/§5) |
| ADRs a criar a partir dos blocos | `ADR-PRIV-003` (este) — **Aceita** 2026-09-08; cobre G3/G4/G5 e a exceção do Bloco 14 |
| Artefatos a criar / lacunas | Ver `mapa-artefatos-lacunas.md` (mesma pasta) |
| Exceções com owner, validade e condição de encerramento | 1 — Bloco 14 completo, ver `ADR-PRIV-003` §7 |
| Declaração de conformidade emitida | Ver `declaracao-conformidade.md` — estado "Conforme com pendências datadas" (Bloco G approved) |
