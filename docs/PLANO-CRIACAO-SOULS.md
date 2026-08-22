# Plano — Provisionador de Souls com Configuração Guiada (v4 final consolidado)

> Status: aprovado para implementação. Este documento consolida as decisões das versões v1–v4 e os pareceres de revisão arquitetural.
> Frase-síntese: **a criação de uma soul agora é um commit de política de execução, não apenas uma operação de filesystem.**

---

## 1. Contexto e objetivo

Hoje criar uma soul exige conhecimento técnico: criar diretório, escrever `config.json`, preencher os arquivos de alma e configurar permissões manualmente. O objetivo é expor essa capacidade como **tool MCP de configuração guiada**, em que o agente opencode conduz a entrevista com o usuário humano e o sistema provisiona identidade, memória, capabilities, conectores e políticas de runtime.

## 2. Decisões fechadas

| Tradeoff | Decisão |
|---|---|
| Formato | **Stateless**: 2 tools (`soul_create_questions` + `soul_create`); o agente entrevistador conduz o diálogo; sem estado em disco |
| Autorização | **Fail-closed**: `AGENT_SOUL_ID` do chamador + nomes exatos (`soul_create_questions`, `soul_create`) na allowlist dele. Nada de pattern amplo tipo `soul_create*` |
| MCPs externos | **Catálogo → dois níveis**: capability local (`permissions.tools`) + conector/servidor (`agent.permissions.connectors[]`). Se o enforcement real não estiver provado, o wizard rejeita a concessão de conectores externos (nada decorativo) |
| Estrutura criada | **Completa**: config.json com agent/guardrails, 5 arquivos de alma preenchidos, dirs, indexação opcional |
| Prévia | **`dry_run: true`** na própria `soul_create`: preview + riscos + `planHash`; modo real exige `dry_run:false` + `confirmed:true` + hash vigente |
| Criação | **Atômica**: temp dir → validar tudo → `rename()` exclusivo (`EEXIST` = corrida perdida) |
| Indexação | Separada do sucesso da criação; retorno segmentado `requested / created / indexed / index_error / activated / failed` |
| Tools de risco | Confirmação **individual por capability L3**, não booleano genérico |
| Skills | Dedup por nome + origem informada + hash p/ detectar deriva posterior + apenas diretórios confiáveis |
| Provider/model | Validado contra lista permitida do router/config; nunca aceitar URL/chave/segredo no payload |
| Conteúdo .md | Limite por arquivo e total em **bytes**; sanitização; guardrails não sobrescrevíveis via soul.md |
| `set_active` | Exige confirmação específica; swap atômico preservando valor anterior p/ rollback; só após validação de runtime completa |

### Campos narrativos coletados no questionário

| Campo | Destino |
|---|---|
| `mission`, `nonGoals` | perfil.md / contexto.md (narrativo) |
| `dataClassification` | Persistido E usado nas decisões de memória (C4) |
| `eventTriggers` | Persistido como intenção; scheduler ainda não interpreta (explícito na doc) |
| `outputContract` | Persistido; consumível pelo contexto do agente |

### Políticas de runtime (vão para `config.json`, com enforcement nesta entrega)

| Campo | Valores | Enforcement |
|---|---|---|
| `autonomy` | `suggest` \| `ask` \| `auto` | Implementado (C1) |
| `approvalPolicy` | Lista de ações que sempre exigem humano | Implementado mínimo (C1) |
| `memoryPolicy` | `{ classification, retention?, enforcement: "partial" }` | Implementado nos 4 pontos mínimos (C4) |

## 3. Contratos fechados

### C1 — Precedência formal de políticas

Função central única em core:

```ts
authorizeExecution({
  soulId,
  capability,
  connector,
  effect,
  confirmation,
  budget
})
```

Ordem de decisão (primeira que casar vence):

