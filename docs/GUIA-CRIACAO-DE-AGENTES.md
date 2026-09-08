# Guia de criação de agentes

Este guia junta duas trilhas que hoje vivem espalhadas no repo e no MCP `standards-v4`:
**como criar uma soul** (o agente de IA do produto terrasIA) e **como adequá-la aos
Padrões de Engenharia v4.0** (classificação de perfil, Bloco G, ADR). No fim, cobre
também um terceiro conceito — diferente dos dois anteriores — que é criar um
**subagente de harness de desenvolvimento** (Claude Code, Codex CLI/"GPT", OpenCode)
para uso durante o desenvolvimento deste repositório.

O caso real mais completo até hoje, que atravessa as três partes deste guia, é a
vertical **Clínicas** (`clinica_template`, `ADR-PRIV-003`, aceita em 2026-09-08) — ele
aparece como exemplo guiado ao longo do texto.

## 0. Que tipo de "agente" você está criando?

| Você quer... | É isso | Onde vive |
|---|---|---|
| Um agente de IA que atende um usuário final do produto (chat, triagem, automação de negócio) | **Soul do terrasIA** | `~/.assistant-os/souls/<id>/` |
| Uma ferramenta de desenvolvimento que ajuda *neste* repositório (revisão de código, pesquisa, scaffolding) | **Subagente de harness** (Claude Code, Codex CLI, OpenCode) | Depende do harness — ver Parte 3 |

São conceitos independentes — uma soul não vira subagente e vice-versa. As Partes 1 e 2
cobrem souls; a Parte 3 cobre subagentes de harness, um por seção (§3.1 Claude Code,
§3.5 Codex CLI, §3.6 OpenCode), com tabela comparativa em §3.7. **Exceção que confunde
os dois conceitos:** os arquivos `.opencode/agents/<soul-id>.md` já existentes neste
repo (ex.: `desenvolvimento.md`, `consultoria_ia.md`) não são subagentes de
desenvolvimento — são a definição nativa OpenCode de cada **soul**, o backend real por
trás de `soul.config.agent` (ver §3.6).

---

## Parte 1 — Criando uma soul no terrasIA

### 1.1 O que é uma soul

Uma soul é uma pasta em `~/.assistant-os/souls/<id>/`:

```text
souls/<id>/
  config.json          # agent.permissions (tools/skills/connectors), guardrails, autonomy
  perfil.md            # persona — injetado no prompt
  contexto.md          # contexto/situação atual — injetado no prompt
  licoes.md            # lições aprendidas (Guardian escreve aqui também)
  pessoas.md           # pessoas relevantes para a soul
  soul.md              # (opcional) instruções adicionais
  sessoes/             # histórico de chat
  sources/uploads/      # arquivos-fonte do RAG
  decisoes/
  skills/               # SKILL.md específicos desta soul (além dos globais)
```

Skills globais (compartilhadas entre souls) vivem em `~/.assistant-os/skills/`. Uma
skill só chega ao prompt de uma soul se o nome dela estiver em
`config.json`→`agent.permissions.skills` — ver §1.7.

### 1.2 Fluxo recomendado: tool MCP `soul_create`

Não crie a pasta/`config.json` na mão. Use a tool `soul_create`
(`packages/tools/src/soulCreate/index.ts`, sobre `packages/core/src/soul-spec.ts`), que
segue o protocolo **dry_run → plan_hash → commit**:

**Passo 1 — dry_run (default, não escreve nada):**

```json
{
  "soul_id": "juridico_template",
  "purpose": "Triagem inicial de casos jurídicos e checklist de documentos",
  "autonomy": "ask",
  "capabilities": "memory:*,graph_list,soul_anotar,soul_licao",
  "skills": "revisao-pos-reuniao",
  "max_turns": 8,
  "daily_limit": 50000
}
```

Resposta (sempre com `dry_run: true`, `ok`, `plan_hash`, `issues[]`, `resolved_spec`,
`would_create[]`):

```json
{
  "dry_run": true,
  "ok": true,
  "plan_hash": "a1b2c3...",
  "issues": [],
  "resolved_spec": { "...": "spec com defaults/guardrails já resolvidos" },
  "would_create": [
    "souls/juridico_template/config.json",
    "souls/juridico_template/{perfil,contexto,licoes,pessoas,soul}.md",
    "souls/juridico_template/{sessoes,sources,decisoes}/"
  ]
}
```

**Passo 2 — commit**, reenviando o `plan_hash` recebido e `dry_run: false`. Se a spec
mudou entre os dois passos, o hash diverge e o commit é recusado
(`plan_hash divergente — a spec mudou entre planejar e aplicar`) — não há caminho pra
"forçar" a criação sem revalidar.

