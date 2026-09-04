# Onda 3e — Split do God-Object `chat.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quebrar `packages/daemon/src/routes/chat.ts` (1177 linhas — 3 responsabilidades de rota + pipeline de preparação de prompt + fallback degradado, todos no mesmo arquivo) em módulos menores e focados, **sem mudar nenhum comportamento observável** — puro reposicionamento de código, guiado pelo compilador.

**Architecture:** As 3 rotas (`GET /buffer`, `POST /chat`, `GET /langgraph/status|history`) viram 3 arquivos independentes em `packages/daemon/src/routes/chat/`. O pipeline de preparação de prompt (`preparePromptContext`/`ollamaChat`/`ollamaChatStream`, hoje consumido também por `routes/stream.ts`) vira um módulo neutro `packages/daemon/src/promptPipeline.ts` — assim `chat.ts` e `stream.ts` passam a depender dos dois de um módulo compartilhado, em vez de `stream.ts` depender de `chat.ts` (uma "rota" dependendo de outra "rota", hoje). `chat.ts` vira um dispatcher fino (~30 linhas) que só importa e encaminha. Esta fase **não** decompõe o corpo interno do handler de `POST /chat` (~455 linhas, 17 variáveis locais compartilhadas entre fases sequenciais) — isso é risco maior, fica pra uma Fase 2 opcional depois desta prova de conceito mais segura estar validada.

**Tech Stack:** TypeScript, `node:test`. Técnica principal: mover código verbatim, rodar `tsc -b`, deixar o compilador apontar import faltando/sobrando, repetir até limpo — não é adivinhação manual de quais dos ~50 imports do topo do arquivo cada função usa.

**Spec:** `docs/ROADMAP.md` (item "Onda 3e — quebrar god-objects"), relatório de análise estrutural desta sessão (2026-09-04).

## Global Constraints

- **Zero mudança de comportamento.** Todo teste que passa hoje precisa passar depois, sem editar nenhum teste (exceto import paths, se necessário).
- A API pública do pacote (o que `packages/daemon/src/index.ts`/outros pacotes importam de `@assistente-os/daemon`) não muda.
- `packages/daemon/src/routes/stream.ts` importa hoje `{ preparePromptContext, ollamaChatStream, type ExecUsage }` de `./chat.js` — **manter esse import funcionando sem editar `stream.ts`** (re-export a partir de `chat.ts`), a menos que um task específico decida migrar o import diretamente (opcional, ver Task 5).
- Build sempre antes de test: `npm run build --workspace=packages/daemon` antes de `node --test dist/test/**/*.test.js`.

---

## Contexto: estrutura atual (não repetir investigação)

`packages/daemon/src/routes/chat.ts`, 1177 linhas:

| Range | Nome | O que é |
|---|---|---|
| 1-57 | imports | ~50 símbolos de `@assistente-os/core`, `@assistente-os/memory`, módulos locais |
| 58-69 | `ExecUsage` (exportada), `OllamaPrefill` | DTOs de uso de token |
| 71-155 | `ollamaChat` (privada) | chamada não-streaming ao Ollama |
| 166-279 | `ollamaChatStream` (exportada) | chamada streaming ao Ollama, com `AbortSignal` (BUG-01) |
| 281-297 | `PreparedPromptContext`, `PreparePromptContextResult` (exportadas) | tipos de retorno de `preparePromptContext` |
| 307-566 | `preparePromptContext` (exportada) | pipeline: teto diário → sessão → sanitização → injection screening → histórico → RAG/buildPrompt |
| 582-643 | `handleChatDegraded` (privada) | SPEC-HR1: fallback Markdown-only quando Postgres está fora |
| 646-1177 | `handleChat` (exportada) | dispatcher das 3 rotas — ver abaixo |

