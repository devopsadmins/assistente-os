# ADR-PRIV-003 — Base legal, finalidade e retenção para dados de clínicas (clinica_template) — adoção AI-4

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**

> Cópia por decisão. Não editar um ADR aceito: nova decisão cria ADR substituto e preserva o histórico.

## Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-PRIV-003` |
| Status | Proposta — Bloco G BLOCKED (G3/G4/G5); campos-chave de base legal/retenção/DPO pendentes (§5), não pode virar Aceita até isso ser resolvido |
| Perfil de conformidade | AI-4 (confirmado via `standards_classify_profile`) |
| Módulos normativos aplicáveis | privacy-lgpd-product, ai-governance, security-operations |
| Blocos do questionário de origem | Bloco G (gates G3, G4, G5), Bloco 14 |
| Relacionados | ADR-PRIV-001 (arquivado, domínio famílias — molde de conteúdo, mesmo perfil AI-4); ADR-PRIV-002/ADR-AI-005 (**não reaproveitados** — reservados/aposentados para o resíduo do domínio famílias, ver `docs/ROADMAP.md` § "Exclusões de escopo registradas"); `SLC/clinicas/system_prompt.xml` (rascunho técnico) |
| Rastreabilidade norma externa | LGPD · ISO/IEC 27001:2022 (A.5.34, A.8.10) · ISO/IEC 42001:2023 |
| Owner técnico | agente terrasIA |
| Owner de negócio | produto SLC Clínicas — owner a confirmar (ver `SLC/PERFIL.md`) |
| Owner de risco | security-reviewer / DPO — a nomear |

## 1. Contexto

A vertical técnica "clínicas" (soul `clinica_template` + MCP tools `clinic_triage_lead`/
`clinic_prevent_noshow`, rascunhada em `SLC/clinicas/system_prompt.xml`) processa dado de
saúde de paciente (procedimento médico, agenda) — categoria sensível pela LGPD.
`standards_classify_profile` confirmou perfil **AI-4** (dado sensível em runtime força
reclassificação, independente de outras características do agente).

O gate Bloco G foi avaliado via `standards_gate_blockg` com **veredito BLOCKED**:

- **G3** (dado pessoal sem base legal/finalidade/retenção definidas) — reprovado.
- **G4** (transferência internacional — provedor de mensageria ainda não escolhido) — reprovado.
- **G5** (ação irreversível — `clinic_prevent_noshow` seria `L3`, mas `MCP_ZERO_TRUST` está
  desligado por padrão em `packages/tools/src/index.ts:250`, tornando `authorizeExecution()`
  no-op na prática) — reprovado.
- G1 e G2 aprovados (sem conflito legal conhecido; credenciais cobertas pelo `TempVault`).

Existe precedente direto no repo: o domínio famílias (também AI-4, também dado de saúde) foi
excluído do terrasIA em 2026-09-05 para virar produto separado (ver `docs/ROADMAP.md` §
"Exclusões de escopo registradas", `ADR-PRIV-001` arquivado). O usuário decidiu explicitamente
**não repetir esse caminho** para clínicas — quer a trilha de adoção formal AI-4 completa
dentro do terrasIA.

## 2. Decisão

Declarar a vertical clínicas (`clinica_template`) sob adoção formal do perfil AI-4 dentro do
terrasIA — não como produto separado. Isso é uma decisão de escopo, já tomada.

A base legal específica do dado sensível de saúde, o responsável pelo tratamento (equivalente
ao "responsável clínico" do `ADR-PRIV-001`), o prazo de retenção, o DPO nomeado e o provedor de
mensageria ficam como pendências **P1–P8 (§5)** — não inventadas por analogia com o domínio
famílias, porque o contexto de atuação é distinto (IA fazendo triagem comercial/logística, não
necessariamente um profissional de saúde no ato do processamento).

