# ADR-PRIV-003 — Base legal, finalidade e retenção para dados de clínicas (clinica_template) — adoção AI-4

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**

> Cópia por decisão. Não editar um ADR aceito: nova decisão cria ADR substituto e preserva o histórico.

## Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-PRIV-003` |
| Status | **Aceita (2026-09-08)** — Bloco G aprovado (`standards_gate_blockg`, veredito `approved`); aceite registrado pelo owner do repositório (Everton Lima) via as decisões P1–P8 abaixo. Fase de produto: **protótipo, sem clínica real onboardada** (P7) |
| Perfil de conformidade | AI-4 (confirmado via `standards_classify_profile`) |
| Módulos normativos aplicáveis | privacy-lgpd-product, ai-governance, security-operations |
| Blocos do questionário de origem | Bloco G (gates G3, G4, G5), Bloco 14 |
| Relacionados | ADR-PRIV-001 (arquivado, domínio famílias — molde de conteúdo e mesma base legal para o dado sensível, art. 11 II "f"); ADR-PRIV-002/ADR-AI-005 (**não reaproveitados** — reservados/aposentados para o resíduo do domínio famílias, ver `docs/ROADMAP.md` § "Exclusões de escopo registradas"); `SLC/clinicas/system_prompt.xml` (rascunho técnico, implementado) |
| Rastreabilidade norma externa | LGPD art. 6º, 7º I, 11 I, 11 II "f", 18 VI · ISO/IEC 27001:2022 (A.5.34, A.8.10) · ISO/IEC 42001:2023 |
| Owner técnico | Everton Lima (via agente terrasIA) |
| Owner de negócio | Everton Lima — produto SLC Clínicas (ver `SLC/PERFIL.md`), owner provisório enquanto for protótipo (P2) |
| Owner de risco / DPO | Everton Lima — provisório enquanto for protótipo (P3) |

## 1. Contexto

A vertical técnica "clínicas" (soul `clinica_template` + MCP tools `clinic_triage_lead`/
`clinic_prevent_noshow`, implementada em modo dry-run a partir de `SLC/clinicas/system_prompt.xml`)
processa dado de saúde de paciente (procedimento médico, agenda) — categoria sensível pela LGPD.
`standards_classify_profile` confirmou perfil **AI-4** (dado sensível em runtime força
reclassificação, independente de outras características do agente).

O Bloco G foi avaliado duas vezes via `standards_gate_blockg`:

- **1ª avaliação (2026-09-07):** veredito **BLOCKED** — G3 (base legal/retenção
  indefinidas), G4 (provedor de mensageria indefinido) e G5 (`MCP_ZERO_TRUST` desligado por
  padrão, `authorizeExecution()` no-op) reprovados. G1/G2 aprovados.
- **2ª avaliação (2026-09-08, após decisões P1–P8 abaixo):** veredito **approved** — todos os
  5 gates aprovados com evidência.

Existe precedente direto no repo: o domínio famílias (também AI-4, também dado de saúde) foi
excluído do terrasIA em 2026-09-05 para virar produto separado (ver `docs/ROADMAP.md` §
"Exclusões de escopo registradas", `ADR-PRIV-001` arquivado). O usuário decidiu explicitamente
**não repetir esse caminho** para clínicas — trilha de adoção formal AI-4 completa dentro do
terrasIA, com as pendências resolvidas por decisão direta do owner do repositório (não por
analogia automática com o domínio famílias).

## 2. Decisão

Declarar a vertical clínicas (`clinica_template`) sob adoção formal do perfil AI-4 dentro do
terrasIA — não como produto separado.

**Fase atual: protótipo, sem clínica real onboardada (P7).** `clinica_template` permanece uma
soul genérica; não há suíte de isolamento cross-tenant ainda — fica pendente para o onboarding
da primeira clínica real (ver §5, item aberto).

**Base legal, finalidade e retenção (fecha G3):**

1. **Base legal — dado sensível de saúde** (procedimento médico, histórico): a IA atua
   **sempre sob supervisão de um profissional de saúde da clínica** (decisão P1) — tutela da
   saúde, LGPD art. 11 II "f", mesma base do `ADR-PRIV-001`/famílias. *Premissa organizacional:
   se em algum momento a triagem passar a operar sem revisão de um profissional de saúde no
   ato, este item precisa ser reaberto — a base legal muda para consentimento específico do
   paciente (art. 11 I), mais rigorosa em termos de captura.*