Dentro de `handleChat`:
- **655-675**: `GET /buffer` — autocontido.
- **677-1131**: `POST /chat` (o grosso, ~455 linhas) — 17 variáveis locais (`session`, `dailyLimit`, `spentToday`, `maxTurns`, `promptSanitized`, `history`, `built`, `traceId`, `traceStartedAt`, `emitStep`, `decision`, `model`, `tier`, `result`, `execUsage`, `startedAt`, `orchDecision`) fluem por: roteamento → execução (3 branches: ollama/langgraph/opencode) → escalonamento → persistência de custo → métricas → resposta. `finally { purgeCredentials(...) }` envolve 746-1131.
- **1136-1174**: `GET /langgraph/status` e `GET /langgraph/history` — autocontidas, fazem `import()` dinâmico próprio de `loadConfig`/`getSoul`/`probeLangGraph` (não usa os imports já feitos no topo do arquivo — preservar esse padrão ao mover, não "consertar" isso agora, é fora de escopo).

Testes que já cobrem este arquivo (não recriar — só rodar): `prepare-prompt-context-sink.test.ts`, `ollama-chat-stream.test.ts`, `spec-hr1-db-degraded.test.ts`, `spec-hr2-purge-credentials.test.ts`, `rag-injection-chat.test.ts`, `daemon.test.ts`, `stream-routes.test.ts` (49KB — cobertura indireta forte de `preparePromptContext`/`ollamaChatStream` via `/stream`). **Não tem teste direto** pra `GET /langgraph/status|history` — tratar como "sem rede de segurança automatizada", dobrar o cuidado ao mover esse trecho (comparar a resposta manualmente antes/depois, ver Task 4).

---

### Task 1: Extrair `promptPipeline.ts` (o módulo compartilhado com `stream.ts`)

**Files:**
- Create: `packages/daemon/src/promptPipeline.ts`
- Modify: `packages/daemon/src/routes/chat.ts` (remove o que foi movido, adiciona re-export)
- Test: nenhum novo — suíte existente é a rede de segurança

**Interfaces:**
- Produces: `promptPipeline.ts` exporta exatamente o que `chat.ts` exportava antes: `ExecUsage`, `ollamaChatStream`, `PreparedPromptContext`, `PreparePromptContextResult`, `preparePromptContext`. `ollamaChat` e `handleChatDegraded` continuam não-exportadas do pacote, mas precisam ser exportadas *do módulo* `promptPipeline.ts` (sem `export` do pacote — só entre arquivos internos) já que `chat.ts` ainda as usa.
- Consumes: nada de `chat.ts` — este módulo deve conseguir ficar de pé sozinho.

- [ ] **Step 1: Rodar a suíte inteira do daemon ANTES de mexer em nada, guardar o resultado como baseline**

Run: `npm run build --workspace=packages/daemon && npm test --workspace=packages/daemon 2>&1 | tail -20`
Expected: anotar quantos testes passam agora (ex.: "216 pass, 0 fail" ou a flake conhecida de Postgres) — é o que "sem regressão" significa daqui pra frente neste plano.

- [ ] **Step 2: Criar `promptPipeline.ts` com os imports completos do topo de `chat.ts` (super-set — o compilador aponta o excesso no Step 4)**

Copiar o bloco de imports inteiro de `packages/daemon/src/routes/chat.ts` (linhas 1-57) pro novo arquivo `packages/daemon/src/promptPipeline.ts`. Ajustar caminhos relativos: tudo que `chat.ts` importa com `./` ou `../` a partir de `routes/` precisa de um `../` a mais a partir de `promptPipeline.ts` (que fica um nível acima, em `src/` direto, não em `src/routes/`). Ex.: `from "./shared.js"` em `chat.ts` vira `from "./routes/shared.js"` em `promptPipeline.ts`; `from "../context.js"` vira `from "./context.js"`.

- [ ] **Step 3: Mover o código (corta de `chat.ts`, cola em `promptPipeline.ts`, nesta ordem)**

Do `chat.ts` original, mover pra `promptPipeline.ts`, na mesma ordem em que aparecem: `OllamaPrefill` (interface, não-exportada), `ExecUsage` (exportada), `ollamaChat` (função, não-exportada — mas sem `export` já que só é usada dentro deste módulo agora, por `handleChatDegraded` que também está migrando), `ollamaChatStream` (exportada), `PreparedPromptContext`/`PreparePromptContextResult` (exportadas), `preparePromptContext` (exportada), `handleChatDegraded` (função — **exportar** agora, `export function handleChatDegraded(...)`, porque `chat.ts` vai precisar chamá-la de fora do módulo).