Bloco G permanece **BLOCKED** (G3/G4/G5 reprovados) até essas pendências serem resolvidas;
**nenhum dado real de paciente deve fluir** por `clinic_triage_lead`/`clinic_prevent_noshow`
antes disso — a soul nasce como template sem tenant real.

### O que NÃO muda

- Os números `ADR-PRIV-002`/`ADR-AI-005` continuam reservados/aposentados para o resíduo do
  domínio famílias (citados em `docs/ROADMAP.md`, `docs/AI-INVENTORY.md`, `CHANGELOG.md`) —
  este ADR usa um código novo, `ADR-PRIV-003`, para não colidir com esse histórico já publicado.
- A aceitação e o conteúdo do `ADR-PRIV-001` (domínio famílias) não são alterados.

## 3. Alternativas consideradas

| Alternativa | Motivo da rejeição |
|---|---|
| Tratar clínicas como produto separado, mesmo caminho do domínio famílias | Usuário decidiu explicitamente a trilha AI-4 completa dentro do terrasIA, revertendo esse precedente para este caso |
| Reaproveitar os códigos `ADR-PRIV-002`/`ADR-AI-005` | Esses códigos já são citados em `docs/ROADMAP.md`, `docs/AI-INVENTORY.md` e `CHANGELOG.md` como identificadores específicos do resíduo excluído de famílias — reaproveitar para um domínio diferente contradiz o histórico já publicado |
| Aplicar por analogia direta a base legal e retenção do `ADR-PRIV-001` (LGPD art. 11 II "f", 1825 dias) | O contexto de atuação é diferente — clínicas usa IA para triagem comercial/logística, não um profissional de saúde prestando o serviço diretamente; fundamentar a base legal por analogia sem verificação seria um erro de conformidade |

## 4. Consequências e controles

| Consequência | Impacto | Controle compensatório |
|---|---|---|
| Bloco G permanece BLOCKED (G3/G4/G5) até as pendências do §5 serem resolvidas | Alto | `clinica_template` nasce como template sem dado real de paciente; nenhum onboarding de clínica real antes do Bloco G aprovado |
| `MCP_ZERO_TRUST` desligado por padrão torna o gate L3 de `clinic_prevent_noshow` no-op na prática | Alto | Exigir `MCP_ZERO_TRUST=on` confirmado no ambiente real antes de liberar `clinic_prevent_noshow` fora de teste |
| Bloco 14 do questionário (exclusivo AI-4: explicabilidade, contestação, red team adversarial, AIP com stakeholder externo, seguro para dano irreversível) não tem evidência hoje | Médio | Registrado como exceção formal (§7) com validade e condição de encerramento |

## 5. Pendências (roadmap datado — owners)

| Item | Descrição | Owner | Prazo |
|---|---|---|---|
| P1 | Base legal do dado sensível de saúde processado pela IA — qual dispositivo LGPD se aplica, dado que a IA faz triagem/logística e não necessariamente um profissional de saúde no ato (fecha G3) | Usuário + DPO a nomear | Antes de reavaliar o Bloco G |
| P2 | Identificar/nomear o "profissional de saúde responsável" pela clínica (equivalente ao "responsável clínico" do `ADR-PRIV-001`) | Usuário | Antes de reavaliar o Bloco G |
| P3 | DPO nomeado + substituto | Usuário | Antes de reavaliar o Bloco G |
| P4 | Prazo de retenção (`CLINICAS_RETENCAO_DIAS`) — não herdar os 1825 dias de famílias por analogia; depende de regra de conselho profissional/vigilância sanitária do tipo de procedimento | Responsável clínico | Antes do go-live com dado real |
| P5 | Definir se haverá dado biométrico real (fotos antes/depois com reconhecimento facial) — muda as respostas do Bloco 4/G4 sobre biometria, não muda a classificação AI-4 em si | Usuário (decisão de produto) | Antes de reavaliar o Bloco G |
| P6 | Provedor de mensageria para `clinic_prevent_noshow` (WhatsApp Business API oficial vs. Evolution self-hosted vs. outro) — decide G4 e Bloco 3.6 | Usuário (decisão de produto) | Antes de reavaliar o Bloco G |
| P7 | Modelo de multitenancy: `clinica_template` genérico vs. soul por clínica real (padrão `familia_<telefone>`) — decide se a suíte de isolamento cross-tenant é exigível já | Owner técnico | Antes do onboarding da primeira clínica real |
| P8 | Confirmar `MCP_ZERO_TRUST=on` no ambiente que servirá `clinica_template` (fecha G5) | Owner técnico | Antes de liberar `clinic_prevent_noshow` fora de teste |

