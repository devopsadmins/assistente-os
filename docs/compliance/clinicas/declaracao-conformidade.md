# Declaração de Conformidade — v4.0 — Vertical Clínicas (`clinica_template`)

**Instrumento oficial de adoção da v4.0.** Emitida em 2026-09-07, reemitida em 2026-09-08 após P1–P8 resolvidos.

## Identificação

| Campo | Valor |
|---|---|
| Produto/repositório | Vertical técnica "clínicas" (`clinica_template`) dentro de `terrasIA` (`assistente-os`) — fase de **protótipo**, sem clínica real onboardada |
| Versão avaliada | Fase 1 (conformidade) + Fase 2 em modo dry-run (soul `clinica_template` + tools `clinic_triage_lead`/`clinic_prevent_noshow` escaladas, sem dado real de paciente) |
| Data da avaliação | 2026-09-07 (Fase 1/2) — reavaliação do Bloco G em 2026-09-08 |
| Owner técnico | Everton Lima (via agente terrasIA) |
| Owner de negócio | Everton Lima — produto SLC Clínicas (provisório, ver `SLC/PERFIL.md`) |
| Owner de risco / DPO | Everton Lima (provisório) |
| Perfil de conformidade | **AI-4** |
| ADR de adoção | [`ADR-PRIV-003`](../../adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md) — status **Aceita (2026-09-08)** |

## Gates de bloqueio (Bloco G)

| G# | Resultado | Evidência |
|---|---|---|
| G1 | Aprovado | Sem conflito legal conhecido |
| G2 | Aprovado | `TempVault`/`purgeCredentials` |
| G3 | **Aprovado** | Base legal (LGPD art. 11 II "f", supervisão de profissional de saúde — P1), finalidade e retenção (1825 dias, provisória — P4) decididas — `ADR-PRIV-003` §2 |
| G4 | **Aprovado** | Evolution API self-hosted (P6) — mesma infra já usada no canal WhatsApp do repo, sem fornecedor novo |
| G5 | **Aprovado** | `clinic_prevent_noshow` hardcoded em dry-run (nunca despacha real); `MCP_ZERO_TRUST` permanece desligado por decisão (P8) — condição de reabertura registrada antes de sair do dry-run |

**Veredito `standards_gate_blockg`: approved.** Todos os 5 gates aprovados com evidência —
reavaliação de 2026-09-08 após as decisões P1–P8 (`ADR-PRIV-003` §5).

## Gates de produção (v4.0 §7)

- [x] ADR inicial, owners e classificação de risco.
- [x] Perfil declarado; Bloco G **sem** gate reprovado pendente.
- [ ] Autenticação, autorização e isolamento testados — isolamento cross-tenant fica para o
      onboarding da 1ª clínica real (P7).
- [ ] Contratos públicos versionados — N/A nesta fase (sem fornecedor novo, sem contrato de
      cliente real ainda).
- [x] Testes automatizados proporcionais ao risco — `packages/tools/src/test/clinic-tools.test.ts` (8/8, inclui o gate L3).
- [ ] SAST, secret scanning, análise de dependências e SBOM — herdado do pipeline geral do
      repo, não auditado especificamente para este domínio.
- [x] Matriz requisito-teste e evidências acessíveis (Princípio 10) — este conjunto de documentos.
- [ ] Rollback, backup/restore testado e runbooks — N/A (nenhuma migração/dado persistido
      ainda; nenhum runbook específico de clínicas).
- [ ] SLOs, logs estruturados, métricas e traces (específicos de clínicas) — herdado do
      genérico do repo (Prometheus/audit trail), não específico.
- [ ] Inventário e artefatos de privacidade (ROPA, retenção, AIP/RIPD) — retenção decidida
      (provisória); ROPA/AIP/RIPD formais ainda não escritos.
- [ ] Plano de incidentes e plantão — gap geral do repo, não específico de clínicas.
- [ ] (AI-1..AI-4) inventário, manifest, evals, kill switch, red team/threat model — coberto
      parcialmente (inventário sim, resto exceção formal Bloco 14).
- [x] (dados pessoais) DPO nomeado (provisório), classificação, retention, direitos —
      notificação de incidente e transferência formal ainda pendentes de documento dedicado.

## Questionário de Adoção — Blocos Respondidos