```text
1. Denylist global / golden rules            → DENY
2. Capability fora do snapshot resolvido     → DENY   (E_AUTHZ)
3. Conector não declarado em connectors[]    → DENY   (E_CONNECTOR)
4. Budget insuficiente                       → DENY   (E_BUDGET)
5. autonomy:
   - suggest → bloqueia L2-efeito e L3
   - ask     → bloqueia L3 sem confirmação válida
   - auto    → passa o que foi confirmado na criação
6. approvalPolicy: só ADICIONA exigência de aprovação;
   nunca libera nada negado acima, nunca transforma suggest em auto
7. ALLOW
```

Invariantes:
- A soul nunca amplia limite global (`effectiveMaxIterations = min(globalLimit, soulLimit)`).
- `approvalPolicy` pode exigir aprovação adicional, nunca remover.

**Semântica de "confirmação recente"**: tabela `policy_confirmations(soul, capability, actorSession, createdAt, expiresAt, consumedAt)`.
- TTL padrão: **10 minutos**.
- Vale para **uma única execução** da capability confirmada.
- Criada quando o humano aprova no fluxo do daemon (chat/agenda); registra quem confirmou e qual contexto estava vigente.
- `ask` + L3 via chamada direta MCP retorna erro instrutivo ao agente (superfícies de aprovação são os fluxos do daemon).

### C2 — Prova E2E de enforcement

O agent file é **defesa em profundidade**, não a fronteira única:

| Camada | Papel |
|---|---|
| `config.json` da soul | Fonte canônica declarativa (obrigatório) |
| Agent file por soul | Artefato derivado, regenerável, com hash |
| `runner.ts` | Seleciona agent obrigatoriamente; falha fechada se ausente/divergente/não associável |
| Camada de chamada MCP | Bloqueia server/tool não autorizado (testes negativos obrigatórios) |
| OpenCode | Verificado por teste end-to-end, nunca presumido |

- Agent file gerado em `~/.assistant-os/souls/<id>/runtime/opencode-agent.md`, materializado em `.opencode/agents/<soul>.md`.
- Metadados no arquivo: `soulId, schemaId, catalogVersion, configHash, generatedAt`.
- Divergência de hash → recusa ou regeneração; edição manual detectável.
- Testes E2E negativos contra daemon real: soul **sem** conector tentando `browser_navigate` pelo caminho REST/opencode **e** pelo caminho LangGraph → ambos bloqueados; bypass sem `AGENT_SOUL_ID` ou com id divergente → negado.
- Se ficar provado que o opencode ignora restrições do agent file para MCPs externos: o wizard **rejeita concessão de conectores externos** e a lacuna fica documentada como risco conhecido.

### C3 — Budget transacional

Tabela `budget_reservations(id, soul, amount_est, status[reserved|settled|released], created_at, settled_at)` no Postgres:

```text
BEGIN
  INSERT reserva SE spent_today + reserved_total + estimativa <= limite
  SENÃO DENY (E_BUDGET)
COMMIT
→ executa chamada
→ settleBudget: soma consumo real, marca settled/released
```

- Estouro do in-flight é contabilizado integralmente e logado como `budget_overflow`; próxima reserva já nasce bloqueada até voltar ao limite.
- Chamada sem estimativa confiável usa default conservador fixo.
- Ponto único de passagem: wrappers em `runOpenCode` (runner), LangGraph, voz e agenda — todos reservam antes e liquidam depois.

### C4 — Alcance exato da memoryPolicy (4 pontos mínimos)

| Ponto | Comportamento |
|---|---|
| 1. Ingestão (`sales_ingest_meeting`) | Recusa conteúdo classificado proibido/sensível conforme política |
| 2. Indexação (`indexDirectory`) | Classificação por chunk (manifesto `.aos-manifest.json`); proibido não vira embedding nem chunk literal |
| 3. Recuperação (`searchWithVerdict`, inclusive fallback literal) | Filtra resultados por classificação |
| 4. Inclusão no prompt/contexto (`soul_context`, montagem de contexto LangGraph) | Nunca injeta conteúdo sensível |

Retorno e documentação declaram exatamente esses 4 caminhos cobertos + `enforcement: "partial"`.