Campos aceitos pela tool hoje (schema real, `soulCreate/index.ts`): `soul_id`,
`purpose`, `autonomy` (`suggest`\|`ask`\|`auto`, default `ask`), `provider`, `model`,
`capabilities`/`connectors`/`skills` (CSV), `daily_limit`, `max_turns`, `perfil_md`/
`contexto_md`/`pessoas_md`/`soul_md`, `dry_run`, `plan_hash`. **Não existem** hoje
`approvalPolicy`/`memoryPolicy`/`maxIterations`/`ragRelevanceThreshold` como parâmetros
de entrada da tool (embora o tipo `AgentConfig` os suporte) — pra usá-los, edite o
`config.json` gerado depois da criação. Também **não existe** uma tool
`soul_create_questions` — ela foi desenhada no plano original (ver §Apêndice) mas nunca
implementada; o fluxo real é só o dry_run/commit acima.

Autorização: `soul_create` é **L3** (efeito estrutural) — a soul chamadora precisa ter
`soul_create` na sua própria allowlist (`agent.permissions.tools`), fail-closed.

### 1.3 Limites de validação

`packages/core/src/soul-spec.ts` (`DEFAULT_SOUL_SPEC_LIMITS`), checados no dry_run:

| Limite | Valor |
|---|---|
| Cada campo de texto (`perfilMd`, `contextoMd`, `pessoasMd`, `soulMd`, `description`...) | ≤ 32 KB |
| Soma de todos os campos de texto | ≤ 128 KB |
| `skills` | ≤ 20 |
| `connectors` | ≤ 10 |
| `config.json` previsto (serializado) | ≤ 64 KB |
| `soul_id` | precisa casar `isValidSoulId` (slug — letras/dígitos/hífen/underscore) e não pode já existir |

Cada `capability` do payload precisa existir no `CAPABILITY_CATALOG` (§1.4) —
capability desconhecida vira `E_VALIDATION`, não é aceita silenciosamente.

### 1.4 Catálogo de capabilities (L1/L2/L3)

`packages/core/src/policy.ts`, `CAPABILITY_CATALOG` (versionado —
`CAPABILITY_CATALOG_VERSION`):

| Nível | Definição | Exemplos reais no catálogo hoje |
|---|---|---|
| **L1** | Leitura local, sem efeito persistente | `memory_search`, `memory_status`, `soul_context`, `graph_list`, `agenda_list`, `router_status`, `costs_summary`, `souls_list`, `worktree_list`, `mission_list`, `skill_list` |
| **L2** | Escrita local reversível OU leitura a sistema externo | `observation_add`, `agenda_add`, `soul_anotar`/`soul_licao`/`soul_decidir`, `memory_index`, `clinic_triage_lead`, leituras `ado_list_*`/`ado_get_work_item` |
| **L3** | Efeito externo / alto privilégio | `browser_*`, `ado_create_*`/`ado_update_*`/`ado_run_pipeline`, `guardian_*`, `sales_*`, `soul_chat`, `action_execute`, **`soul_create`**, `skill_create`, `mission_run`, `worktree_merge_locally`, `git_commit_push`, `clinic_prevent_noshow` |

Regra fail-closed: **capability que não está no catálogo é tratada como L3** (não como
"desconhecida = permitida"). Patterns suportam wildcard de namespace: `"memory:*"` casa
com `memory_search`, `memory_status` etc. (qualquer tool começando com `memory_`) —
`matchesToolPattern()` em `packages/core/src/types/agent.ts`.

Toda capability nova (ex.: uma tool nova de uma vertical) precisa de uma entrada
explícita no catálogo, com nível justificado — foi exatamente isso que a vertical
Clínicas fez (`clinic_triage_lead` → L2, `clinic_prevent_noshow` → L3, com descrição
justificando cada nível, citando o ADR).

### 1.5 `authorizeExecution()` — a função central de decisão

Ordem fixa, a primeira regra que casa vence:

```text
1. Denylist global / golden rules            → DENY
2. Capability fora do snapshot da soul       → DENY (E_AUTHZ)
3. Conector não declarado em connectors[]    → DENY (E_CONNECTOR)
4. Budget insuficiente                       → DENY (E_BUDGET)
5. autonomy:
   - suggest → bloqueia L2-com-efeito e L3
   - ask     → bloqueia L3 sem confirmação vigente
   - auto    → passa o que foi confirmado
6. approvalPolicy: só ADICIONA exigência de confirmação, nunca libera o que foi negado acima
7. ALLOW
```

`MCP_ZERO_TRUST` (env `on`/`1`/`true`) liga o enforcement completo dos passos 5 e 6; com
ele desligado, só allowlist/conector/budget valem. **Isso é literalmente a pendência P8
do `ADR-PRIV-003`** — a vertical Clínicas manteve `MCP_ZERO_TRUST` desligado por decisão
explícita, e compensou isso deixando `clinic_prevent_noshow` **hardcoded** para sempre
`dryRun: true` no próprio código (não depende do ambiente pra ser seguro).

### 1.6 Exemplos reais de `config.json`

**Soul legada, schema mínimo** (`~/.assistant-os/souls/consultoria_ia/config.json`) — sem
`autonomy`/`approvalPolicy`/`memoryPolicy`/`connectors` explícitos, cai nos defaults de
retrocompatibilidade (`autonomy="ask"`, `memoryPolicy` interno/parcial):