| Bloco | Status | Evidências | ADR Gerado |
|---|---|---|---|
| Bloco G | Respondido — **approved** | `questionario-adocao-v4.md` | `ADR-PRIV-003` |
| Bloco 1 — Classificação | Respondido | AI-4 confirmado via `standards_classify_profile`; protótipo sem multitenant real | `ADR-PRIV-003` |
| Bloco 2 — Governança | Respondido — maioria Não/Parcial (owners provisórios, RACI completa pendente) | `questionario-adocao-v4.md` | — |
| Bloco 3 — Fornecedores | Respondido — Evolution self-hosted, sem fornecedor novo (menos itens pendentes) | `questionario-adocao-v4.md` | — |
| Bloco 4 — Privacidade LGPD | Respondido — base legal/finalidade/retenção decididas; ROPA/AIP formais pendentes | `questionario-adocao-v4.md` | — |
| Bloco 5 — Segurança Ops | Respondido — misto | `questionario-adocao-v4.md` | — |
| Bloco 6 — Rastreabilidade | Respondido — maioria Sim/Parcial | `questionario-adocao-v4.md` | — |
| Bloco 7 — IA: Governança Modelos | Respondido — maioria Não/Parcial | `questionario-adocao-v4.md` | — |
| Bloco 8 — IA: Agent Harness | Respondido — maioria Sim/Parcial | Catálogo L1/L2/L3, audit trail, teste do gate L3 | — |
| Bloco 9 — IA: Evaluation Harness | Respondido — Não (sem eval ainda) | `questionario-adocao-v4.md` | — |
| Bloco 10 — IA: Contexto/RAG/Memória | Respondido — maioria Parcial | Infra RAG genérica do repo | — |
| Bloco 11 — IA: Tool Runtime | Respondido — Sim (tools categorizadas + testadas) | `packages/core/src/policy.ts`, `clinic-tools.test.ts` | — |
| Bloco 12 — IA: Observabilidade | Respondido — misto | Métricas Prometheus genéricas | — |
| Bloco 13 — IA: Protocolos MCP/A2A | Respondido — maioria Sim | MCP stdio JSON-RPC 2.0, testado | — |
| Bloco 14 — IA: Riscos Avançados | Respondido — Não, todos | Coberto por exceção formal | `ADR-PRIV-003` §7 |

## Mapa de Artefatos e Lacunas — Resumo

| Métrica | Valor |
|---|---|
| ADRs totais | 1 (`ADR-PRIV-003`) |
| ADRs Aceitos | **1** — `ADR-PRIV-003`, Aceita 2026-09-07 |
| Artefatos catalogados | 16 (ver `mapa-artefatos-lacunas.md` §2) |
| Lacunas totais | 4 identificadas (ver `mapa-artefatos-lacunas.md` §4) — 0 Alta (gates G3/G4/G5 resolvidos), 1 Média (Bloco 14, coberta por exceção), demais operacionais (kill-switch dedicado, rito de incidente) |
| Evidências anexadas (Princípio 10) | Evidências reais para G1–G5, catálogo L1/L2/L3, testes automatizados, base legal/retenção/provedor decididos |

## Exceções Formais (v4.0 §8)

| Requisito Afetado | Justificativa | Risco Residual | Controle Compensatório | Validade | Condição Encerramento | Owner | Aprovadores |
|---|---|---|---|---|---|---|---|
| Bloco 14 completo | Vertical em fase de protótipo, sem tenant real | Baixo agora / Alto no onboarding real | `clinic_prevent_noshow` hardcoded em dry-run; Bloco G aprovado não libera despacho real por si só | Até onboarding da 1ª clínica real | Bloco 14 respondido com evidência antes do 1º tenant real | Everton Lima | Everton Lima (owner do repositório) |

> Exceção permanente sem revisão não é permitida — esta tem validade e condição de
> encerramento explícitas.

## Conclusão

- **Estado:** [ ] Conforme [x] **Conforme com pendências datadas** [ ] Não conforme
- **Motivo:** Bloco G **approved** (`standards_gate_blockg`, 2ª avaliação) — o pré-requisito
  da v4.0 §7 ("Bloco G aprovado, perfil classificado, questionário respondido com evidências,
  mapa consolidado, ADR aceito") está satisfeito. Não é "Conforme" puro porque a exceção do
  Bloco 14 segue aberta (com validade) e vários itens dos Blocos 2/3/4/7/9/12 continuam
  Parcial/Não — nenhum deles é gate de bloqueio, mas também não estão fechados.
- **Riscos residuais:** owners provisórios concentrados numa só pessoa (P2/P3, até 1ª clínica
  real); retenção de 1825 dias ainda não confirmada com conselho profissional (P4); isolamento
  cross-tenant não implementado (P7, adiado pra quando houver cliente real); Bloco 14 completo
  em aberto (exceção formal).
- **Exceções aprovadas (owner + validade):** 1 — Bloco 14, até onboarding da 1ª clínica real.
- **Aprovadores:** owner do repositório (Everton Lima) — `ADR-PRIV-003` aceito 2026-09-08.
- **Próxima revisão:** no onboarding da primeira clínica real (reabre P2/P3/P4/P7) ou antes de
  tirar `clinic_prevent_noshow` do modo dry-run (reabre P8) — o que vier primeiro.

## Assinaturas

| Papel | Nome | Data | Assinatura/registro |
|---|---|---|---|
| Owner técnico | Everton Lima (via agente terrasIA) | 2026-09-08 | Decisões P1–P8 |
| Owner de negócio | Everton Lima | 2026-09-08 | idem |
| Owner de risco / DPO | Everton Lima (provisório) | 2026-09-08 | idem |
| Aprovador Governança | Everton Lima (owner do repositório) | 2026-09-08 | Aceite do `ADR-PRIV-003` |

---

**Como usar este documento**: o Bloco G está aprovado e o `ADR-PRIV-003` foi aceito — isso
libera a vertical clínicas da trava genérica de "Não conforme", mas **não** libera
`clinic_prevent_noshow` do modo dry-run automaticamente. Essa tool continua hardcoded para
nunca despachar mensagem real; sair do dry-run exige uma mudança de código explícita, gatilhada
só quando `MCP_ZERO_TRUST=on` estiver confirmado no ambiente (P8) — decisão separada, dado o
alcance dessa env var sobre todo o sistema. Produção com dado real de **paciente de verdade**
(não protótipo) também exige reabrir P2/P3/P4/P7 no onboarding da primeira clínica real.