- [ ] **Step 4: Build, corrigir imports guiado pelo compilador — em `promptPipeline.ts`**

Run: `npm run build --workspace=packages/daemon 2>&1 | head -60`
Expected: erros de "cannot find name X" para símbolos que o código movido usa mas o import copiado não cobre (improvável, já que o Step 2 copiou tudo) — mais provável é erros do lado de `chat.ts` (Step 5). Se houver erro aqui, adicionar o import faltando e rodar de novo até limpo neste arquivo.

- [ ] **Step 5: Corrigir `chat.ts` — remover o código movido, importar de `promptPipeline.ts`, re-exportar pro `stream.ts` continuar funcionando**

No topo de `chat.ts`, depois dos imports que sobrarem (o compilador vai apontar quais ficaram sem uso — remover esses), adicionar:

```ts
export { ollamaChatStream, preparePromptContext, type ExecUsage, type PreparedPromptContext, type PreparePromptContextResult } from "../promptPipeline.js";
import { ollamaChat, handleChatDegraded } from "../promptPipeline.js";
```

(o `export { ... } from` é o que mantém `stream.ts` funcionando sem tocar nele — ele importa de `./chat.js`, que agora repassa pra `../promptPipeline.js`.)

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/daemon 2>&1 | head -80`
Expected: repetir "adicionar import faltando / remover import sobrando" em `chat.ts` e `promptPipeline.ts` até o build passar limpo nos dois arquivos.

- [ ] **Step 7: Rodar a suíte inteira, comparar com o baseline do Step 1**

Run: `npm test --workspace=packages/daemon 2>&1 | tail -20`
Expected: mesmo resultado do Step 1 (mesma contagem de pass/fail) — nenhuma regressão.

- [ ] **Step 8: Commit**

```bash
git add packages/daemon/src/promptPipeline.ts packages/daemon/src/routes/chat.ts
git commit -m "refactor(daemon): extrai promptPipeline.ts de chat.ts

preparePromptContext/ollamaChat/ollamaChatStream/handleChatDegraded viram um
módulo neutro compartilhado — antes stream.ts dependia de chat.ts (uma rota
dependendo de outra), agora os dois dependem de promptPipeline.ts. chat.ts
reexporta os símbolos públicos para stream.ts continuar funcionando sem editar
seu import. Puro reposicionamento — zero mudança de comportamento, suíte
completa idêntica antes/depois.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extrair `GET /buffer` pra `chat/buffer.ts`

**Files:**
- Create: `packages/daemon/src/routes/chat/buffer.ts`
- Modify: `packages/daemon/src/routes/chat.ts`
- Test: nenhum novo — `daemon.test.ts` já cobre `GET /buffer` (confirmar antes: `grep -n "buffer" packages/daemon/src/test/daemon.test.ts`)

**Interfaces:**
- Produces: `export async function handleChatBuffer(req: IncomingMessage, res: ServerResponse, url: URL, path: string, context: RequestContext): Promise<boolean>` — mesma assinatura que `handleChat` já usa pros seus sub-blocos, retorna `true` se a rota bateu e foi tratada, `false` senão.
- Consumes: `RequestContext` de `./shared.js`

- [ ] **Step 1: Confirmar a assinatura exata de `handleChat` e o tipo `RequestContext` antes de replicar**

Run: `grep -n "export async function handleChat\|interface RequestContext" packages/daemon/src/routes/chat.ts packages/daemon/src/routes/shared.ts`
Expected: confirma os 5 parâmetros e o shape de `RequestContext` (`home`, `run`, `hub`, `webDir`, etc. — usar exatamente os campos que o bloco `GET /buffer` de fato lê, não todos).

- [ ] **Step 2: Criar `chat/buffer.ts` com o corpo movido**