```json
{
  "name": "consultoria_ia",
  "description": "Consultoria em Inteligência Artificial e transformação digital",
  "agent": {
    "permissions": {
      "tools": ["*"],
      "skills": ["revisao-pos-reuniao", "revisao-pre-venda", "site-cloner", "..."]
    },
    "guardrails": { "maxTurns": 12, "maxIterations": 5, "ragRelevanceThreshold": 0.7 }
  }
}
```

**Soul AI-4 com allowlist fechada e `approvalPolicy`**
(`~/.assistant-os/souls/clinica_template/config.json`):

```json
{
  "name": "clinica_template",
  "description": "Template de vertical para clínicas... Perfil AI-4 (ADR-PRIV-003 Aceita)...",
  "agent": {
    "provider": "zen",
    "autonomy": "ask",
    "approvalPolicy": ["clinic_prevent_noshow"],
    "permissions": {
      "tools": ["clinic_triage_lead", "clinic_prevent_noshow", "memory_search", "memory_status", "soul_context", "soul_anotar", "soul_licao"],
      "skills": []
    }
  }
}
```

> **Pegadinha real encontrada neste levantamento:** o schema canônico de `AgentConfig`
> (`packages/core/src/types/agent.ts`) espera `guardrails` como **irmão** de
> `permissions` dentro de `agent` (é assim em `consultoria_ia` acima, e é assim que
> `buildAgentConfigFromSpec()` monta o `config.json` quando você usa `soul_create`). O
> `config.json` de `clinica_template` hoje tem `guardrails` **aninhado dentro de
> `permissions`** — um campo mal posicionado que `resolveEffectiveGuardrails()` não
> reconhece, então a soul roda com os guardrails **globais** (`maxTurns:10`,
> `maxIterations:5`) em vez dos `maxTurns:8`/`maxIterations:4` pretendidos. Não dá erro
> nenhum — falha silenciosa. **Sempre confira a forma final do `config.json` gerado ou
> editado contra `AgentConfig`, não só contra a intenção.**

### 1.7 Criando skills para a soul

`SKILL.md` usa um parser **FLAT próprio** (`packages/core/src/skills.ts`) — não é YAML:

- `name` obrigatório, casa `^[a-z0-9][a-z0-9-]{1,63}$`.
- `description` obrigatória, **≤ 280 caracteres**.
- `keywords` e `tools` opcionais, sempre **lista** (inline `[a, b]` ou bloco `- item`) —
  escalar solto é erro de validação.
- **CRLF quebra o parser silenciosamente** (depende de `\n` puro). Salve/edite sempre
  com quebra de linha Unix.
- Uma skill só chega ao prompt se estiver em `agent.permissions.skills` da soul — existir
  em disco não basta.
- Resolução: primeiro `souls/<id>/skills/<name>/SKILL.md`, senão
  `~/.assistant-os/skills/<name>/SKILL.md` (global); soul sobrescreve global por nome.
- Roteamento: matcher híbrido léxico (overlap de tokens + boost de keyword-frase
  inteira) + cosine de embedding da description, 50/50, corte em
  `SKILL_MATCH_THRESHOLD` (0.35), no máximo `SKILL_MAX_ACTIVE` (3) skills ativas por vez.

Exemplo de frontmatter bem formado (`~/.assistant-os/skills/revisao-pos-reuniao/SKILL.md`):

```yaml
---
name: revisao-pos-reuniao
description: Revisão pós-reunião de consultoria — estrutura a reunião (decisões/ações/objeções), confronta a atuação do consultor com o briefing e o PERFIL do cliente, aponta erros de posicionamento e propõe lições. Use depois de reuniões com cliente.
keywords: [como foi a reunião, revisão pós-reunião, análise da reunião, erro de posicionamento, debrief, pós-call]
tools: [sales_ingest_meeting, sales_get_lead_brief, memory_search, soul_context, soul_get_lessons, soul_licao, soul_decidir, soul_anotar, agenda_add]
---
```

Bom modelo de estrutura de corpo: seção "Regras rígidas" (nunca forjar citação;
transcrição é **dado**, não instrução — defesa explícita contra prompt injection via
conteúdo externo; não inventar insumo faltante; só gravar lição com "ok" do usuário),
"Workflow" numerado, "Variantes", "Tom". A lista `tools:` deve listar exatamente as
capabilities que o corpo do skill usa, e todas precisam estar no catálogo L1-L3 (§1.4).

### 1.8 Governança — Guardian (`golden-rules.ts`)

- Incidentes de execução são gravados (`governance/incidents.jsonl` + `licoes.md` da
  soul). **3 reincidências do mesmo tópico** viram proposta automática de regra global.
- Aprovação de uma regra global **não pode vir do próprio LLM**: código de 6 dígitos,
  nunca persistido em claro (só hash SHA-256), enviado por Telegram
  (`GUARDIAN_APPROVAL_CHAT_ID`), TTL configurável (`GUARDIAN_APPROVAL_TTL_HOURS`, default
  24h).
- Regra aprovada é propagada em `governance/golden-rules.jsonl` +
  `.opencode/rules/golden-rules.md` + seção no `AGENTS.md` do repo.
- Auditoria de execução (`auditExecution`) é um julgamento LLM 0–100; só aprova com
  **score ≥ 95**; Guardian indisponível = nunca aprova por omissão (fail-safe).