## 6. Evidências exigidas

| Requisito/controle | Artefato | Local |
|---|---|---|
| G2 — segredo/credencial exposta | `TempVault` + `purgeCredentials(taskId)` | `packages/core/src/security/temp-vault.ts` |
| Catálogo de risco L1/L2/L3 para tools novas | `CapabilityCatalogEntry` / `authorizeExecution()` | `packages/core/src/policy.ts` |
| Molde de conteúdo para base legal/retenção de dado de saúde | `ADR-PRIV-001` (domínio famílias, mesmo perfil AI-4) | `~/.assistant-os/souls/consultoria_ia/conhecimento/clientes/sousalima/arquivo-historico/adr/ADR-PRIV-001.md` |

## 7. Exceção (v4.0 §8)

- **Requisito afetado (módulo + item):** Bloco 14 (IA: Riscos Avançados) — explicabilidade,
  contestação, red team adversarial, AIP com stakeholder externo, seguro/reserva financeira
  para dano irreversível.
- **Justificativa técnica e de negócio:** vertical ainda em fase de template/adoção, sem tenant
  real nem dado de paciente fluindo — investir em red team/seguro antes de ter um produto real
  e um primeiro cliente onboardado não é proporcional ao risco atual.
- **Alternativas consideradas:** implementar os controles completos do Bloco 14 antes de
  qualquer scaffolding técnico — rejeitado por desproporcional nesta fase (sem dado real em
  jogo).
- **Risco residual:** baixo enquanto não houver dado real de paciente; passa a alto no
  onboarding da primeira clínica real sem esses controles.
- **Controle compensatório:** `clinica_template` restrito a ambiente de teste/dry-run; Bloco G
  (G3/G4/G5) precisa estar aprovado antes de qualquer dado real, o que já bloqueia produção
  nesta fase.
- **Owner:** owner técnico + owner de risco (a nomear).
- **Aprovadores:** owner do repositório.
- **Prazo de validade:** até o onboarding da primeira clínica com dado real de paciente.
- **Condição objetiva de encerramento:** Bloco 14 respondido com evidência real antes do
  primeiro tenant real (clínica de verdade) ser ativado.
- Exceção permanente sem revisão não é permitida (v4.0 §8).

## 8. Gatilhos de reavaliação

- Mudança de arquitetura, fornecedor, modelo, protocolo, região ou classificação de risco.
- Novo requisito legal, regulatório ou contratual.
- Incidente relevante relacionado ao escopo.
- Vencimento da exceção do §7.
- Resposta a qualquer item das Pendências (§5) — reavaliar o Bloco G assim que P1/P5/P6 forem
  respondidos.

## 9. Aprovação

| Papel | Nome | Data | Assinatura/registro |
|---|---|---|---|
| Owner técnico | agente terrasIA | | |
| Owner de negócio | produto SLC Clínicas — owner a confirmar | | |
| Owner de risco | security-reviewer / DPO — a nomear | | |
| Aprovador da governança (owner do repositório) | | | |

## Histórico

| Data | Evento | Autor |
|---|---|---|
| 2026-09-07 | Proposta — Bloco G avaliado (BLOCKED), pendências P1–P8 registradas | agente terrasIA |