## 4. Catálogo de capabilities (fechado e versionado)

Constante exportada `CAPABILITY_CATALOG` com `version` e três níveis de risco:

| Nível | Definição | Exemplos | Confirmação |
|---|---|---|---|
| **L1** leitura local | Sem efeito persistente | `memory_search`, `soul_context`, `graph_list`, `memory_status`, `agenda_list`, `router_status` | Wizard concede direto |
| **L2** escrita local reversível | Altera estado próprio da soul | `observation_add`, `agenda_add`, `soul_anotar/licao/decidir`, `action_execute`(local) | Conforme `autonomy` |
| **L3** efeito externo / alto privilégio | Sai da soul ou concede poder | `browser_*`, `ado_*` mutáveis, `guardian_*`, `sales_*`, `soul_chat`, `action_execute`, **`soul_create`** | Confirmação individual no wizard |

Regras:
- Patterns do payload são **resolvidos para nomes concretos no momento da criação** (snapshot impede herdar tools futuras).
- Payload resolvido deve ser subconjunto do catálogo; qualquer capability desconhecida → rejeitar (`E_VALIDATION`).
- Conceder `soul_create` a uma nova soul exige decisão explícita de maior privilégio (confirmação individual).
- Catálogo inclui mapeamento de grupos MCP externos → patterns (azure-devops→`ado_*`, playwright→`browser_*` etc.) e nota de que habilitação global dos servers vive no `opencode.json` do repo; controle da soul = allowlist + `connectors`.

## 5. Tools MCP

### 5.1 `soul_create_questions`

- Input: nenhum parâmetro obrigatório.
- Autorização: fail-closed — `AGENT_SOUL_ID` presente e `soul_create_questions` na allowlist exata da soul chamadora.
- Output: steps do questionário com defaults/exemplos + catálogos:
  1. Identidade: `id` (`/^[A-Za-z0-9_-]+$/`, unicidade checada), `description`
  2. Persona: conteúdo inicial de `perfil.md`, `contexto.md`, `pessoas.md`, `soul.md` (opcionais; vazio → template)
  3. Capabilities: catálogo L1/L2/L3 com patterns sugeridos
  4. Conectores: catálogo de MCPs externos disponíveis (com aviso de enforcement)
  5. Skills: scan dos dirs confiáveis (`.opencode/skills` do repo, `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills`) → nome + origem + hash, dedup por nome
  6. Guardrails: `maxTurns` (10), `maxIterations` (5), `ragRelevanceThreshold` (0.70), `allowedOrigins` (validado origem a origem; wildcard rejeitado por padrão), `dailyLimitTokens`
  7. Provider/model custom (validado contra lista permitida)
  8. Narrativos: `mission`, `nonGoals`, `dataClassification`, `eventTriggers`, `outputContract`
  9. Pós-criação: `index_memory` (bool), `set_active` (bool, default false)

### 5.2 `soul_create`

Payload único:

```ts
{
  soul: string,                 // criadora, para autorização
  new_id: string,
  description?: string,
  perfil_md?, contexto_md?, pessoas_md?, soul_md?,
  mission?, nonGoals?, dataClassification?, eventTriggers?, outputContract?,
  autonomy: "suggest"|"ask"|"auto",
  approvalPolicy?: string[],    // capabilities que sempre pedem humano
  memoryPolicy?: { classification, retention? },   // enforcement:"partial" implícito
  capabilities: string[],       // resolvidas a nomes concretos
  connectors?: string[],
  skills?: string[],
  guardrails?: { maxTurns?, maxIterations?, ragRelevanceThreshold?, allowedOrigins?, dailyLimitTokens? },
  provider?, model?,
  index_memory?: boolean,
  set_active?: boolean,
  // protocolo de intenção:
  dry_run: boolean,
  confirmed?: boolean,
  confirmedCapabilities?: string[],   // cobre todas as L3 escolhidas
  confirmedSetActive?: boolean,
  planHash?: string             // do dry_run correspondente
}
```