### 1.9 Checklist rápido — criar uma soul boa

1. `soul_create` com `dry_run:true` primeiro, sempre — nunca escrever `config.json` na mão.
2. Capabilities: pedir só o que a soul precisa; qualquer coisa fora do catálogo trava no
   dry_run — resolva ali, não depois.
3. `autonomy` correto para o risco real: `ask` é o default seguro; só usar `auto` com
   `approvalPolicy` cobrindo as capabilities L3 sensíveis.
4. Guardrails (`max_turns`/`daily_limit`) proporcionais ao caso de uso — e **confira a
   forma final do `config.json`** (§1.6, pegadinha do `guardrails` mal posicionado).
5. Skills: `SKILL.md` sem CRLF, `description` ≤280 chars, `tools:` batendo com o catálogo,
   e nome incluído em `agent.permissions.skills`.
6. Se a soul processa dado sensível/biométrico ou toma decisão automatizada com efeito
   jurídico → pare aqui e siga a Parte 2 **antes** de liberar uso real.
7. Testar com dado sintético antes de qualquer dado real de usuário/cliente.

---

## Parte 2 — Adequação aos Padrões de Engenharia v4.0 (MCP `standards-v4`)

### 2.1 Quando isso se aplica

Toda soul/vertical nova que usa IA em runtime precisa de uma classificação de perfil
**antes** de operar com dado real. Não é opcional para "agentes de produto" — é
justamente o que faltava documentar neste repo (a skill `v4-standards` e as tools MCP
já existiam; o que não existia era aplicá-las a uma soul concreta do terrasIA, documentado
aqui pela primeira vez).

### 2.2 Fluxo de adoção (5 passos)

1. Responder o **Bloco G** do questionário (gates de bloqueio — base legal, provedor,
   ação irreversível/aprovação humana, entre outros).
2. Classificar o perfil via `standards_classify_profile` (Core / AI-1 / AI-2 / AI-3 /
   AI-4 / Proibido) — registrar no ADR de adoção.
3. Responder os blocos aplicáveis do questionário (`standards_questionnaire`) com
   evidência real, não afirmação vazia (Princípio 10: "Sim" exige evidência; "Parcial"
   exige observação + prazo + owner).
4. Gerar os artefatos com os templates: `standards_draft_adr` (ADR), mapa de artefatos e
   lacunas, declaração de conformidade (`standards_conformance`).
5. Registrar exceções formais (v4.0 §8) onde algo ficar pendente por decisão consciente
   — nunca como pendência silenciosa.

### 2.3 Perfis e reclassificação obrigatória

| Perfil | Quando | Exige |
|---|---|---|
| **Core** | Sem IA em runtime | — |
| **AI-1** | IA sugere, humano decide/executa | Básico |
| **AI-2** | RAG/memória/tools só leitura | AI-1 + mais controles |
| **AI-3** | Agente com ações reversíveis / delega tarefas | AI-2 + agent harness, policy enforcement, approvals, replay |
| **AI-4** | Dados sensíveis, direitos, produção, finanças, ou ações irreversíveis | AI-3 + threat model, red team, aprovação formal, human-in-command, auditoria reforçada |

Reclassificações **forçadas**, independentes de outros fatores:
- Dado sensível ou biométrico em runtime → **no mínimo AI-4**.
- Decisão automatizada com efeito jurídico ou impacto relevante → **AI-4** (explicação,
  contestação, revisão humana — LGPD art. 20).
- Multitenant → exige modelo de isolamento + suíte de testes cross-tenant como evidência.
- Uso proibido (ilegal, discriminatório deliberado, vigilância indevida, credenciais
  expostas, autonomia irreversível sem controle) → perfil **Proibido**, ponto final.

### 2.4 As 13 tools MCP `standards_*`

| Tool | Quando usar |
|---|---|
| `standards_read_doc` | Ler um módulo/template canônico (`doc: "list"` lista todos) |
| `standards_resolve` | Resolver versão/precedência da norma |
| `standards_classify_profile` | Classificar perfil Core/AI-1..AI-4 |
| `standards_questionnaire` | Responder/validar o questionário de adoção por perfil |
| `standards_draft_adr` | Gerar esqueleto de ADR v4.0 |
| `standards_map_artifacts` | Mapa de artefatos e lacunas |
| `standards_conformance` | Gerar/validar declaração de conformidade |
| `standards_validate_evidence` | Validar evidências dos ADRs aceitos |
| `standards_spec_drift` | Checar drift spec↔harness |
| `standards_gate_blockg` | Avaliar Bloco G (5 gates) — veredito de produção |
| `standards_health_check` | Health check do repositório de normas |
| `standards_migration` | Orientar migração v3→v4 |
| `standards_context_manager` | Ler/atualizar o contexto executivo do projeto de normas |

### 2.5 Agent Harness (v4.0) — o que existe hoje no terrasIA

O módulo `ai-agent-harness` define os componentes obrigatórios de um harness de
produção para AI-2+. Mapeamento honesto contra o código real (não inflar cobertura):