2. **Base legal — dado pessoal comum** (nome, telefone, agenda): consentimento do paciente
   (LGPD art. 7º I).
3. **Finalidade:** triagem comercial de lead (aderência ao ICP) e prevenção de no-show
   (gatilhos de cadência), sempre sob supervisão de um profissional de saúde habilitado da
   clínica — nunca diagnóstico, conduta ou decisão clínica automatizada.
4. **Retenção:** `CLINICAS_RETENCAO_DIAS = 1825` dias (5 anos), **provisório** — mesmo valor do
   `ADR-PRIV-001`/famílias, decisão P4, sujeito a confirmação com o conselho profissional
   competente (CFO/vigilância sanitária conforme o tipo de procedimento) antes do go-live com
   dado real. Mesma ressalva que não bloqueou a aceitação do `ADR-PRIV-001`.
5. **Sem dado biométrico real** nesta fase (decisão P5 — só texto/agenda). Se biometria (ex.
   fotos antes/depois) entrar no produto depois, reabrir este ADR para as regras de biometria
   (Bloco 4/G4 do questionário).

**Provedor de mensageria e transferência internacional (fecha G4):** Evolution API self-hosted
(decisão P6) — mesma infraestrutura Baileys/Evolution já usada no canal WhatsApp existente do
repo (`packages/daemon/src/channels/whatsapp.ts`). Nenhum fornecedor novo introduzido; a
exposição inerente ao protocolo WhatsApp (tráfego passa pela rede da Meta) já é aceita
implicitamente pelo canal existente — esta decisão não introduz uma transferência nova.

**Ação irreversível e aprovação humana (fecha G5):** `clinic_prevent_noshow` está
**hardcoded no código para sempre retornar `dryRun: true`**
(`packages/tools/src/clinic/index.ts`) — nenhuma mensagem real é despachada hoje, testado em
`clinic-tools.test.ts`. Por decisão do usuário (P8), `MCP_ZERO_TRUST` permanece desligado
nesta fase de protótipo. **Condição de reabertura:** antes de tirar `clinic_prevent_noshow` do
modo dry-run para despacho real, `MCP_ZERO_TRUST=on` precisa estar confirmado no ambiente que
servir a soul (ver §8, gatilho de reavaliação).

**Nenhum dado real de paciente deve fluir** por `clinic_triage_lead`/`clinic_prevent_noshow`
antes do onboarding formal da primeira clínica real (que reabre este ADR para as decisões
específicas daquele cliente — responsável clínico e DPO reais, prazo de retenção confirmado,
modelo de isolamento).

### O que NÃO muda

- Os números `ADR-PRIV-002`/`ADR-AI-005` continuam reservados/aposentados para o resíduo do
  domínio famílias (citados em `docs/ROADMAP.md`, `docs/AI-INVENTORY.md`, `CHANGELOG.md`).
- A aceitação e o conteúdo do `ADR-PRIV-001` (domínio famílias) não são alterados.
- O código de `clinic_prevent_noshow` continua hardcoded em dry-run — a aprovação deste ADR
  **não libera despacho real** por si só; isso exige uma mudança de código futura, gatilhada
  apenas quando `MCP_ZERO_TRUST=on` estiver confirmado (§8).

## 3. Alternativas consideradas

| Alternativa | Motivo da rejeição |
|---|---|
| Tratar clínicas como produto separado, mesmo caminho do domínio famílias | Usuário decidiu explicitamente a trilha AI-4 completa dentro do terrasIA, revertendo esse precedente para este caso |
| Reaproveitar os códigos `ADR-PRIV-002`/`ADR-AI-005` | Esses códigos já são citados em `docs/ROADMAP.md`, `docs/AI-INVENTORY.md` e `CHANGELOG.md` como identificadores específicos do resíduo excluído de famílias — reaproveitar para um domínio diferente contradiz o histórico já publicado |
| Aplicar por analogia automática a base legal e retenção do `ADR-PRIV-001` sem confirmar com o usuário | O contexto de atuação podia ser diferente (IA sem supervisão de profissional de saúde) — a base legal foi confirmada por decisão explícita (P1), não assumida |
| WhatsApp Business API oficial (Meta) como provedor de mensageria | Introduziria fornecedor novo, due diligence adicional e avaliação de transferência internacional dedicada — Evolution self-hosted reaproveita infra já aceita no repo |
| Ligar `MCP_ZERO_TRUST=on` imediatamente para fechar G5 "de vez" | Afetaria o comportamento de autorização de **todas** as souls do sistema, não só clínicas — desproporcional numa fase ainda de protótipo sem cliente real (decisão P8) |