Fluxo:

1. **Autorização** fail-closed (nomes exatos).
2. **Validações** (antes de criar nada): id válido e inexistente; capabilities ⊆ catálogo; skills existentes (warning se divergirem); provider/model permitido; limites de tamanho respeitados.
3. **`dry_run: true`** → retorna árvore prevista, config.json previsto, conectores, guardrails efetivos (com clamps), `riskyCapabilities[]` (todas as L3 escolhidas, individualizadas) e `planHash = sha256(schemaVersion ‖ catalogVersion ‖ spec c/ defaults resolvidos ‖ provider/model efetivo)`.
4. **Commit** exige `dry_run:false` + `confirmed:true` + `confirmedCapabilities` cobrindo todas as L3 + `planHash` vigente (hash divergente → `E_STALE_HASH`; catálogo mudou entre prévia e commit → recusa).
5. **Criação atômica**: temp dir → escrever config.json completo + arquivos de alma + dirs (`sessoes/`, `sources/`, `decisoes/`) → validar → `rename()` exclusivo (EEXIST → `E_CONFLICT` com mensagem clara). Rollback remove temp em qualquer falha intermediária.
6. **Runtime validation** antes de qualquer efeito colateral: agent file gerado + hash verificado + smoke check de `authorizeExecution()`.
7. **Pós** (nesta ordem): `set_active` (se confirmado — swap atômico registrando valor anterior) → `memory_index` (se pedido). Falha aqui **não desfaz** a soul; retorno segmenta estados.
8. **Auditoria** sempre (pré-condição do commit).

Retorno segmentado:

```json
{ "requested": true, "created": true, "indexed": false, "index_error": "...",
  "activated": false, "previousActiveSoul": null, "failed": null }
```

Uma criação bem-sucedida com indexação falha **nunca** é reportada como sucesso total.

## 6. Segurança

- Autorização por nomes exatos na allowlist; conceder `soul_create` a outra soul é privilégio elevado com confirmação individual.
- Id sanitizado contra path traversal/symlink (`soulDir()` já valida pattern; testes negativos garantem).
- Skills: apenas dirs confiáveis; dedup por nome; origem + hash registrados; hash usado depois para detectar alteração.
- Provider/model: só referências permitidas; nunca persistir chaves/URLs/segredos no config.json.
- `allowedOrigins`: validação origem a origem; wildcard rejeitado por padrão.
- Limites (bytes, não caracteres): **32 KB por arquivo**, **128 KB total** de conteúdo inicial, ≤20 skills, ≤10 conectores, config.json ≤64 KB.

## 7. Auditoria

Via `logFullAuditEntry()`, registrando também falhas de preview, confirmação recusada e tentativa de bypass — não apenas commits:

```text
actorSoulId, createdSoulId,
requestedSpecHash, committedSpecHash, configHash,
catalogVersion, connectors, capabilities,
provider, model,
indexRequested, activeRequested, riskConfirmation,
previousActiveSoul, result
```

Distinção clara entre `requested / created / indexed / activated / failed`. Hashes SHA-256 dos conteúdos; **nunca** material sensível bruto.

## 8. Códigos de erro estáveis

`E_AUTHZ`, `E_CONNECTOR`, `E_BUDGET`, `E_STALE_HASH`, `E_VALIDATION`, `E_CONFLICT`, `E_INDEX`, `E_POLICY_APPROVAL`.

## 9. Migração e compatibilidade

- Souls antigas **não são tocadas em disco**; defaults aplicados por funções resolve: `connectors=[]`, `autonomy="ask"`, `memoryPolicy={enforcement:"partial"}`.
- Documentar explicitamente quais caminhos estão sob enforcement parcial.

## 10. Arquivos afetados