| Componente exigido | Equivalente hoje no terrasIA | Status |
|---|---|---|
| Orchestrator | `packages/daemon/src/runner.ts` + `langgraph-runner.ts` | implementado |
| Policy enforcement point | `authorizeExecution()` (`policy.ts`) | implementado |
| Tool runtime | `packages/tools` (servidor MCP) | implementado |
| Memory manager | `memoryPolicy` — 4 pontos mínimos (ingestão/indexação/recuperação/prompt) | parcial (`enforcement: "partial"`) |
| Approval service | Guardian + aprovação por Telegram (regras globais); confirmação L3 por-execução ainda não tem UI/fluxo dedicado fora do chat/agenda do daemon | parcial |
| Execution manifest imutável por release | não existe | lacuna conhecida |
| Model gateway (fallback/roteamento determinístico) | router (`core` — seleção de tier) | parcial, sem circuit breaker dedicado |
| Telemetry | `router_history`, `execution_logs`, `cost_calls` (Postgres) | implementado |

Não prometa a um cliente/auditoria mais cobertura do que essa tabela mostra — é
exatamente esse tipo de lacuna que os ADRs de adoção devem registrar como exceção
formal (§2.2 passo 5), não esconder.

### 2.6 Protocolo MCP aplicado ao próprio terrasIA

`packages/tools` **é** um servidor MCP (stdio, JSON-RPC) — as regras de `ai-protocols.md`
para "Servidor" se aplicam a ele mesmo, não só a servidores externos consumidos:

- Expor capacidades de domínio, não espelhar endpoints internos indiscriminadamente.
- Cada tool tem owner, versão, schema e classificação de risco (é o que o catálogo L1-L3
  faz).
- Nunca fazer token passthrough para audiência incorreta.
- Alteração de tool/resource durante uma sessão exige detecção e reavaliação.

Para conectores externos (MCPs de terceiros que uma soul usa via `connectors[]`):
allowlist de servidores + versão fixada em produção; descoberta não implica confiança —
o servidor externo passa por homologação antes de ser liberado numa soul.

### 2.7 Estudo de caso completo: `clinica_template` / `ADR-PRIV-003`

Linha do tempo real, 3 commits:

1. **Fase 1 — conformidade documental** (`7ad004e`): questionário v4.0 completo
   respondido (Bloco G + Blocos 1–14, porque o perfil já se sabia AI-4 por dado de
   saúde), `ADR-PRIV-003` criado como **Proposta** com Bloco G **BLOCKED** — G3 (base
   legal/retenção indefinidas), G4 (provedor de mensageria indefinido), G5
   (`MCP_ZERO_TRUST` desligado por padrão) reprovados; G1/G2 aprovados. Nenhum código de
   produto tocado nesta fase — só `docs/adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md`,
   `docs/compliance/clinicas/{questionario-adocao-v4,mapa-artefatos-lacunas,declaracao-conformidade}.md`.
2. **Fase 2 — scaffolding técnico, modo dry-run** (`8d00c4b`): implementação real —
   `packages/tools/src/clinic/index.ts` com duas tools:
   - `clinic_triage_lead` (**L2**) — score comercial de lead (0-100, tiers
     quente/morno/frio por palavras-chave do ICP + urgência + contato), devolve dossiê.
     Explicitamente **não** processa diagnóstico/dado clínico.
   - `clinic_prevent_noshow` (**L3**) — **hardcoded no código para sempre devolver
     `dryRun: true`**; nunca despacha mensagem real, independente de configuração de
     ambiente. Motivo registrado na própria resposta da tool: *"clinica_template ainda é
     protótipo, sem clínica real onboardada, e MCP_ZERO_TRUST (P8, ADR-PRIV-003) segue
     desligado por decisão"*.

   Entradas correspondentes em `CAPABILITY_CATALOG` (`policy.ts`), soul
   `clinica_template` criada com `autonomy:"ask"` + `approvalPolicy:["clinic_prevent_noshow"]`,
   e 8 testes em `packages/tools/src/test/clinic-tools.test.ts` (incluindo o gate L3 sob
   `MCP_ZERO_TRUST=on`).
3. **Fecho do Bloco G** (`f37e494`): o owner do repositório respondeu 8 pendências
   (P1–P8: base legal LGPD art. 11 II "f" com supervisão de profissional de saúde,
   DPO/responsável clínico provisórios, retenção de 1825 dias provisória, sem
   biometria, Evolution API self-hosted como provedor — reaproveitando o canal WhatsApp
   já existente do repo, multitenancy adiada para o onboarding real,
   `MCP_ZERO_TRUST` mantido desligado por decisão explícita).
   `standards_gate_blockg` reavaliado → **`approved`**. `ADR-PRIV-003` passou de
   "Proposta" para **"Aceita (2026-09-08)"**; declaração de conformidade reemitida como
   **"Conforme com pendências datadas"**. Bloco 14 (exclusivo AI-4: explicabilidade,
   contestação, red team, AIP externo, seguro para dano irreversível) segue como
   **exceção formal aberta**, com validade até o onboarding da primeira clínica real.

