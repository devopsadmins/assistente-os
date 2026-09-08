# Declaração de Conformidade — v4.0 — Vertical Clínicas (`clinica_template`)

**Instrumento oficial de adoção da v4.0.** Emitida em 2026-09-07.

## Identificação

| Campo | Valor |
|---|---|
| Produto/repositório | Vertical técnica "clínicas" (`clinica_template`) dentro de `terrasIA` (`assistente-os`) |
| Versão avaliada | Fase 1 de adoção — nenhum código de produto ainda (soul/tools não escaladas) |
| Data da avaliação | 2026-09-07 |
| Owner técnico | agente terrasIA |
| Owner de negócio | produto SLC Clínicas — owner a confirmar (ver `SLC/PERFIL.md`) |
| Owner de risco | security-reviewer / DPO — a nomear |
| Perfil de conformidade | **AI-4** |
| ADR de adoção | [`ADR-PRIV-003`](../../adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md) — status Proposta |

## Gates de bloqueio (Bloco G)

| G# | Resultado | Item de roadmap / exceção |
|---|---|---|
| G1 | Aprovado | — |
| G2 | Aprovado | `TempVault`/`purgeCredentials` |
| G3 | **Reprovado** | P1/P4 do `ADR-PRIV-003` §5 |
| G4 | **Reprovado** | P6 do `ADR-PRIV-003` §5 |
| G5 | **Reprovado** | P8 do `ADR-PRIV-003` §5 |

**Veredito `standards_gate_blockg`: BLOCKED.** Produção bloqueada até G3/G4/G5 serem
reavaliados e aprovados com evidência real.

## Gates de produção (v4.0 §7)

- [x] ADR inicial, owners e classificação de risco.
- [x] Perfil declarado; Bloco G **com** gate reprovado pendente — não atende ainda.
- [ ] Autenticação, autorização e isolamento testados.
- [ ] Contratos públicos versionados.
- [ ] Testes automatizados proporcionais ao risco.
- [ ] SAST, secret scanning, análise de dependências e SBOM.
- [x] Matriz requisito-teste e evidências acessíveis (Princípio 10) — este conjunto de documentos.
- [ ] Rollback, backup/restore testado e runbooks.
- [ ] SLOs, logs estruturados, métricas e traces (específicos de clínicas).
- [ ] Inventário e artefatos de privacidade (ROPA, retenção, AIP/RIPD).
- [ ] Plano de incidentes e plantão.
- [ ] (AI-1..AI-4) inventário, manifest, evals, kill switch, red team/threat model.
- [ ] (dados pessoais) DPO nomeado, classificação, retention, direitos, notificação, transferência.

## Questionário de Adoção — Blocos Respondidos

| Bloco | Status | Evidências | ADR Gerado |
|---|---|---|---|
| Bloco G | Respondido — BLOCKED | `questionario-adocao-v4.md` | `ADR-PRIV-003` |
| Bloco 1 — Classificação | Respondido | AI-4 confirmado via `standards_classify_profile` | `ADR-PRIV-003` |
| Bloco 2 — Governança | Respondido — maioria Não/Parcial | `questionario-adocao-v4.md` | — |
| Bloco 3 — Fornecedores | Respondido — maioria Não (depende de P6) | `questionario-adocao-v4.md` | — |
| Bloco 4 — Privacidade LGPD | Respondido — maioria Não/Parcial | `questionario-adocao-v4.md` | — |
| Bloco 5 — Segurança Ops | Respondido — misto | `questionario-adocao-v4.md` | — |
| Bloco 6 — Rastreabilidade | Respondido — maioria Sim/Parcial | `questionario-adocao-v4.md` | — |
| Bloco 7 — IA: Governança Modelos | Respondido — maioria Não/Parcial | `questionario-adocao-v4.md` | — |
| Bloco 8 — IA: Agent Harness | Respondido — maioria Sim/Parcial | Catálogo L1/L2/L3, audit trail | — |
| Bloco 9 — IA: Evaluation Harness | Respondido — Não (sem eval ainda) | `questionario-adocao-v4.md` | — |
| Bloco 10 — IA: Contexto/RAG/Memória | Respondido — maioria Parcial | Infra RAG genérica do repo | — |
| Bloco 11 — IA: Tool Runtime | Respondido — misto | `questionario-adocao-v4.md` | — |
| Bloco 12 — IA: Observabilidade | Respondido — misto | Métricas Prometheus genéricas | — |
| Bloco 13 — IA: Protocolos MCP/A2A | Respondido — maioria Sim/N-A | MCP stdio JSON-RPC 2.0 | — |
| Bloco 14 — IA: Riscos Avançados | Respondido — Não, todos | Coberto por exceção formal | `ADR-PRIV-003` §7 |