| Pacote/arquivo | Mudança |
|---|---|
| `packages/core/src/soul-spec.ts` (novo) | `SoulSpec`, validação centralizada, limites em bytes, `planHash` |
| `packages/core/src/policy.ts` (novo) | `authorizeExecution()` central, resolução de capabilities, clamps |
| `packages/core/src/souls.ts` | `createSoulFull()` atômico; `setActiveSoul()` com swap atômico + rollback |
| `packages/core/src/types/agent.ts` | `AgentConfig` v2 (`connectors`, `autonomy`, `approvalPolicy`, `memoryPolicy`); `resolveEffectiveGuardrails()` com `min(global, soul)` |
| `packages/tools/src/index.ts` | `CAPABILITY_CATALOG` versionado, scanner de skills, 2 entradas em `TOOLS`, 2 cases em `executeTool`, autorização por nome exato |
| `packages/daemon/src/runner.ts` | Fail-closed no agent file; `--agent <soul>` obrigatório quando config.agent existe; hooks de budget |
| `packages/daemon` (LangGraph/orchestrator/agenda/voice) | Reuso de `authorizeExecution()` + reserva de budget |
| `packages/memory` | memoryPolicy nos pontos ingestão/indexação/recuperação |
| `docs/AGENTS.md`, `docs/LANGGRAPH.md`, `docs/MCPS.md` | Políticas de execução, enforcement e limites atualizados |

## 11. Testes

### Unitários / adversariais

1. `questions` sem `AGENT_SOUL_ID` → erro `[Security 42001]`
2. Allowlist sem nome exato → bloqueado
3. `AGENT_SOUL_ID` ≠ soul informada → negado
4. Path traversal / symlink no `new_id` → rejeitado
5. Corrida no mesmo id (2 commits paralelos) → um vence, outro `E_CONFLICT`, sem corrupção
6. Falha de escrita intermediária → rollback, nenhum dir residual
7. Indexação falha → `created:true, indexed:false, index_error` preenchido
8. `set_active` falho → rollback do valor anterior
9. Conteúdo acima do limite (bytes) → `E_VALIDATION`
10. Pattern sintaticamente válido mas fora do catálogo → rejeitado
11. Skill duplicada entre dirs → origem informada, dedup
12. Provider não permitido → rejeitado
13. Concessão de `soul_create`/L3 sem confirmação individual → rejeitada
14. `planHash` stale → `E_STALE_HASH`
15. Precedência: denylist > clamp global > autonomy > approvalPolicy > permitida (tabela-decisão testada caso a caso)
16. Confirmação single-use: segunda execução com mesmo token → `E_POLICY_APPROVAL`; token expirado → idem

### Propriedades

- **Idempotência**: retry após falha não corrompe a soul nem duplica índices/eventos/arquivos.
- **Fail-closed**: soul sem agent file/hash divergente → runner e LangGraph recusam execução.

### E2E (contra daemon real)

17. Soul **sem** conector tenta `browser_navigate` via REST/opencode → bloqueada
18. Mesmo cenário via caminho LangGraph → bloqueada
19. Bypass direto ao MCP sem `AGENT_SOUL_ID` ou com id divergente → negado
20. memoryPolicy: doc sensível → ausente de indexação, busca (inclusive literal), `soul_context` e prompt LangGraph

## 12. Ordem de implementação

1. `SoulSpec` + `AgentConfig` versionado + contrato central `authorizeExecution()`
2. Validação, clamps globais e criação atômica
3. Catálogo fechado e resolução de capabilities
4. `soul_create_questions` + `dry_run`
5. Criação confirmada, auditoria e estados segmentados
6. Agent files + enforcement no runner e no LangGraph
7. memoryPolicy nos 4 pontos definidos
8. Budget com reserva transacional
9. Testes adversariais, de concorrência e end-to-end
10. Documentação, migrações e observabilidade

## 13. Fora de escopo (v1)

- Wizard stateful / draft persistence em disco
- `opencode.jsonc` por soul
- Update/delete de souls (futuro: `soul_update`)
- Retenção completa de memória (v1 entrega os 4 pontos mínimos + `enforcement: partial`)
- Scheduler interpretando `eventTriggers`