**Precedente ainda mais antigo, citado como molde reaproveitável** no mapa de artefatos
de Clínicas: o domínio **famílias** (também AI-4, também dado de saúde) —
`packages/core/src/familias.ts` (`encerrarFamilia`/`excluirFamilia`/`sweepRetencaoFamilias`)
e as migrations `0008_familias_privacidade` (colunas `base_legal`/`finalidade`/
`encerrado_em`/`retencao_ate`) e `0013_familias_consent_evidence`. Para a **próxima**
vertical sensível, comece olhando esses dois moldes antes de desenhar do zero.

### 2.8 Checklist rápido — adoção v4 de uma soul/vertical nova

1. `standards_classify_profile` **antes** de escrever qualquer código de produto —
   descobrir o perfil primeiro muda o desenho.
2. Se AI-3/AI-4: rodar `standards_gate_blockg` cedo — ele aponta exatamente o que falta
   decidir (base legal, provedor, ação irreversível) antes de você investir em código.
3. Toda ação irreversível de uma tool nova de perfil AI-3+ nasce em modo dry-run
   hardcoded no código (não só configurável por env) até a aprovação humana formal
   existir de verdade — copie o padrão de `clinic_prevent_noshow`.
4. Registrar capability nova no `CAPABILITY_CATALOG` (`policy.ts`) com nível justificado
   antes de expor a tool numa soul.
5. Gerar ADR + mapa de artefatos + declaração de conformidade usando os templates —
   não escrever prosa solta fora do formato.
6. O que não dá pra resolver agora vira **exceção formal (§8)** com prazo e condição de
   encerramento — nunca uma pendência implícita.
7. Atualizar `docs/AI-INVENTORY.md` e `docs/ROADMAP.md` como paper trail (padrão já
   usado pelas linhas de famílias e Clínicas).

---

## Parte 3 — Subagentes de harness de desenvolvimento

Diferente das Partes 1-2: um subagente de harness não é parte do produto terrasIA — é
uma ferramenta usada durante o desenvolvimento **deste repositório**, análoga aos
agentes já disponíveis nesta sessão (`Explore`, `Plan`, `code-reviewer` etc.). O usuário
deste guia alterna entre três harnesses (Claude Code, Codex CLI/"GPT", OpenCode); esta
Parte documenta o mesmo conceito nos três, cada um com formato de arquivo próprio e
incompatível entre si — não existe um formato universal, cada seção abaixo é
autocontida.

> Nota de confiança geral: §3.1-3.4 (Claude Code) vêm de pesquisa desta sessão
> cruzada com o comportamento observado da própria ferramenta `Agent` da sessão — alta
> confiança nos campos centrais. §3.5 (Codex CLI) vem só de posts de terceiros
> (Simon Willison, Daniel Vaughan, Majestic Labs — citados na seção), porque não foi
> possível buscar a documentação oficial da OpenAI diretamente nesta sessão —
> **confira `codex --help`/docs oficiais antes de depender em produção**. §3.6
> (OpenCode) cruza a documentação oficial (`opencode.ai/docs/agents`) com arquivos
> `.opencode/agents/*.md` reais já versionados neste repo (evidência primária, não só
> doc de terceiro) — confiança alta no formato, mas com uma lacuna de runtime não
> confirmada, sinalizada em §3.6.

### 3.1 Claude Code — Formato

```markdown
---
name: nome-do-subagente
description: Quando delegar pra este subagente — usado no roteamento automático.
tools: Read, Grep, Glob
model: sonnet
---

Corpo do arquivo = system prompt do subagente.
```

Campos de alta confiança:

| Campo | Obrigatório | Valores |
|---|---|---|
| `name` | Sim | lowercase, hífens |
| `description` | Sim | frase densa — é o que decide se o roteamento automático escolhe este subagente |
| `tools` | Não | allowlist de ferramentas; sem o campo, herda todas |
| `model` | Não | `sonnet`/`opus`/`haiku`/id completo; sem o campo, herda o modelo da sessão principal |

### 3.2 Escopo e precedência

`.claude/agents/` (deste repo) tem precedência sobre `~/.claude/agents/` (todos os
projetos do usuário) quando o mesmo `name` existe nos dois. **Hoje nenhum dos dois
existe neste repositório nem para este usuário** — é greenfield.

### 3.3 Quando usar subagente vs. skill vs. conversa principal

- **Subagente**: tarefa autocontida, output verboso que poluiria o contexto principal
  (pesquisa ampla, varredura de arquivos, revisão de código), ou paralelismo real (N
  investigações independentes ao mesmo tempo).
- **Skill**: comportamento reutilizável dentro da conversa principal, sem isolar
  contexto — o equivalente, no terrasIA, ao `SKILL.md` de uma soul (§1.7).
- **Conversa principal**: qualquer coisa que precise de feedback iterativo curto —
  delegar a um subagente aqui só adiciona uma rodada de ida-e-volta sem necessidade.

### 3.4 Exemplo de próximo passo (sugestão, não implementado)

Um subagente de projeto que já conhece as Partes 1 e 2 deste guia — pensado, não criado
nesta tarefa:

