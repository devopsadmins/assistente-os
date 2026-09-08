# Mapa de Artefatos e Lacunas — Vertical Clínicas (`clinica_template`)

**Instrumento oficial de adoção da v4.0 — saída do `questionario-adocao-v4.md`.**
Preenchido em 2026-09-07. ADR: [`ADR-PRIV-003`](../../adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md).

## 1. ADRs a criar

| Código | Decisão | Bloco de origem | Perfil | Prazo | Owner |
|---|---|---|---|---|---|
| `ADR-PRIV-003` | Adoção AI-4 de clínicas dentro do terrasIA (não produto separado) | Bloco G, Bloco 14 | AI-4 | Criado 2026-09-07, status Proposta | agente terrasIA |

Nenhum ADR adicional identificado nesta rodada — todas as decisões pendentes (base legal,
retenção, DPO, provedor de mensageria, multitenancy) cabem como atualização do próprio
`ADR-PRIV-003` quando resolvidas (não editar um ADR aceito depois de aceito — se `ADR-PRIV-003`
já estiver Aceita quando essas decisões chegarem, abrir um ADR substituto).

## 2. Artefatos a produzir (com evidência)

| Artefato | Origem (módulo) | Evidência | Prazo | Owner |
|---|---|---|---|---|
| Matriz RACI do produto clínicas | org-governance | — | Antes do Bloco G ser reavaliado | Usuário |
| Registro de aceitação de risco (ata) para a exceção do Bloco 14 | org-governance | Exceção já rascunhada em `ADR-PRIV-003` §7; falta ata formal | Junto da aceitação do ADR | Owner do repositório |
| Decisão de provedor de mensageria (WhatsApp Business API vs. Evolution vs. outro) | vendor-cloud | — (P6) | Antes de reavaliar Bloco G | Usuário |
| Due diligence do provedor de mensageria escolhido | vendor-cloud | — | Após decisão de provedor | Usuário |
| Classificação da informação (comum / sensível / biométrico) por campo de dado de clínica | privacy-lgpd-product | Parcial — já sabido que é dado de saúde; taxonomia completa depende de P5 | Antes de reavaliar Bloco G | Usuário |
| Retention schedule (`CLINICAS_RETENCAO_DIAS` ou equivalente) | privacy-lgpd-product | — (P4) | Antes do go-live com dado real | Responsável clínico |
| AIP/RIPD e ROPA da vertical clínicas | privacy-lgpd-product | — | Antes do go-live com dado real | Usuário + DPO |
| Migration de privacidade equivalente a `0008_familias_privacidade` (`base_legal`, `finalidade`, `encerrado_em`, `retencao_ate`) | privacy-lgpd-product | Molde: `packages/core/src/migrations.ts` (`0008_familias_privacidade`) | Fase 2, após base legal decidida | Owner técnico |
| Rotina de eliminação em cascata (RAG/embeddings/eventos/checkpoints) equivalente a `familias.ts` | privacy-lgpd-product | Molde: `packages/core/src/familias.ts` (`encerrarFamilia`/`excluirFamilia`/`sweepRetencaoFamilias`) | Fase 2 | Owner técnico |
| Fluxo de consentimento (`consent_evidence_ref` equivalente) | privacy-lgpd-product | Molde: migration `0013_familias_consent_evidence` | Fase 2, após base legal decidida | Owner técnico |
| DPO nomeado + substituto + canal operacional | org-governance | — (P3) | Antes de reavaliar Bloco G | Usuário |
| Entrada L3 de `clinic_prevent_noshow` (+ nível de `clinic_triage_lead`) no catálogo `policy.ts` | security-operations | Molde: entradas `L3` existentes (`browser_*`, `sales_*`, `guardian_*`) | Fase 2 | Owner técnico |
| Confirmação de `MCP_ZERO_TRUST=on` no ambiente real | security-operations | Gap identificado em `packages/tools/src/index.ts:250` (P8) | Antes de liberar `clinic_prevent_noshow` fora de teste | Owner técnico |
| Testes `packages/tools/src/test/clinic-tools.test.ts` (score, não-vazamento de dado sensível, gate L3) | ai-agent-harness | — | Fase 2 | Owner técnico |
| Dataset de avaliação versionado + thresholds para `clinic_triage_lead` | ai-evaluation-harness | — | Fase 2 (ou exceção formal adicional se adiado) | Owner técnico |

## 3. Políticas e documentos a adequar