## Mapa de Artefatos e Lacunas — Resumo

| Métrica | Valor |
|---|---|
| ADRs totais | 1 (`ADR-PRIV-003`) |
| ADRs Aceitos | 0 — status Proposta |
| Artefatos catalogados | 14 (ver `mapa-artefatos-lacunas.md` §2) |
| Lacunas totais | 4 identificadas (ver `mapa-artefatos-lacunas.md` §4) — 3 Alta (gates G3/G4/G5), 1 Média (Bloco 14, coberta por exceção) |
| Evidências anexadas (Princípio 10) | Parcial — evidências reais para G1/G2, `TempVault`, catálogo L1/L2/L3, audit trail; ausentes para os itens pendentes P1–P8 |

## Exceções Formais (v4.0 §8)

| Requisito Afetado | Justificativa | Risco Residual | Controle Compensatório | Validade | Condição Encerramento | Owner | Aprovadores |
|---|---|---|---|---|---|---|---|
| Bloco 14 completo | Vertical em fase de template/adoção, sem tenant real | Baixo agora / Alto no onboarding real | `clinica_template` restrito a teste/dry-run; Bloco G precisa aprovado antes de dado real | Até onboarding da 1ª clínica real | Bloco 14 respondido com evidência antes do 1º tenant real | Owner técnico + owner de risco | Owner do repositório |

> Exceção permanente sem revisão não é permitida — esta tem validade e condição de
> encerramento explícitas.

## Conclusão

- **Estado:** [ ] Conforme [ ] Conforme com pendências datadas [x] **Não conforme**
- **Motivo:** Bloco G BLOCKED (G3, G4, G5 reprovados) — pré-requisito obrigatório da v4.0 §7
  ("Bloco G aprovado, perfil classificado, questionário respondido com evidências, mapa
  consolidado, ADR aceito") não está satisfeito. Perfil classificado (✅), questionário
  respondido (✅) e mapa consolidado (✅) estão prontos; Bloco G aprovado e ADR aceito faltam.
- **Riscos residuais:** dado de saúde de paciente sem base legal/finalidade/retenção
  formalizadas (G3); provedor de mensageria e eventual transferência internacional não
  avaliados (G4); ação irreversível (`clinic_prevent_noshow`) sem aprovação humana efetiva
  enquanto `MCP_ZERO_TRUST` estiver desligado (G5).
- **Exceções aprovadas (owner + validade):** 1 — Bloco 14, até onboarding da 1ª clínica real
  (ver acima). Não cobre G3/G4/G5, que não são excepcionáveis — precisam ser resolvidos.
- **Aprovadores:** owner do repositório (pendente — revisão do `ADR-PRIV-003`).
- **Próxima revisão:** ao responder qualquer pendência P1–P8 do `ADR-PRIV-003` §5 — reavaliar
  `standards_gate_blockg` e reemitir esta declaração.

## Assinaturas

| Papel | Nome | Data | Assinatura/registro |
|---|---|---|---|
| Owner técnico | agente terrasIA | 2026-09-07 | emissão automatizada desta declaração |
| Owner de negócio | | | |
| Owner de risco | | | |
| DPO/Encarregado | | | |
| Aprovador Governança | | | |

---

**Como usar este documento**: nenhuma linha de código de produto (soul `clinica_template`,
tools `clinic_triage_lead`/`clinic_prevent_noshow`) deve ser escrita processando dado real de
paciente enquanto este documento disser "Não conforme". A Fase 2 (scaffolding técnico) do
plano de adoção pode avançar em ambiente de teste/dry-run — sem dado real — mas o gate real
para produção é a reemissão desta declaração como "Conforme" ou "Conforme com pendências
datadas" depois que G3/G4/G5 forem aprovados.