```markdown
---
name: vertical-builder
description: Cria o scaffolding técnico + compliance v4.0 de uma vertical nova do terrasIA (soul, tools, catálogo de capabilities, ADR de adoção). Use ao começar uma vertical/domínio novo.
tools: Read, Grep, Glob, Bash
model: sonnet
---

Você segue o fluxo de docs/GUIA-CRIACAO-DE-AGENTES.md deste repositório: classifica o
perfil v4.0 primeiro, roda o Bloco G, só então escreve as tools da vertical seguindo o
padrão de packages/tools/src/clinic/index.ts (ações irreversíveis nascem em dry-run
hardcoded), registra as capabilities em packages/core/src/policy.ts, e cria a soul via
soul_create com dry_run antes de qualquer commit.
```

### 3.5 Codex CLI ("GPT") — Formato

Arquivo **TOML**, um por agente, nome do arquivo tem que casar com o campo `name`:

| Escopo | Caminho | Uso |
|---|---|---|
| Pessoal | `~/.codex/agents/<name>.toml` | agentes que valem pra qualquer projeto |
| Projeto | `.codex/agents/<name>.toml` | versionado no repo, compartilhado com o time |

**Gate de confiança:** um projeto **não-confiável** (a CLI pergunta/marca isso na
primeira vez que roda num repo novo) faz o Codex **ignorar `.codex/` inteiro** — proteção
contra injeção via config commitada por terceiro. Se um agente de projeto não estiver
sendo carregado, confirmar primeiro se o repo está marcado como confiável.

Campos:

| Campo | Obrigatório | Valores |
|---|---|---|
| `name` | Sim | precisa casar o nome do arquivo |
| `description` | Sim | usado pra decidir quando delegar |
| `developer_instructions` | Sim | system prompt do agente |
| `model` | Não | sobrescreve o modelo do agente pai |
| `model_reasoning_effort` | Não | `low`\|`medium`\|`high` |
| `sandbox_mode` | Não | `read-only`\|`workspace-write`\|`danger-full-access` |
| `nickname_candidates` | Não | lista de nomes de exibição pras instâncias geradas |
| `mcp_servers` | Não | tabela — servidores MCP específicos deste agente |
| `skills.config` | Não | tabela — overrides de skill pra este agente |

Exemplo (`~/.codex/agents/reviewer.toml`):

```toml
name = "reviewer"
description = "PR reviewer focused on correctness, security, and missing tests."
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"

developer_instructions = """
Review code like an owner.
Prioritise correctness, security regressions, and test coverage gaps.
Lead with concrete findings including file paths and line numbers.
Never modify files — your job is analysis, not implementation.
"""
```

Codex já vem com 3 subagentes prontos (**explorer**, **worker**, **default**) — a
diferença exata entre `worker` e `default` não está clara na fonte consultada (confiança
média nesse ponto específico, confirmar com `codex --help` antes de contar com isso).
Delegação é controlada em `[agents]` no `config.toml` (`~/.codex/config.toml` pessoal ou
`.codex/config.toml` de projeto) via `max_threads`/`max_depth` — limita fan-out.

`AGENTS.md` do projeto (já existe neste repo, ver raiz) é lido pelo Codex como contexto
persistente, o mesmo arquivo que Claude Code também consome — não precisa duplicar.

### 3.6 OpenCode — Formato

Arquivo **Markdown com frontmatter YAML** (ou JSON dentro de `opencode.json`, chave
`"agent"` — este guia cobre só a forma Markdown, mais próxima do padrão já usado no
repo):

| Escopo | Caminho |
|---|---|
| Global | `~/.config/opencode/agents/<name>.md` |
| Projeto | `.opencode/agents/<name>.md` |

O nome do arquivo vira o identificador do agente. Projeto tem precedência sobre global
pro mesmo nome (mesma regra do Claude Code, §3.2).

| Campo | Obrigatório | Valores |
|---|---|---|
| `description` | Sim | usado no roteamento automático |
| `mode` | Não (default `all`) | `primary`\|`subagent`\|`all` |
| `model` | Não | `provider/model-id`; sem isso, `primary` usa o modelo global e `subagent` herda o do agente que o invocou |
| `steps` | Não | máximo de iterações agênticas |
| `temperature` | Não | 0.0–1.0 |
| `permission` | Não | objeto — chaves `read`/`edit`/`glob`/`grep`/`bash`/`task`/`webfetch`/`websearch`/`skill`/`external_directory`, cada uma `allow`\|`ask`\|`deny`; aceita padrão glob por caminho (`external_directory` neste repo usa isso) |
| `prompt` | Não | inline ou referência a arquivo; se omitido, o corpo do `.md` é o system prompt |

Invocação: manual via `@nome-do-agente` na mensagem, ou automática por um agente
`primary` através da tool `task` (exige `permission.task: allow` no agente chamador).

**Exemplo real já existente neste repo**
(`.opencode/agents/desenvolvimento.md`, 24 linhas): `mode: primary`, `steps: 15`,
`permission` com `bash`/`task`/`webfetch`/`websearch`/`skill: allow` e
`external_directory` restrito a paths do próprio ambiente (`/home/support/assistente-os/*`,
`/home/support/.assistant-os/*`, etc.), corpo com seções "Capabilities"/"Guardrails".

