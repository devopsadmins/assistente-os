# TASK: Implementação do Módulo de Inteligência Comercial e Ingestão de Calls (AI-First OS)

Você é o Engenheiro Sênior de Software e Arquiteto responsável pelo monorepo TypeScript `assistente-os`.
Saia do modo de planejamento e execute a implementação no modo de construção (**Build Mode**), respeitando a filosofia **Local-First** (Markdown puro como fonte canônica da verdade, PostgreSQL/pgvector como índice derivado e tipagem estrita em TypeScript).

---

## 🎯 ESCOPO DE IMPLEMENTAÇÃO

### 1. Ingestão de Gravações e Transcrições de Reuniões (SP6-03)
- **Arquivo:** `packages/daemon/src/pipelines/meeting-ingest.ts`
- **Requisitos:**
  - Implementar parser para ingestão de transcrições de chamadas (`.vtt`, `.srt`, `.txt` brutos de Zoom/Meet/Whisper).
  - Pipeline de extração estruturada via LLM local (Ollama / `http://localhost:11434/api/chat`):
    - **Decisões tomadas** (`decisions: string[]`)
    - **Pontos de ação com responsável/prazo** (`actionItems: { text: string; owner?: string; dueDate?: string }[]`)
    - **Objeções comerciais e dores mapeadas** (`objections: string[]`)
    - **Mapeamento de ICP e score de conversão** (`icpScore: number; reason: string`)
  - **Persistência Local:** Gravar o arquivo formatado em `~/.assistant-os/souls/<soulId>/sessoes/YYYY-MM-DD-meeting.md`.
  - **Sincronização Vetorial:** Disparar indexação semântica no `packages/memory` (pgvector).

---

### 2. Módulo de Inteligência de Vendas e Objeções (Sales Moat & Lessons)
- **Arquivo:** `packages/daemon/src/orchestrator/sales-intelligence.ts`
- **Requisitos:**
  - Criar rotina para consolidar aprendizados de negociações:
    - Identificar objeções reincidentes e argumentos que funcionaram/falharam.
    - Registrar lições estruturadas no arquivo `~/.assistant-os/souls/<soulId>/lessons.md`.
  - **Dossiê Pré-Call (Pre-Meeting Brief):**
    - Função `generateCloserBrief(soulId: string, leadContact: string)` que consulta o histórico de reuniões, e-mails e mensagens do WhatsApp no banco vetorial e gera uma ficha consolidada com contexto, objeções anteriores e estratégia sugerida para o closer.

---

### 3. Exposição de Novas Ferramentas no MCP Server
- **Arquivo:** `packages/tools/src/index.ts`
- **Requisitos:**
  - Adicionar as seguintes MCP Tools tipadas:
    - `sales_ingest_meeting(soulId: string, transcriptContent: string, format: 'vtt' | 'srt' | 'txt')`
    - `sales_get_lead_brief(soulId: string, leadContact: string)`
    - `soul_record_lesson(soulId: string, topic: string, mistakeOrFeedback: string, correctBehavior: string)`
  - Integrar com a camada de autorização `authorizeTool` e registrar a trilha de auditoria ISO/IEC 42001 (`audit-trail.ts`).

---

### 4. Telemetria e FinOps de Execução
- **Requisitos:**
  - Garantir que toda extração de reunião e pipeline de inteligência capture métricas de tokens (`usage_metadata`: `prompt_tokens`, `completion_tokens`, `latency_ms`).
  - Anexar as métricas de telemetria no rodapé do Markdown da sessão correspondente.

---

## 🛡️ DIRETRIZES DE ENGENHARIA
1. **TypeScript First:** Utilizar apenas APIs nativas (`node:fs/promises`, `node:path`, `fetch`) e as dependências já configuradas no monorepo (`@langchain/*`, `pg`, `zod`).
2. **Resiliência e Fallback:** Falhas no Ollama ou no PostgreSQL não devem travar o processo nem impedir a escrita do arquivo Markdown em disco.
3. **Validação:** Crie testes unitários em `packages/daemon/src/test/meeting-ingest.test.ts` cobrindo o parsing de transcrições e a geração do resumo estruturado.

Apresente o log de arquivos criados/alterados, diffs das modificações e o resultado de `pnpm build` ou `tsc --noEmit`.