## 4. Consequências e controles

| Consequência | Impacto | Controle compensatório |
|---|---|---|
| Retenção (1825 dias) é provisória, sujeita a ajuste quando confirmada com conselho profissional | Médio | Mesmo padrão do `ADR-PRIV-001`; ajuste de `CLINICAS_RETENCAO_DIAS` não exige novo ADR, só atualização de config antes do go-live real |
| Owners (técnico/negócio/risco/DPO) são todos a mesma pessoa (Everton Lima) nesta fase de protótipo | Baixo agora / Médio se virar produção real sem segregação | Fica pendência explícita (§5) nomear responsável clínico e DPO reais e distintos antes do onboarding da primeira clínica real |
| `clinic_prevent_noshow` aprovado no Bloco G, mas continua hardcoded em dry-run | Nenhum (controle redundante, não uma lacuna) | Mudança de código explícita necessária para sair do dry-run — não acontece "sozinho" só por este ADR ser aceito |
| Bloco 14 do questionário (exclusivo AI-4: explicabilidade, contestação, red team adversarial, AIP com stakeholder externo, seguro para dano irreversível) não tem evidência hoje | Médio | Registrado como exceção formal (§7) com validade e condição de encerramento — não é um gate G, não bloqueia esta aceitação |

## 5. Pendências (roadmap datado — owners)

| Item | Descrição | Status | Owner | Prazo |
|---|---|---|---|---|
| P1 | Base legal do dado sensível de saúde | ✅ **Resolvido** — supervisão de profissional de saúde, LGPD art. 11 II "f" | Everton Lima | — |
| P2 | Responsável profissional de saúde | ✅ **Resolvido (provisório)** — Everton Lima até 1ª clínica real nomear o seu | Everton Lima | Reabrir no onboarding da 1ª clínica real |
| P3 | DPO nomeado + substituto | ✅ **Resolvido (provisório)** — Everton Lima até 1ª clínica real ter DPO próprio; substituto ainda não nomeado | Everton Lima | Nomear substituto antes de produção real |
| P4 | Prazo de retenção | ✅ **Resolvido (provisório)** — 1825 dias, `CLINICAS_RETENCAO_DIAS` | Everton Lima / responsável clínico | Confirmar valor exato com conselho profissional antes do go-live real |
| P5 | Dado biométrico real? | ✅ **Resolvido** — não, nesta fase | Everton Lima | Reabrir se biometria entrar no produto |
| P6 | Provedor de mensageria | ✅ **Resolvido** — Evolution API self-hosted | Everton Lima | — |
| P7 | Modelo de multitenancy | ✅ **Resolvido para esta fase** — protótipo, sem cliente real, soul genérica | Owner técnico | Decidir isolamento cross-tenant no onboarding da 1ª clínica real |
| P8 | `MCP_ZERO_TRUST=on` no ambiente real | ✅ **Resolvido (decisão: não ainda)** — permanece desligado; código de `clinic_prevent_noshow` continua hardcoded em dry-run independente disso | Owner técnico | Confirmar antes de tirar `clinic_prevent_noshow` do dry-run |

Nenhum item acima é um bloqueio ao Bloco G — as decisões P1–P8 são exatamente o que fez os
gates G3/G4/G5 passarem de reprovado para aprovado na 2ª avaliação (§1). Os itens marcados
"provisório" ficam para reabertura no onboarding da primeira clínica real, não para reavaliação
do Bloco G em si.

## 6. Evidências exigidas