> **Ponto real não confirmado, achado nesta investigação:** os 13 arquivos em
> `.opencode/agents/` deste repo têm nome igual a um `soul_id` e todos são
> `mode: primary` — eles são o backend nativo OpenCode de cada **soul**, não subagentes
> de dev. `packages/daemon/src/routes/stream.ts:437` e `voice.ts:45` chamam
> `runOpenCode(prompt, { cwd: soul.dir, agent: soul.config.agent ? soul.id : undefined })`
> (`packages/daemon/src/runner.ts`), ou seja, rodam `opencode run --agent <soul.id>`
> com `cwd` = diretório da soul em `~/.assistant-os/souls/<id>/` — **fora deste repo**.
> OpenCode resolve `.opencode/agents/` de projeto relativo ao `cwd`; como o `cwd` aqui
> nunca é a raiz deste repo, e nesta máquina não existe cópia em
> `~/.config/opencode/agents/` nem variável de ambiente equivalente a
> `OPENCODE_CONFIG` no `spawn()`, **não consegui confirmar que esses arquivos são
> realmente encontrados em produção** quando uma soul roda em modo `pro` via OpenCode.
> Antes de depender de `soul.config.agent`, valide com
> `cd ~/.assistant-os/souls/<id> && opencode run --agent <id> --print-logs "teste"` e
> confira se o agente certo (e não o default) respondeu.
>
> Consequência prática: se você quer um **subagente de desenvolvimento** de verdade
> (equivalente ao `Explore`/`Plan` do Claude Code), crie um arquivo **novo** com
> `mode: subagent` — não mexa nos arquivos por-soul existentes, que têm outro dono
> (o sistema de souls, Parte 1) e outro propósito.

Exemplo de subagente de dev (não existe hoje, análogo ao `vertical-builder` do §3.4):

```markdown
---
description: Varredura read-only do repo para localizar padrões de código antes de uma tarefa maior.
mode: subagent
permission:
  read: allow
  grep: allow
  glob: allow
  edit: deny
  bash: deny
---

Você só lê e busca no código. Nunca edita arquivos nem roda comandos. Devolva
caminhos de arquivo + trechos relevantes, sem tentar implementar nada.
```

### 3.7 Comparativo rápido

| | Claude Code | Codex CLI ("GPT") | OpenCode |
|---|---|---|---|
| Formato | Markdown + frontmatter YAML | TOML | Markdown + frontmatter YAML (ou JSON em `opencode.json`) |
| Escopo projeto | `.claude/agents/*.md` | `.codex/agents/*.toml` (só se repo confiável) | `.opencode/agents/*.md` |
| Escopo global | `~/.claude/agents/*.md` | `~/.codex/agents/*.toml` | `~/.config/opencode/agents/*.md` |
| Campo de restrição de ferramentas | `tools:` (allowlist simples) | `sandbox_mode` (nível grosso) | `permission:` (allow/ask/deny por ferramenta, glob por caminho) |
| Override de modelo | `model:` | `model:` + `model_reasoning_effort:` | `model:` |
| Invocação | roteamento automático por `description` | referência por `name` na conversa | `@nome` manual ou tool `task` automática |
| Neste repo hoje | nenhum criado ainda (greenfield, §3.2) | nenhum criado ainda | **já existe**, mas como backend de soul (§3.6), não como subagente de dev |
| Confiança da fonte | alta (pesquisa + comportamento observado) | média (só blog de terceiro) | alta no formato (doc oficial + arquivo real do repo); runtime da soul, não confirmada |

---

## Apêndice — referências rápidas

| Preciso de... | Onde está |
|---|---|
| Desenho arquitetural completo original de `soul_create` (C1-C4, ordem de implementação, testes) | `~/.assistant-os/souls/consultoria_ia/conhecimento/clientes/sousalima/arquivo-historico/docs/PLANO-CRIACAO-SOULS.md` (arquivado do repo em 2026-09-06) |
| Templates v4-standards (questionário, ADR, mapa de artefatos, conformidade) | `standards_read_doc` com `doc: "questionario-adocao"` \| `"adr-template"` \| `"mapa-artefatos"` \| `"conformance"` |
| Inventário de todas as capacidades de IA do repo por perfil | `docs/AI-INVENTORY.md` |
| Backlog/roadmap ativo, incl. seção "Vertical Clínicas" | `docs/ROADMAP.md` |
| Exemplo real de vertical AI-4 completa | `docs/adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md` + `docs/compliance/clinicas/` |
| Doc oficial de agentes OpenCode (§3.6) | [opencode.ai/docs/agents](https://opencode.ai/docs/agents/) |
| Posts de terceiro sobre agentes Codex CLI (§3.5, confiança média) | [simonwillison.net — Use subagents and custom agents in Codex](https://simonwillison.net/2026/Mar/16/codex-subagents/), [danielvaughan.com — Codex CLI Custom Agent Definitions](https://codex.danielvaughan.com/2026/04/27/codex-cli-custom-agent-definitions-toml-specialised-subagents/), [majesticlabs.dev — Codex CLI config.toml Guide](https://majesticlabs.dev/blog/202607/codex-cli-configuration-guide) |