Mover as linhas 655-675 de `chat.ts` (o bloco `GET /buffer`) pra dentro de uma função exportada em `packages/daemon/src/routes/chat/buffer.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSoul, loadConfig } from "@assistente-os/core";
import { buildPrompt } from "../../context.js";
import { sendJson, type RequestContext } from "../shared.js";

export async function handleChatBuffer(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;
  const bufferMatch = path.match(/^\/souls\/([^/]+)\/buffer$/);
  if (!bufferMatch || req.method !== "GET") return false;
  const soul = getSoul(home, decodeURIComponent(bufferMatch[1]!));
  if (!soul) {
    sendJson(res, 404, { error: "soul não encontrada" });
    return true;
  }
  const config = loadConfig({ home });
  const prompt = url.searchParams.get("prompt") ?? "";
  const built = await buildPrompt({ home, soul, prompt, config, withRag: prompt.trim().length > 0 });
  sendJson(res, 200, {
    soul: soul.id,
    builtAt: new Date().toISOString(),
    files: built.files,
    contextChars: built.contextChars,
    tokenEstimate: Math.ceil(built.contextChars / 4),
    ragVerdict: built.verdict,
    systemPrompt: built.fullPrompt,
  });
  return true;
}
```

(ajustar os imports exatos conforme o Step 1 confirmar — este é o esqueleto baseado no código original lido nesta sessão, mas reconferir contra o arquivo real antes de colar, o código pode ter mudado.)

- [ ] **Step 3: Em `chat.ts`, trocar o bloco original por uma chamada delegada**

Remover as linhas do bloco `GET /buffer` de dentro de `handleChat`, e no início do corpo de `handleChat` adicionar:

```ts
  if (await handleChatBuffer(req, res, url, path, context)) return true;
```

Adicionar o import: `import { handleChatBuffer } from "./chat/buffer.js";`

- [ ] **Step 4: Build, iterar até limpo**

Run: `npm run build --workspace=packages/daemon 2>&1 | head -60`
Expected: ajustar imports faltando/sobrando nos dois arquivos até limpo.

- [ ] **Step 5: Rodar a suíte inteira, comparar com o baseline (Task 1 Step 1)**

Run: `npm test --workspace=packages/daemon 2>&1 | tail -20`
Expected: mesma contagem.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/routes/chat/buffer.ts packages/daemon/src/routes/chat.ts
git commit -m "refactor(daemon): extrai GET /buffer pra routes/chat/buffer.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extrair `POST /chat` pra `chat/postChat.ts` (movido verbatim — sem decompor as 17 variáveis compartilhadas)

**Files:**
- Create: `packages/daemon/src/routes/chat/postChat.ts`
- Modify: `packages/daemon/src/routes/chat.ts`
- Test: nenhum novo — `daemon.test.ts`, `spec-hr1-db-degraded.test.ts`, `spec-hr2-purge-credentials.test.ts`, `rag-injection-chat.test.ts` já cobrem este caminho

**Interfaces:**
- Produces: `export async function handlePostChat(req, res, url, path, context): Promise<boolean>` — mesmo contrato de `handleChatBuffer`.
- Consumes: `preparePromptContext`, `ollamaChatStream`, `handleChatDegraded` de `../../promptPipeline.js` (Task 1); tudo que o bloco `POST /chat` original já importava do topo de `chat.ts`.

**Este é o task de maior risco do plano** — 455 linhas movidas de uma vez, 17 variáveis locais interdependentes. A mitigação é: **mover tudo, não reescrever nada** — o corpo da função fica byte-a-byte idêntico ao que já está em produção, só muda de arquivo. Nenhuma refatoração interna nesta task.

- [ ] **Step 1: Ler o bloco `POST /chat` inteiro (linhas 677-1131 do `chat.ts` original) antes de mover — confirmar as linhas exatas no arquivo atual (podem ter deslocado depois das Tasks 1-2)**

Run: `grep -n 'chatMatch = path.match\|^  }$' packages/daemon/src/routes/chat.ts | head -20`

Usar isso pra achar o início (`const chatMatch = path.match(/^\/souls\/...\/chat\$/);`) e o fim (o `}` que fecha o `if (chatMatch && req.method === "POST")`) exatos no arquivo já modificado pelas Tasks 1-2.