| Documento | O que falta | Módulo de origem | Prazo | Owner |
|---|---|---|---|---|
| `docs/AI-INVENTORY.md` | Nova linha para `clinic_triage_lead`/`clinic_prevent_noshow` (perfil AI-4, apontando pro `ADR-PRIV-003`) — padrão da linha #6 (famílias) | ai-governance | Imediato (parte da Fase 1) | agente terrasIA |
| `docs/ROADMAP.md` | Nova entrada de backlog ativo para clínicas + nota deixando `ADR-PRIV-002`/`ADR-AI-005` explicitamente aposentados | org-governance | Imediato (parte da Fase 1) | agente terrasIA |
| `CHANGELOG.md` | Entrada em "Adicionado" para a adoção formal | org-governance | Imediato (parte da Fase 1) | agente terrasIA |
| `SLC/clinicas/system_prompt.xml` | Reconciliar `blocking_decision` com a decisão tomada e o `ADR-PRIV-003` | — (rascunho de produto) | Imediato (parte da Fase 1) | agente terrasIA |

## 4. Lacunas identificadas

| Lacuna | Evidência da lacuna | Ação | Prazo | Owner |
|---|---|---|---|---|
| `MCP_ZERO_TRUST` desligado por padrão | `packages/tools/src/index.ts:250` | Confirmar/ligar no ambiente que servir `clinica_template` | Antes de liberar `clinic_prevent_noshow` fora de teste | Owner técnico |
| Sem kill-switch/circuit-breaker dedicado a modelo | Só existem `maxTurns`/`maxIterations`/`dailyLimitTokens` (limites de passos/custo, não um "desligar já") | Avaliar se um kill-switch genérico vale a pena para o repo todo, ou só documentar como limitação conhecida | A decidir | Owner técnico |
| Sem rito de notificação de incidente (LGPD) para nenhum domínio do repo, não só clínicas | Verificado nos Blocos 4.7/9 do questionário | Gap de repo, não bloqueia especificamente clínicas | A decidir (fora do escopo deste ADR) | Owner técnico + DPO |
| Bloco 14 (Riscos Avançados AI-4) sem nenhuma evidência | Questionário, Bloco 14 | Coberto por exceção formal — `ADR-PRIV-003` §7 | Até o onboarding da primeira clínica real | Owner técnico + owner de risco |

## 5. Exceções registradas

| Requisito afetado | Justificativa | Risco residual | Controle compensatório | Validade | Condição de encerramento |
|---|---|---|---|---|---|
| Bloco 14 completo (explicabilidade, contestação, red team, AIP externo, seguro para dano irreversível) | Vertical em fase de template/adoção, sem tenant real nem dado de paciente fluindo — investimento pesado desproporcional nesta fase | Baixo agora; Alto no onboarding real sem esses controles | `clinica_template` restrito a teste/dry-run; Bloco G (G3/G4/G5) precisa estar aprovado antes de qualquer dado real | Até o onboarding da primeira clínica com dado real de paciente | Bloco 14 respondido com evidência real antes do primeiro tenant real ser ativado |

## 6. Rastreabilidade norma externa

| Módulo | ISO/IEC 27001:2022 | LGPD | ISO/IEC 42001:2023 | WCAG 2.2 AA |
|---|---|---|---|---|
| org-governance | 5.1–5.3, A.5.1, A.5.2, A.5.35, A.5.36, 9.2, 9.3 | art. 37, 41, 50 | cláusulas de responsabilidade/políticas | — |
| vendor-cloud | A.5.19–5.23, A.8.21 | art. 33, 34, 39, 46 | ciclo de vida de fornecedores de IA | — |
| privacy-lgpd-product | A.5.34, A.8.10–8.12 | art. 5º, 6º, 7º, 8º, 11, 14, 18, 20, 33, 37, 41, 46, 48 | dados e transparência de IA | fluxos de direitos acessíveis |
| security-operations | A.5.9, A.5.15–5.18, A.5.24, A.5.25, A.5.28, A.6.3, A.8.8, A.8.10, A.8.24 | art. 46, 48 | segurança em sistemas de IA | — |

## 7. Declaração de conformidade

Emitida em: 2026-09-07 — estado: [ ] Conforme [ ] Conforme com pendências datadas [x] Não
conforme — `standards_gate_blockg` retornou veredito **BLOCKED** (G3/G4/G5 reprovados, não
apenas lacunas em blocos técnicos); produção fica bloqueada até o Bloco G ser reaprovado. Ver
[`declaracao-conformidade.md`](declaracao-conformidade.md) (mesma pasta).
