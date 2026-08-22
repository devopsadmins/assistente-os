# TASK: Implementação do Browser Harness com CDP e Autoaperfeiçoamento (assistente-os)

Você é o Engenheiro Sênior de Software e Arquiteto responsável pelo monorepo TypeScript `assistente-os`.
Saia do modo de planejamento e execute a implementação no modo de construção (**Build Mode**), respeitando a arquitetura **Local-First** (Markdown puro como fonte canônica da verdade, PostgreSQL/pgvector como índice derivado, `npm workspaces` e tipagem estrita em TypeScript).

---

## 🎯 ESCOPO DE IMPLEMENTAÇÃO

### 1. Refatoração do Browser Automation Engine com CDP e Acessibilidade
- **Arquivo:** `packages/daemon/src/tools/browser.ts`
- **Requisitos:**
  - Evoluir a classe `BrowserEngine` para expor conexão direta via **Chrome DevTools Protocol (CDP)** através de `CDPSession` (WebSocket nativo do Chromium/Playwright).
  - Implementar método `getAccessibilityTree(taskId?: string)` que extrai a hierarquia de acessibilidade (`AccessibilityNode`) da página, permitindo navegação semântica resiliente a variações de classes CSS, IDs ofuscados ou renderizações dinâmicas.
  - Implementar método `captureAuditedScreenshot(taskId?: string, metadata?: Record<string, unknown>)`:
    - Capturar screenshot da página com timestamp, hash SHA-256 e metadata anexada para auditoria/relatórios.
    - Salvar o arquivo no diretório temporário/audit da sessão e retornar base64 ou caminho local.

---

### 2. Autoaperfeiçoamento & Injeção de Scripts Utilitários (Agentic Helpers)
- **Arquivo:** `packages/daemon/src/tools/browser.ts`
- **Requisitos:**
  - Implementar método `executeDynamicFix(taskId: string, scriptContent: string, reason: string)`:
    - Permitir que o agente injete trechos de JavaScript para destravar obstáculos de página (ex.: remoção de overlays invisíveis, desbloqueio de `z-index`, fechar popups abusivos ou scroll forçado).
    - Executar o script em sandbox com tratamento estrito de exceção (`try/catch`), retornando `{ ok: boolean, data?: unknown, error?: string }` sem quebrar o processo do daemon.
  - Armazenar helpers reutilizáveis e scripts validados na workspace em `~/.assistant-os/souls/<soulId>/tools_cache/browser_helpers.json`.

---

### 3. Integração com o 4º Loop de Lições (lessons.md)
- **Arquivo:** `packages/daemon/src/orchestrator/sales-intelligence.ts` ou `packages/core/src/governance/audit-trail.ts`
- **Requisitos:**
  - Quando um script de autoaperfeiçoamento (`executeDynamicFix`) resolver com sucesso uma falha de navegação em um determinado domínio (ex.: `youtube.com`, `linkedin.com`, `painel-cliente.com`):
    - Registrar automaticamente a estratégia e o snippet JavaScript de resolução no arquivo `~/.assistant-os/souls/<soulId>/lessons.md`.
    - Sincronizar o novo fragmento com o índice semântico (`packages/memory`).

---

### 4. Atualização e Exposição de Novas MCP Tools
- **Arquivo:** `packages/tools/src/index.ts`
- **Requisitos:**
  - Adicionar e tipar as novas MCP Tools no array `TOOLS` e tratá-las no `executeTool`:
    - `browser_get_accessibility_tree(taskId?: string)`: Retorna a árvore semântica de acessibilidade da aba ativa.
    - `browser_execute_fix(taskId: string, scriptContent: string, reason: string)`: Executa injeção dinâmica de JavaScript para contornar bloqueios.
    - `browser_audited_screenshot(taskId?: string, fullPage?: boolean)`: Captura print com metadados para relatórios e auditoria.
  - Garantir validação com `authorizeTool(soulId, toolName)` e registro no `audit-trail.ts` (ISO/IEC 42001).

---

## 🛡️ DIRETRIZES DE ENGENHARIA
1. **TypeScript First & Zero Heavy Deps:** Utilizar `playwright-core` já mapeado no `packages/daemon/package.json` e APIs nativas do Node (`node:fs/promises`, `node:path`, `node:crypto`).
2. **Resiliência e Degradação Graciosa:** Erros de injeção ou falha no WebSocket do CDP devem retornar `{ ok: false, error: ... }` em vez de gerar crashes não tratados.
3. **Validação e Testes:** Criar testes unitários em `packages/daemon/src/test/browser.test.ts` cobrindo o fallback de erro de injeção e a serialização da árvore de acessibilidade.

Apresente o log de arquivos criados/alterados, diffs das modificações e o resultado de `npm run build --workspaces` e `npm test --workspaces`.