| Requisito/controle | Artefato | Local |
|---|---|---|
| G2 — segredo/credencial exposta | `TempVault` + `purgeCredentials(taskId)` | `packages/core/src/security/temp-vault.ts` |
| G4 — provedor de mensageria sem fornecedor novo | Canal WhatsApp existente (Baileys/Evolution) | `packages/daemon/src/channels/whatsapp.ts` |
| G5 — ação irreversível sem despacho real | `clinic_prevent_noshow` sempre `dryRun: true` | `packages/tools/src/clinic/index.ts`, testado em `packages/tools/src/test/clinic-tools.test.ts` |
| Catálogo de risco L1/L2/L3 para as tools novas | `CapabilityCatalogEntry` (`clinic_triage_lead`=L2, `clinic_prevent_noshow`=L3) | `packages/core/src/policy.ts` |
| Gate L3 funcional (autonomy × Zero Trust) | Teste `MCP_ZERO_TRUST=on` + `autonomy: suggest` bloqueia `clinic_prevent_noshow` | `packages/tools/src/test/clinic-tools.test.ts` |
| Molde de conteúdo para base legal/retenção de dado de saúde | `ADR-PRIV-001` (domínio famílias, mesmo perfil AI-4) | `~/.assistant-os/souls/consultoria_ia/conhecimento/clientes/sousalima/arquivo-historico/adr/ADR-PRIV-001.md` |

## 7. Exceção (v4.0 §8)

- **Requisito afetado (módulo + item):** Bloco 14 (IA: Riscos Avançados) — explicabilidade,
  contestação, red team adversarial, AIP com stakeholder externo, seguro/reserva financeira
  para dano irreversível.
- **Justificativa técnica e de negócio:** vertical ainda em fase de protótipo/template, sem
  tenant real nem dado de paciente fluindo — investir em red team/seguro antes de ter um
  produto real e um primeiro cliente onboardado não é proporcional ao risco atual.
- **Alternativas consideradas:** implementar os controles completos do Bloco 14 antes de
  qualquer scaffolding técnico — rejeitado por desproporcional nesta fase (sem dado real em
  jogo).
- **Risco residual:** baixo agora (nenhum dado real de paciente, `clinic_prevent_noshow`
  hardcoded em dry-run); passa a alto no onboarding da primeira clínica real sem esses
  controles.
- **Controle compensatório:** `clinica_template` restrito a ambiente de teste/dry-run;
  `clinic_prevent_noshow` não pode sair do dry-run sem mudança de código explícita + P8
  confirmado.
- **Owner:** Everton Lima (técnico e risco, provisório).
- **Aprovadores:** owner do repositório (Everton Lima).
- **Prazo de validade:** até o onboarding da primeira clínica com dado real de paciente.
- **Condição objetiva de encerramento:** Bloco 14 respondido com evidência real antes do
  primeiro tenant real (clínica de verdade) ser ativado.
- Exceção permanente sem revisão não é permitida (v4.0 §8).

## 8. Gatilhos de reavaliação

- **Onboarding da primeira clínica real** — reabre P2 (responsável clínico real), P3 (DPO
  real/distinto), P4 (confirmação exata do prazo de retenção), P7 (modelo de isolamento
  cross-tenant).
- **Antes de tirar `clinic_prevent_noshow` do modo dry-run** para despacho real de
  WhatsApp/e-mail — exige confirmar `MCP_ZERO_TRUST=on` no ambiente (P8) e, dado o alcance
  dessa env var (afeta todas as souls do sistema), uma decisão explícita separada.
- Entrada de dado biométrico real no produto (reabre P5 e as regras de biometria do Bloco 4).
- Mudança de arquitetura, fornecedor, modelo, protocolo, região ou classificação de risco.
- Novo requisito legal, regulatório ou contratual.
- Incidente relevante relacionado ao escopo.
- Vencimento da exceção do §7.

## 9. Aprovação

| Papel | Nome | Data | Assinatura/registro |
|---|---|---|---|
| Owner técnico | Everton Lima (via agente terrasIA) | 2026-09-08 | Decisões P1–P8 registradas via interação direta |
| Owner de negócio | Everton Lima | 2026-09-08 | idem |
| Owner de risco / DPO | Everton Lima (provisório) | 2026-09-08 | idem |
| Aprovador da governança (owner do repositório) | Everton Lima | 2026-09-08 | Aceite do ADR — Bloco G aprovado |

## Histórico

| Data | Evento | Autor |
|---|---|---|
| 2026-09-07 | Proposta — Bloco G avaliado (BLOCKED), pendências P1–P8 registradas | agente terrasIA |
| 2026-09-08 | **Aceita** — P1–P8 resolvidos pelo owner do repositório, Bloco G reavaliado (`approved`) | Everton Lima (via agente terrasIA) |
