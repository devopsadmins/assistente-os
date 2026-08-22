# TASK: Criação do Agente Supervisor 'Guardian' e Motor de Regras de Ouro Globais

Você é o Engenheiro Sênior de Software e Arquiteto responsável pelo monorepo TypeScript `assistente-os`.
Implemente o sistema de supervisão crítica (Juiz), autoaprendizagem e propagação de regras de ouro (Golden Rules Enforcement) para todo o ecossistema e para o OpenCode.

---

## 🎯 ESCOPO DE IMPLEMENTAÇÃO

### 1. Criar a Alma Supervisora 'guardian'
- **Arquivo:** `~/.assistant-os/souls/guardian/config.json` e `SOUL.md`
- **Arquivo:** `.opencode/agents/guardian.md` (Subagente customizado no OpenCode)
- **Definição de Papel:**
  - Persona: Juiz implacável de qualidade, segurança e conformidade arquitetural (ISO/IEC 42001 e padrões do monorepo).
  - Tarefa: Auditar a saída gerada pelo agente `build` ou pelas souls, executar validações estáticas (`tsc --noEmit`, linters, testes unitários) e atribuir score (0 a 100).
  - Bloqueio: Rejeitar entregas com score < 95 ou que violem diretrizes arquiteturais.

---

### 2. Motor de Promoção de 'Regras de Ouro' (Golden Rules Synthesizer)
- **Arquivo:** `packages/core/src/governance/golden-rules.ts`
- **Requisitos:**
  - Função `recordAgentIncident(incident: { agentId: string; mistake: string; rootCause: string; correctiveRule: string }): Promise<void>`:
    - Registra o incidente na tabela ou arquivo de lições da governança.
  - Função `evaluateAndPromoteRules(): Promise<string[]>`:
    - Agrupa incidentes por similaridade semântica ou tópicos.
    - Se um padrão de erro acumular **3 ou mais reincidências**, sintetiza uma **Regra de Ouro Inegociável**.
  - Função `enforceGlobalRules(newRule: string): Promise<void>`:
    - **Propagação no OpenCode:** Anexa a nova regra em `.opencode/rules/golden-rules.md` e atualiza as diretrizes em `AGENTS.md`.
    - **Propagação nas Almas:** Atualiza a seção `## Regras de Ouro` em `~/.assistant-os/souls/*/SOUL.md`.
    - **Sincronização Vetorial:** Reindexa as novas regras no `packages/memory` (pgvector).

---

### 3. Exposição de MCP Tools de Governança
- **Arquivo:** `packages/tools/src/index.ts`
- **Novas Ferramentas:**
  - `guardian_audit_execution(taskId: string, targetAgent: string, changesSummary: string, testResults?: string)`: Executa a auditoria e retorna `{ approved: boolean, score: number, feedback: string }`.
  - `guardian_promote_golden_rule(topic: string, ruleText: string, reason: string)`: Força a gravação de uma regra canônica para todos os agentes.
  - `guardian_get_golden_rules()`: Retorna a lista consolidada de todas as regras ativas.

---

### 4. Integração no Pipeline de Prompt do Daemon
- **Arquivo:** `packages/daemon/src/langgraph-runner.ts` (ou `orchestrator/router.ts`)
- **Requisito:**
  - Na função `buildPrompt()`, garantir que a lista de **Regras de Ouro Consolidadas** seja sempre pré-fixada antes do contexto da tarefa, garantindo que nenhum modelo execute sem respeitá-las.

---

### 5. Testes Unitários
- **Arquivo:** `packages/core/src/test/golden-rules.test.ts`
- **Testes:**
  - Registrar 3 incidentes iguais e verificar a síntese e promoção automática da regra de ouro.
  - Validar a escrita nos arquivos `.opencode/rules/golden-rules.md` e nos `SOUL.md`.

Execute `npm run build --workspaces` e `npm test --workspaces` e apresente o relatório de arquivos criados e validados.