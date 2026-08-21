# TASK: Implementação de Sales Intelligence, Browser Harness e Quarto Loop (assistente-os)

Você é o Engenheiro Sênior de Software e Arquiteto responsável pelo monorepo TypeScript `assistente-os`.
Siga estritamente o paradigma **Spec-Driven Development** em **Build Mode**. Mantenha a filosofia **Local-First** (Markdown puro como fonte canônica da verdade, PostgreSQL/pgvector como índice derivado, `npm workspaces`, TypeScript estrito e testes via `node:test`).

---

## 📋 1. PRD (Product Requirements Document)
- **Problema de Negócio:** Agentes perdem assertividade ("Dumb Zone") e operam de forma isolada, gerando código e dados descartáveis. É necessário transformar o daemon em um verdadeiro Sistema Operacional de IA capaz de ingerir dados comerciais, interagir com a web de forma resiliente a mudanças de layout e aprender com seus próprios erros e feedbacks.
- **Objetivos:**
  1. **Ingestão Comercial Unificada (SP6-03):** Processar transcrições de reuniões/calls, extrair inteligência de vendas (objeções, ICP, decisões) e sincronizar contextualmente.
  2. **Browser Harness Resiliente:** Permitir navegação semântica via CDP / árvore de acessibilidade com injeção de scripts dinâmicos de autoaperfeiçoamento (*Agentic Helpers*).
  3. **4º Loop de Autoaprendizado:** Retenção sistemática de lições e correções em `lessons.md` com promoção canônica e injeção automática no prompt da soul.
- **Fora do Escopo:** Refatorações estruturais no `memoria Core` ou alterações no schema do PostgreSQL não relacionadas aos novos fluxos.

---

## 🛠️ 2. SPEC & SPRINTS DE IMPLEMENTAÇÃO

### 🔹 SPRINT 1: Sales Intelligence & Call Ingest Pipeline (SP6-03)
- **Arquivo a Criar:** `packages/daemon/src/pipelines/meeting-ingest.ts`
- **Arquivo a Criar:** `packages/daemon/src/orchestrator/sales-intelligence.ts`
- **Requisitos & Contratos:**
  - `parseMeetingTranscript(rawText: string, format: 'vtt' | 'srt' | 'txt'): ParsedTranscript`
  - Extrair via LLM local (Ollama `/api/chat`):
    - `decisions: string[]`
    - `actionItems: { text: string; owner?: string; dueDate?: string }[]`
    - `objections: string[]`
    - `icpScore: { score: number; reason: string }`
  - Persistir em `~/.assistant-os/souls/<soulId>/sessoes/YYYY-MM-DD-meeting.md`.
  - Disparar reindexação vetorial via `packages/memory` (`pgvector`).
  - Função `generateCloserBrief(soulId: string, leadContact: string)`: Compila histórico de conversas, e-mails e objeções em um dossiê pré-call consolidado.
- **Critérios de Aceite:**
  - VTT/SRT com formatações complexas e timestamps sanitizados sem erros.
  - Fallback: se o Ollama/PostgreSQL falhar, salvar o arquivo bruto em disco sem travar o daemon.

---

### 🔹 SPRINT 2: Browser Harness Engine com CDP e Injeção Dinâmica
- **Arquivo a Modificar:** `packages/daemon/src/tools/browser.ts`
- **Requisitos & Contratos:**
  - Integrar conexão via **Chrome DevTools Protocol (CDP)** (`CDPSession`) utilizando `playwright-core`.
  - Método `getAccessibilityTree(taskId?: string)`: Extrai árvore de acessibilidade da página para navegação semântica independente de classes CSS dinâmicas/embaralhadas.
  - Método `executeDynamicFix(taskId: string, scriptContent: string, reason: string)`:
    - Injeta e executa JavaScript em sandbox para remoção de overlays, bloqueios de `z-index` e popups abusivos.
    - Trata erros em runtime retornando `{ ok: boolean, data?: unknown, error?: string }`.
  - Salvar scripts bem-sucedidos em `~/.assistant-os/souls/<soulId>/tools_cache/browser_helpers.json`.
- **Critérios de Aceite:**
  - Captura de screenshots com hash SHA-256 e metadata anexada.
  - Falhas de injeção ou desconexões CDP nunca devem causar uncaught exceptions.

---

### 🔹 SPRINT 3: Quarto Loop de Autoaprendizado (lessons.md)
- **Arquivo a Criar:** `packages/core/src/governance/self-learning.ts`
- **Arquivo a Modificar:** `packages/daemon/src/langgraph-runner.ts` (ou `agent-workflow.ts`)
- **Arquivo a Modificar:** `packages/tools/src/index.ts`
- **Requisitos & Contratos:**
  - Padronizar o arquivo `~/.assistant-os/souls/<soulId>/lessons.md`.
  - Expor as novas MCP Tools no `packages/tools/src/index.ts` com tipagem e autorização via `authorizeTool(soulId, toolName)`:
    - `soul_record_lesson(soulId: string, topic: string, mistakeOrFeedback: string, correctBehavior: string)`
    - `soul_get_lessons(soulId: string, limit?: number)`
    - `browser_get_accessibility_tree(taskId?: string)`
    - `browser_execute_fix(taskId: string, scriptContent: string, reason: string)`
    - `sales_ingest_meeting(soulId: string, transcript: string, format: string)`
  - **Injeção Dinâmica:** Injetar as últimas $N$ lições ativas do `lessons.md` dentro de `buildPrompt()` do daemon.
  - **Regra das 3 Reincidências:** Quando o mesmo tópico acumular 3 registros de feedback corretivo, promover automaticamente a diretriz para as regras canônicas de `SOUL.md`.

---

### 🔹 SPRINT 4: Telemetria FinOps & Testes Unitários
- **Arquivos a Criar:**
  - `packages/daemon/src/test/meeting-ingest.test.ts`
  - `packages/daemon/src/test/browser-harness.test.ts`
  - `packages/core/src/test/self-learning.test.ts`
- **Requisitos:**
  - Capturar `usage_metadata` (`prompt_tokens`, `completion_tokens`, `latency_ms`) em todas as invocações e anexar no rodapé de `sessoes/YYYY-MM-DD.md`.
  - Cobertura de testes via `node:test` e `node:assert/strict`.

---

## 🛡️ DIRETRIZES DE ENGENHARIA
1. **Zero Heavy Deps:** Utilizar apenas APIs nativas do Node (`node:fs/promises`, `node:path`, `node:crypto`), `playwright-core`, `@langchain/*`, `pg` e `zod`.
2. **Local-First & Resiliência:** Todo estado deve persistir primeiramente em Markdown local. Índices vetoriais e logs em banco de dados são camadas de aceleração derivadas (best-effort).

Execute as implementações sprint por sprint, execute `npm run build --workspaces` e `npm test --workspaces`, e apresente o relatório de alterações com os testes validados.