- [ ] **Step 2: Criar `chat/postChat.ts`, colar o bloco inteiro dentro de uma função exportada**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
// ... (colar aqui TODOS os imports que o bloco POST /chat usa — deixar o
// compilador apontar no Step 4 em vez de tentar listar de memória; começar
// com uma cópia completa do que sobrou no topo de chat.ts depois da Task 1
// e deixar o tsc reclamar do que falta, é mais confiável que rastrear à mão
// 455 linhas.)

export async function handlePostChat(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub } = context;
  const chatMatch = path.match(/^\/souls\/([^/]+)\/chat$/);
  if (!chatMatch || req.method !== "POST") return false;
  // ... corpo colado verbatim do bloco original ...
  return true;
}
```

(o corpo real vem do `chat.ts` atual, lido no Step 1 — colar exatamente, sem reescrever nenhuma linha de lógica.)

- [ ] **Step 3: Em `chat.ts`, remover o bloco original, delegar**

```ts
  if (await handlePostChat(req, res, url, path, context)) return true;
```

Adicionar: `import { handlePostChat } from "./chat/postChat.js";`

- [ ] **Step 4: Build, iterar até limpo (vai levar mais de uma rodada — bloco grande)**

Run: `npm run build --workspace=packages/daemon 2>&1 | head -100`
Expected: várias rodadas de "adicionar import X que faltou" até compilar limpo. Não pular nenhum erro — cada um é um símbolo que o bloco de fato usa.

- [ ] **Step 5: Rodar a suíte inteira, comparar com o baseline**

Run: `npm test --workspace=packages/daemon 2>&1 | tail -30`
Expected: mesma contagem de pass/fail do baseline (Task 1 Step 1). **Se qualquer teste novo falhar aqui, não prosseguir** — investigar com `superpowers:systematic-debugging` antes de continuar (não é esperado, já que o corpo foi movido verbatim, mas parar e investigar é mais barato que seguir com uma regressão silenciosa).

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/routes/chat/postChat.ts packages/daemon/src/routes/chat.ts
git commit -m "refactor(daemon): extrai POST /chat pra routes/chat/postChat.ts

Movido verbatim — as 17 variáveis locais que a rota compartilha entre suas
fases (roteamento, execução, escalonamento, persistência) continuam dentro
da mesma função, sem decompor. Decompor o corpo interno fica pra uma fase
futura opcional, depois desta extração mais segura estar validada.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Extrair `GET /langgraph/status|history` pra `chat/langgraphStatus.ts`

**Files:**
- Create: `packages/daemon/src/routes/chat/langgraphStatus.ts`
- Modify: `packages/daemon/src/routes/chat.ts`
- Test: **nenhum teste automatizado cobre este bloco hoje** (confirmado na investigação) — escrever um smoke test antes de mover, já que não há rede de segurança

**Interfaces:**
- Produces: `export async function handleChatLanggraphStatus(req, res, url, path, context): Promise<boolean>`

- [ ] **Step 1: Escrever um smoke test primeiro (não existe nenhum hoje pra este bloco)**

Criar `packages/daemon/src/test/langgraph-status-route.test.ts` (seguir o padrão de setup de `daemon.test.ts` — `startDaemon`, `ADMIN_TOKEN`, soul temporária):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";

const ADMIN_TOKEN = "admin-test-token";

test("GET /souls/:id/langgraph/status responde sem lançar (smoke test — sem cobertura automatizada antes desta task)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-lgstatus-"));
  createSoul(home, "soul-lg-status", { name: "soul-lg-status" });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/soul-lg-status/langgraph/status`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    // Não afirma um status specific — o objetivo é provar que a rota
    // responde (não 404, não crash) antes/depois do reposicionamento.
    assert.notEqual(res.status, 404);
  } finally {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar, confirmar que passa (baseline — antes de mover)**

Run: `npm run build --workspace=packages/daemon && node --test dist/test/langgraph-status-route.test.js`
Expected: PASS — este é o comportamento a preservar.

- [ ] **Step 3: Mover o bloco (linhas ~1136-1174 do `chat.ts` atual — reconferir número exato depois das Tasks 1-3) pra `chat/langgraphStatus.ts`**

Preservar o padrão de `import()` dinâmico que o bloco original já usa (não trocar por import estático — isso é um detalhe de comportamento existente, mudar é fora de escopo deste plano).

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../shared.js";

export async function handleChatLanggraphStatus(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;
  const lgSoulMatch = path.match(/^\/souls\/([^/]+)\/langgraph\//);
  if (!lgSoulMatch) return false;
  // ... corpo colado verbatim, incluindo os import() dinâmicos originais ...
  return false; // preservar o fallthrough original se nenhum dos dois sub-caminhos bater
}
```

- [ ] **Step 4: Em `chat.ts`, delegar**

```ts
  if (await handleChatLanggraphStatus(req, res, url, path, context)) return true;
```

- [ ] **Step 5: Build, iterar até limpo**

Run: `npm run build --workspace=packages/daemon 2>&1 | head -60`

- [ ] **Step 6: Rodar o smoke test novo + a suíte inteira**

Run: `node --test dist/test/langgraph-status-route.test.js && npm test --workspace=packages/daemon 2>&1 | tail -20`
Expected: smoke test PASS, suíte completa com a mesma contagem do baseline (agora +1 teste novo, que deve passar).

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/routes/chat/langgraphStatus.ts packages/daemon/src/routes/chat.ts packages/daemon/src/test/langgraph-status-route.test.ts
git commit -m "refactor(daemon): extrai GET /langgraph/status|history pra routes/chat/langgraphStatus.ts

Sem cobertura automatizada antes desta task — adiciona smoke test primeiro
(prova que a rota responde, não 404/crash) como rede de segurança mínima
antes do reposicionamento.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação final — `chat.ts` virou um dispatcher fino

**Files:** nenhum arquivo novo — só verificação e limpeza final

- [ ] **Step 1: Confirmar o tamanho final de `chat.ts`**

Run: `wc -l packages/daemon/src/routes/chat.ts`
Expected: algo na faixa de 25-40 linhas (imports dos 3 sub-handlers + `export async function handleChat` que só encadeia os 3 `if`s + o re-export do `promptPipeline.ts` pra `stream.ts`).

- [ ] **Step 2: Build completo do monorepo (chat.ts é consumido por outros pacotes via `@assistente-os/daemon`)**

Run: `npm run build`
Expected: todos os workspaces compilam limpo.

- [ ] **Step 3: Suíte completa do daemon, comparação final com o baseline original (Task 1 Step 1)**

Run: `npm test --workspace=packages/daemon 2>&1 | tail -30`
Expected: mesma contagem de pass + os 2 testes novos que este plano adicionou (Task 3, se algum smoke extra foi criado lá — checar; Task 4's smoke test). Zero regressão.

- [ ] **Step 4: Confirmar que `stream.ts` não precisou de nenhuma edição**

Run: `git diff --stat packages/daemon/src/routes/stream.ts`
Expected: vazio — nenhuma mudança neste arquivo em todo o plano (prova que o re-export do Task 1 funcionou como pretendido).

- [ ] **Step 5 (opcional, avaliar com o usuário antes): migrar o import de `stream.ts` diretamente pra `promptPipeline.ts`**

Só fazer se o usuário confirmar que quer — não é necessário pro objetivo do plano (o re-export já funciona), é só remover uma camada de indireção. Se decidir fazer: trocar `from "./chat.js"` por `from "../promptPipeline.js"` em `stream.ts`, rodar `npm run build --workspace=packages/daemon && npm test --workspace=packages/daemon`, confirmar mesma contagem, e então (só então) remover o `export { ... } from "../promptPipeline.js"` de `chat.ts` que ficaria sem uso.

- [ ] **Step 6: Atualizar `docs/ROADMAP.md`**

Marcar a metade "chat.ts" de "Onda 3e" como concluída (Fase 1 — sem decompor o corpo interno de `postChat.ts`), com nota apontando a Fase 2 opcional (decompor as 17 variáveis compartilhadas de `handlePostChat` em fases explícitas com um objeto de contexto) como trabalho futuro, não perdido.
