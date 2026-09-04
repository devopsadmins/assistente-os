# Web Thread Screen (packages/web, primeira fatia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `packages/web` — um app Vite+React novo que renderiza uma `ThreadScreen` real, ligada ao endpoint de streaming SSE de verdade (`POST /souls/:id/threads/:threadId/messages/stream`), pra um usuário abrir uma thread e ver a resposta do assistente chegando token a token.

**Architecture:** Pacote novo no workspace (`packages/web`), sem router — uma tela só (`ThreadScreen`), autenticação e soul fixas via `.env.local` (sem `AuthScreen`/`SoulListScreen`/`SettingsScreen` ainda). Consome `@assistente-os/ui` (já mergeado, PR #28) pros componentes visuais e as rotas REST/SSE do daemon (já mergeadas, PR #30/#32) via um client HTTP próprio (`api/client.ts` + `api/stream.ts`, `fetch`+`ReadableStream` — não `EventSource`, porque a rota exige `POST` com header `Authorization`, que `EventSource` não suporta). Dev server do Vite faz proxy de `/souls/*` pro daemon local, evitando CORS sem mexer no daemon.

**Tech Stack:** Vite 6, React 19, TypeScript 5.6 (mesmas versões já usadas em `packages/ui`), Tailwind 3 (via `@assistente-os/ui/tailwind-preset`), Vitest 2 + Testing Library (mesmo padrão de `packages/ui`).

**Spec:** `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md` (arquitetura geral do sub-projeto B — este plano implementa só a primeira fatia, escopada em brainstorming nesta sessão: ver Global Constraints).

## Global Constraints

- Pacote novo `packages/web`: Vite + React 19 + TypeScript, `@assistente-os/ui` como dependência de workspace.
- **Sem router.** Só a `ThreadScreen` existe nesta fatia — sem `AuthScreen`, `SoulListScreen` ou `SettingsScreen`.
- Autenticação e soul fixas via `.env.local` (nunca commitado — `.env`/`.env.local` já estão no `.gitignore` da raiz): `VITE_DEV_TOKEN` (bate com `ASSISTENTE_OS_DAEMON_TOKEN` do daemon) e `VITE_DEV_SOUL_ID`. Sem tela de login, sem seletor de souls.
- Layout: sidebar clássica (lista de threads sempre visível à esquerda + botão "+ Nova thread") + área de chat à direita — decidido via brainstorming visual nesta sessão (opção A, contra uma alternativa sem sidebar).
- `StreamingText` (já existe em `@assistente-os/ui`) mostra o cursor piscando via CSS **sempre que está montado** — não tem prop de "terminou". Uma mensagem em streaming deve trocar de `<StreamingText chunks={...}/>` pra `<Markdown source={...}/>` assim que o evento `done` chegar, senão o cursor pisca pra sempre numa mensagem já completa.
- Erros (rede/daemon fora do ar, 401/403/404, erro no meio do stream, 429 de limite de turnos — limitação conhecida e documentada da PR #32) sempre viram mensagem visível na tela, nunca falha silenciosa.
- Testes: sem mocks de módulo (`vi.mock`) — sempre um servidor HTTP local de verdade (`node:http`), mesmo padrão usado em todo o resto deste projeto (ex.: `ollamaChatStream`'s tests fakeando o Ollama com um `http.createServer` real).
- Verificação final (Task 5): rodar `npm run dev` de verdade, abrir no navegador, mandar uma mensagem real contra o daemon + Ollama locais, confirmar visualmente que os tokens chegam progressivamente.

---

### Task 1: Scaffold do packages/web

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/vitest.setup.ts`
- Create: `packages/web/postcss.config.cjs`
- Create: `packages/web/tailwind.config.cjs`
- Create: `packages/web/index.html`
- Create: `packages/web/src/index.css`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/.env.example`
- Test: `packages/web/src/App.test.tsx`

**Interfaces:**
- Produces: o pacote `@assistente-os/web` existe no workspace, `npm run dev`/`build`/`test`/`typecheck` funcionam a partir da raiz do repo (`npm run build --workspaces` já roda todos). `App` (default export de `src/App.tsx`) é o componente raiz — Task 5 substitui seu conteúdo pela `ThreadScreen` real.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "@assistente-os/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "preview": "vite preview"
  },
  "dependencies": {
    "@assistente-os/ui": "*",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.1.0",
    "@testing-library/user-event": "14.5.2",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.1",
    "@vitejs/plugin-react": "4.3.4",
    "autoprefixer": "10.4.20",
    "jsdom": "25.0.1",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.15",
    "typescript": "5.6.3",
    "vite": "6.0.5",
    "vitest": "2.1.5"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

Mesma base de `packages/ui/tsconfig.json` (app de browser — não estende `tsconfig.base.json` da raiz, que é `moduleResolution: NodeNext` pra pacotes Node como `core`/`daemon`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "vitest.config.ts", "vitest.setup.ts"]
}
```

- [ ] **Step 3: Criar `vite.config.ts`**

`VITE_DAEMON_URL` só é lido aqui (server-side, tempo de config do dev server) pra apontar o proxy — o client HTTP (`api/client.ts`, Task 2) sempre usa caminho relativo (`""` de base), então toda requisição do browser vai pro próprio Vite, que repassa pro daemon real. Isso evita precisar de CORS no daemon.

```ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const daemonUrl = env.VITE_DAEMON_URL || "http://localhost:4310";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/souls": { target: daemonUrl, changeOrigin: true },
      },
    },
  };
});
```

- [ ] **Step 4: Criar `postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Criar `tailwind.config.cjs`**

Estende o preset de `@assistente-os/ui` (mesmo padrão documentado no cabeçalho de `packages/ui/tailwind-preset.cjs`) e escaneia tanto o código deste pacote quanto o código-fonte do `@assistente-os/ui` (que não é pré-compilado — é consumido como TS puro, ver `packages/ui/package.json`'s `exports`), senão as classes usadas dentro dos componentes da UI não geram CSS.

```js
module.exports = {
  presets: [require("@assistente-os/ui/tailwind-preset")],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./node_modules/@assistente-os/ui/src/**/*.{ts,tsx}"],
};
```

- [ ] **Step 6: Criar `index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>assistente-os</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Criar `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import "@assistente-os/ui/tokens.css";
```

- [ ] **Step 8: Criar `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("elemento #root não encontrado");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Escrever o teste que falha (`src/App.test.tsx`)**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renderiza o placeholder do scaffold usando o Message do @assistente-os/ui", () => {
    render(<App />);
    expect(screen.getByText(/packages\/web está de pé/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Criar `vitest.config.ts` e `vitest.setup.ts`** (necessários pro teste do Step 9 rodar)

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Mesmo motivo do timeout alto em packages/ui/vitest.config.ts: layout
    // síncrono de componentes Radix (usados por @assistente-os/ui) pode
    // estourar o default de 5s sob contenção de CPU.
    testTimeout: 60000,
  },
});
```

`vitest.setup.ts` — cópia literal de `packages/ui/vitest.setup.ts` (mesmos polyfills de jsdom pros primitivos Radix que `@assistente-os/ui` usa por baixo — `MessageList`, por exemplo, envolve `ScrollArea`; sem isso, testes que renderizam componentes de `@assistente-os/ui` nas próximas tasks travam do mesmo jeito documentado lá):

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

if (typeof window !== "undefined") {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }

  if (typeof window.PointerEvent === "undefined") {
    class PointerEventStub extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
      }
    }
    window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 11: Rodar `npm install` a partir da raiz do repo**

Run: `cd /home/support/assistente-os/.claude/worktrees/web-thread-screen && npm install`
Expected: instala e linka `@assistente-os/web` como novo workspace, resolve `@assistente-os/ui: "*"` pro pacote local via symlink.

- [ ] **Step 12: Rodar o teste, confirmar que falha**

Run: `cd packages/web && npx vitest run`
Expected: FAIL — `src/App.tsx` ainda não existe (erro de import/módulo não encontrado).

- [ ] **Step 13: Criar `src/App.tsx`**

```tsx
import { Message } from "@assistente-os/ui";

export function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <Message role="assistant">packages/web está de pé 👋</Message>
    </div>
  );
}
```

- [ ] **Step 14: Rodar o teste, confirmar que passa**

Run: `npx vitest run`
Expected: PASS — 1 teste.

- [ ] **Step 15: Confirmar que o build inteiro funciona (Tailwind + resolução do pacote de workspace)**

Run: `npm run build` (dentro de `packages/web`)
Expected: `tsc --noEmit` limpo, `vite build` gera `dist/` sem erros — isso prova que o Tailwind está de fato extraindo classes de dentro de `@assistente-os/ui` (a bolha do `Message` deve ter as classes `bg-chat-assistant`/`rounded-lg` etc. aplicadas, não cruas sem estilo).

- [ ] **Step 16: Confirmar visualmente com o dev server**

Run: `npm run dev` (dentro de `packages/web`), abrir a URL impressa no navegador.
Expected: uma bolha de chat estilizada (cor de fundo, cantos arredondados, o token piscando NÃO deveria aparecer aqui — `Message` sozinho não usa `StreamingText`) com o texto "packages/web está de pé 👋". Se aparecer sem nenhum estilo (texto cru, sem cor de fundo/padding), o Tailwind não está extraindo classes de `@assistente-os/ui` — revisar o `content` do Step 5 antes de prosseguir.

- [ ] **Step 17: Criar `.env.example`** (documentação — `.env`/`.env.local` já estão no `.gitignore` da raiz)

```
# Copie para .env.local (nunca commitado) e preencha com valores reais.

# URL do daemon local, usada só no vite.config.ts pra configurar o proxy de
# dev (/souls/* -> este daemon) — nunca exposta ao código do browser.
VITE_DAEMON_URL=http://localhost:4310

# Token admin do daemon (mesmo valor de ASSISTENTE_OS_DAEMON_TOKEN no lado
# do daemon). Fatia atual não tem tela de login — vai direto no header
# Authorization: Bearer de toda requisição.
VITE_DEV_TOKEN=

# Id da soul usada nesta fatia (sem SoulListScreen ainda — uma soul fixa).
VITE_DEV_SOUL_ID=
```

- [ ] **Step 18: Commit**

```bash
git add packages/web
git commit -m "feat(web): scaffold packages/web (Vite + React + Tailwind ligado ao @assistente-os/ui)"
```

---

### Task 2: api/client.ts — cliente REST de threads

**Files:**
- Create: `packages/web/src/api/types.ts`
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/test/fakeDaemon.ts`
- Test: `packages/web/src/api/client.test.ts`

**Interfaces:**
- Consumes: nenhuma interface de task anterior além do scaffold em si.
- Produces: `ApiClientConfig { baseUrl: string; token: string }`, `ApiError extends Error { status: number }`, `listThreads(config, soulId): Promise<Thread[]>`, `createThread(config, soulId, title?): Promise<Thread>`, `getThreadMessages(config, soulId, threadId): Promise<ThreadMessage[]>` — usados por `hooks/useThreads.ts` e `hooks/useThreadStream.ts` na Task 4. `startFakeDaemon(handler): Promise<{url, close}>` em `src/test/fakeDaemon.ts` — reutilizado pelas Tasks 3 e 4 pra testar contra um servidor HTTP local de verdade (não mock de módulo).

- [ ] **Step 1: Criar `src/api/types.ts`**

Espelha exatamente `Thread`/`ThreadMessage` de `packages/core/src/threads.ts` — o daemon devolve esses objetos via `JSON.stringify` direto, sem remapear chaves.

```ts
export interface Thread {
  id: number;
  soul: string;
  accountId: number | null;
  title: string;
  createdAt: string;
  lastMessageAt: string;
}

export interface ThreadMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: string;
}
```

- [ ] **Step 2: Criar o helper de servidor fake (`src/test/fakeDaemon.ts`)**

Não é mock de módulo — é um `http.createServer` real, mesmo padrão que `ollamaChatStream`'s tests já usam pra fakear o Ollama do lado servidor. Cada arquivo de teste registra seu próprio `handler` (roteamento simples por `req.method`/`req.url`).

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FakeDaemonHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>;

export interface FakeDaemon {
  url: string;
  close: () => Promise<void>;
}

export function startFakeDaemon(handler: FakeDaemonHandler): Promise<FakeDaemon> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void handler(req, res, Buffer.concat(chunks).toString("utf8"));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 3: Escrever o teste que falha (`src/api/client.test.ts`)**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";
import { ApiError, createThread, getThreadMessages, listThreads, type ApiClientConfig } from "./client";

let daemon: FakeDaemon;
let config: ApiClientConfig;

afterEach(async () => {
  await daemon?.close();
});

describe("listThreads", () => {
  beforeEach(async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads") {
        expect(req.headers.authorization).toBe("Bearer dev-token");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            { id: 1, soul: "soul-a", accountId: null, title: "Primeira", createdAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z" },
          ]),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rota fake não coberta" }));
    });
    config = { baseUrl: daemon.url, token: "dev-token" };
  });

  it("devolve as threads da soul, com o Bearer token no header", async () => {
    const threads = await listThreads(config, "soul-a");
    expect(threads).toHaveLength(1);
    expect(threads[0]!.title).toBe("Primeira");
  });
});

describe("createThread", () => {
  beforeEach(async () => {
    daemon = await startFakeDaemon((req, res, body) => {
      if (req.method === "POST" && req.url === "/souls/soul-a/threads") {
        const parsed = JSON.parse(body || "{}") as { title?: string };
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: 2,
            soul: "soul-a",
            accountId: null,
            title: parsed.title ?? "",
            createdAt: "2026-01-02T00:00:00.000Z",
            lastMessageAt: "2026-01-02T00:00:00.000Z",
          }),
        );
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    config = { baseUrl: daemon.url, token: "dev-token" };
  });

  it("cria uma thread nova e devolve o objeto criado", async () => {
    const thread = await createThread(config, "soul-a", "Minha thread");
    expect(thread.id).toBe(2);
    expect(thread.title).toBe("Minha thread");
  });
});

describe("getThreadMessages", () => {
  beforeEach(async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads/7/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: 1, role: "user", content: "oi", ts: "2026-01-01T00:00:00.000Z" }]));
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    config = { baseUrl: daemon.url, token: "dev-token" };
  });

  it("devolve as mensagens da thread", async () => {
    const messages = await getThreadMessages(config, "soul-a", 7);
    expect(messages).toEqual([{ id: 1, role: "user", content: "oi", ts: "2026-01-01T00:00:00.000Z" }]);
  });
});

describe("erros HTTP", () => {
  beforeEach(async () => {
    daemon = await startFakeDaemon((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "thread não encontrada" }));
    });
    config = { baseUrl: daemon.url, token: "dev-token" };
  });

  it("lança ApiError com a mensagem do corpo e o status", async () => {
    await expect(getThreadMessages(config, "soul-a", 999)).rejects.toMatchObject({
      message: "thread não encontrada",
      status: 404,
    });
    await expect(getThreadMessages(config, "soul-a", 999)).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 4: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL — `./client` ainda não existe.

- [ ] **Step 5: Criar `src/api/client.ts`**

```ts
import type { Thread, ThreadMessage } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientConfig {
  /** "" em produção (mesma origem do Vite, que faz proxy pro daemon real); uma URL absoluta nos testes. */
  baseUrl: string;
  token: string;
}

async function request<T>(config: ApiClientConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `requisição falhou (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corpo não é JSON — mantém a mensagem genérica
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listThreads(config: ApiClientConfig, soulId: string): Promise<Thread[]> {
  return request<Thread[]>(config, `/souls/${encodeURIComponent(soulId)}/threads`);
}

export function createThread(config: ApiClientConfig, soulId: string, title?: string): Promise<Thread> {
  return request<Thread>(config, `/souls/${encodeURIComponent(soulId)}/threads`, {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function getThreadMessages(config: ApiClientConfig, soulId: string, threadId: number): Promise<ThreadMessage[]> {
  return request<ThreadMessage[]>(config, `/souls/${encodeURIComponent(soulId)}/threads/${threadId}/messages`);
}
```

- [ ] **Step 6: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/api/client.test.ts`
Expected: PASS — 4 describe blocks, 5 testes.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api packages/web/src/test
git commit -m "feat(web): api/client.ts — cliente REST de threads contra um daemon fake real"
```

---

### Task 3: api/stream.ts — parser SSE e consumo do endpoint de streaming

**Files:**
- Create: `packages/web/src/api/stream.ts`
- Test: `packages/web/src/api/stream.test.ts`

**Interfaces:**
- Consumes: `ApiClientConfig` de `./client` (Task 2), `startFakeDaemon` de `../test/fakeDaemon` (Task 2).
- Produces: `StreamEvent` (union `step`/`token`/`done`/`error`, espelha `packages/daemon/src/routes/sse.ts` byte a byte), `SSEFrameParser` (classe com `.push(chunk: string): StreamEvent[]`), `streamThreadMessage(config, soulId, threadId, prompt, { onEvent, signal? }): Promise<void>` — usado por `hooks/useThreadStream.ts` na Task 4.

- [ ] **Step 1: Escrever os testes do parser que falham (`src/api/stream.test.ts`, parte 1 — `SSEFrameParser`)**

```ts
import { describe, expect, it } from "vitest";
import { SSEFrameParser, type StreamEvent } from "./stream";

describe("SSEFrameParser", () => {
  it("faz parsing de um frame único recebido de uma vez", () => {
    const parser = new SSEFrameParser();
    const events = parser.push('data: {"type":"token","text":"olá"}\n\n');
    expect(events).toEqual<StreamEvent[]>([{ type: "token", text: "olá" }]);
  });

  it("não emite nada enquanto o frame está partido entre chunks", () => {
    const parser = new SSEFrameParser();
    const events = parser.push('data: {"type":"token","tex');
    expect(events).toEqual([]);
  });

  it("emite o evento assim que o frame partido se completa no chunk seguinte", () => {
    const parser = new SSEFrameParser();
    parser.push('data: {"type":"token","tex');
    const events = parser.push('t":"olá"}\n\n');
    expect(events).toEqual<StreamEvent[]>([{ type: "token", text: "olá" }]);
  });

  it("faz parsing de múltiplos frames presentes no mesmo chunk, em ordem", () => {
    const parser = new SSEFrameParser();
    const events = parser.push(
      'data: {"type":"step","step":"router"}\n\ndata: {"type":"token","text":"a"}\n\ndata: {"type":"token","text":"b"}\n\n',
    );
    expect(events).toEqual<StreamEvent[]>([
      { type: "step", step: "router" },
      { type: "token", text: "a" },
      { type: "token", text: "b" },
    ]);
  });

  it("ignora comentários de heartbeat (': ping') sem quebrar o parsing seguinte", () => {
    const parser = new SSEFrameParser();
    const events = parser.push(': ping\n\ndata: {"type":"token","text":"depois do ping"}\n\n');
    expect(events).toEqual<StreamEvent[]>([{ type: "token", text: "depois do ping" }]);
  });

  it("faz parsing de um evento done com usage e sources", () => {
    const parser = new SSEFrameParser();
    const events = parser.push(
      'data: {"type":"done","messageId":42,"usage":{"promptTokens":10,"completionTokens":5,"source":"provider"},"sources":[{"title":"doc"}]}\n\n',
    );
    expect(events).toEqual<StreamEvent[]>([
      {
        type: "done",
        messageId: 42,
        usage: { promptTokens: 10, completionTokens: 5, source: "provider" },
        sources: [{ title: "doc" }],
      },
    ]);
  });
});
```

- [ ] **Step 2: Rodar os testes, confirmar que falham**

Run: `npx vitest run src/api/stream.test.ts`
Expected: FAIL — `./stream` ainda não existe.

- [ ] **Step 3: Criar `src/api/stream.ts`**

`StreamEvent` espelha exatamente `packages/daemon/src/routes/sse.ts` (mesmo pacote em produção fala esse contrato).

```ts
import type { ApiClientConfig } from "./client";

export type StreamEvent =
  | { type: "step"; step: string; message?: string; tool?: string }
  | { type: "token"; text: string }
  | {
      type: "done";
      messageId: number;
      usage: { promptTokens: number; completionTokens: number; source: "provider" | "estimate" };
      sources?: Array<{ title: string; url?: string; snippet?: string }>;
    }
  | { type: "error"; message: string };

/**
 * Parsing incremental de um corpo SSE (frames "data: {...}\n\n"; comentários
 * de heartbeat como ": ping\n\n" são ignorados) em StreamEvents, tolerando
 * frames partidos entre chunks de rede — mesmo tipo de robustez que
 * ollamaChatStream (lado servidor) já tem pro NDJSON do Ollama.
 */
export class SSEFrameParser {
  #buffer = "";

  push(chunk: string): StreamEvent[] {
    this.#buffer += chunk;
    const events: StreamEvent[] = [];
    let sep: number;
    while ((sep = this.#buffer.indexOf("\n\n")) !== -1) {
      const frame = this.#buffer.slice(0, sep);
      this.#buffer = this.#buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          events.push(JSON.parse(line.slice("data: ".length)) as StreamEvent);
        }
        // Linhas ": ping" (heartbeat) ou vazias são ignoradas.
      }
    }
    return events;
  }
}

export interface StreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Abre o stream de uma mensagem numa thread. Uma resposta não-2xx (soul/
 * thread não encontrada, prompt vazio, 429 de limite de turnos) chega ANTES
 * de qualquer byte de SSE — vira um único evento sintético {type:"error"},
 * pra quem chama ter um único caminho de exibição de erro, streaming ou não.
 */
export async function streamThreadMessage(
  config: ApiClientConfig,
  soulId: string,
  threadId: number,
  prompt: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/souls/${encodeURIComponent(soulId)}/threads/${threadId}/messages/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
    signal: callbacks.signal,
  });

  if (!res.ok || !res.body) {
    let message = `stream falhou (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corpo não é JSON — mantém a mensagem genérica
    }
    callbacks.onEvent({ type: "error", message });
    return;
  }

  const parser = new SSEFrameParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      callbacks.onEvent(event);
    }
  }
}
```

- [ ] **Step 4: Rodar os testes do parser, confirmar que passam**

Run: `npx vitest run src/api/stream.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Escrever os testes de integração que falham (`src/api/stream.test.ts`, parte 2 — `streamThreadMessage` contra um servidor fake real)**

Acrescentar ao mesmo arquivo:

```ts
import { afterEach, describe as describeStream, expect as expectStream, it as itStream } from "vitest";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";
import { streamThreadMessage, type ApiClientConfig } from "./stream";

describeStream("streamThreadMessage", () => {
  let daemon: FakeDaemon;

  afterEach(async () => {
    await daemon?.close();
  });

  itStream("entrega os eventos step/token/done na ordem, mesmo com o corpo escrito em pedaços pequenos", async () => {
    daemon = await startFakeDaemon((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const frames = [
        'data: {"type":"step","step":"router"}\n\n',
        ': ping\n\n',
        'data: {"type":"token","text":"ol"}\n\n',
        'data: {"type":"token","text":"á"}\n\n',
        'data: {"type":"done","messageId":9,"usage":{"promptTokens":1,"completionTokens":1,"source":"provider"}}\n\n',
      ];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= frames.length) {
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(frames[i]!);
        i++;
      }, 5);
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const received: unknown[] = [];
    await streamThreadMessage(config, "soul-a", 1, "oi", { onEvent: (e) => received.push(e) });
    expectStream(received).toEqual([
      { type: "step", step: "router" },
      { type: "token", text: "ol" },
      { type: "token", text: "á" },
      { type: "done", messageId: 9, usage: { promptTokens: 1, completionTokens: 1, source: "provider" } },
    ]);
  });

  itStream("resposta não-2xx antes do stream vira um único evento error sintético", async () => {
    daemon = await startFakeDaemon((req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "limite de turnos da sessão atingido" }));
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const received: unknown[] = [];
    await streamThreadMessage(config, "soul-a", 1, "oi", { onEvent: (e) => received.push(e) });
    expectStream(received).toEqual([{ type: "error", message: "limite de turnos da sessão atingido" }]);
  });
});
```

- [ ] **Step 6: Rodar os testes de integração, confirmar que passam**

Run: `npx vitest run src/api/stream.test.ts`
Expected: PASS — 8 testes no total (6 do parser + 2 de integração).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/stream.ts packages/web/src/api/stream.test.ts
git commit -m "feat(web): api/stream.ts — parser SSE e consumo do endpoint de streaming real"
```

---

### Task 4: hooks/useThreads e hooks/useThreadStream

**Files:**
- Create: `packages/web/src/hooks/useThreads.ts`
- Create: `packages/web/src/hooks/useThreadStream.ts`
- Test: `packages/web/src/hooks/useThreads.test.ts`
- Test: `packages/web/src/hooks/useThreadStream.test.ts`

**Interfaces:**
- Consumes: `listThreads`/`createThread`/`getThreadMessages`/`ApiClientConfig` de `../api/client` (Task 2), `streamThreadMessage`/`StreamEvent` de `../api/stream` (Task 3), `startFakeDaemon` de `../test/fakeDaemon` (Task 2), `Thread`/`ThreadMessage` de `../api/types` (Task 2).
- Produces: `useThreads(config, soulId): { threads, loading, error, activeThreadId, setActiveThreadId, createNewThread }`, `DisplayMessage` (union `persisted`/`streaming`/`pending`/`error`), `useThreadStream(config, soulId, threadId): { messages: DisplayMessage[], sending, send(prompt) }` — usados por `ThreadScreen` na Task 5.

- [ ] **Step 1: Escrever o teste que falha (`src/hooks/useThreads.test.ts`)**

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";
import { useThreads } from "./useThreads";
import type { ApiClientConfig } from "../api/client";

let daemon: FakeDaemon;

afterEach(async () => {
  await daemon?.close();
});

describe("useThreads", () => {
  it("carrega as threads ao montar e seleciona a primeira como ativa", async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            { id: 1, soul: "soul-a", accountId: null, title: "A", createdAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z" },
            { id: 2, soul: "soul-a", accountId: null, title: "B", createdAt: "2026-01-02T00:00:00.000Z", lastMessageAt: "2026-01-02T00:00:00.000Z" },
          ]),
        );
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const { result } = renderHook(() => useThreads(config, "soul-a"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.threads).toHaveLength(2);
    expect(result.current.activeThreadId).toBe(1);
  });

  it("createNewThread cria uma thread, insere na lista e a torna ativa", async () => {
    daemon = await startFakeDaemon((req, res, body) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([]));
        return;
      }
      if (req.method === "POST" && req.url === "/souls/soul-a/threads") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: 5,
            soul: "soul-a",
            accountId: null,
            title: "",
            createdAt: "2026-01-03T00:00:00.000Z",
            lastMessageAt: "2026-01-03T00:00:00.000Z",
          }),
        );
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const { result } = renderHook(() => useThreads(config, "soul-a"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createNewThread();
    });

    expect(result.current.threads.map((t) => t.id)).toEqual([5]);
    expect(result.current.activeThreadId).toBe(5);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/hooks/useThreads.test.ts`
Expected: FAIL — `./useThreads` ainda não existe.

- [ ] **Step 3: Criar `src/hooks/useThreads.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { createThread, listThreads, type ApiClientConfig } from "../api/client";
import type { Thread } from "../api/types";

export interface UseThreadsResult {
  threads: Thread[];
  loading: boolean;
  error: string | null;
  activeThreadId: number | null;
  setActiveThreadId: (id: number) => void;
  createNewThread: () => Promise<void>;
}

export function useThreads(config: ApiClientConfig, soulId: string): UseThreadsResult {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listThreads(config, soulId);
      setThreads(result);
      setActiveThreadId((current) => current ?? result[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar threads");
    } finally {
      setLoading(false);
    }
  }, [config, soulId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createNewThread = useCallback(async () => {
    const thread = await createThread(config, soulId);
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
  }, [config, soulId]);

  return { threads, loading, error, activeThreadId, setActiveThreadId, createNewThread };
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/hooks/useThreads.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 5: Escrever o teste que falha (`src/hooks/useThreadStream.test.ts`)**

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";
import { useThreadStream } from "./useThreadStream";
import type { ApiClientConfig } from "../api/client";

let daemon: FakeDaemon;

afterEach(async () => {
  await daemon?.close();
});

describe("useThreadStream", () => {
  it("carrega o histórico existente da thread ao montar", async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads/3/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: 1, role: "user", content: "oi", ts: "2026-01-01T00:00:00.000Z" }]));
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const { result } = renderHook(() => useThreadStream(config, "soul-a", 3));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ kind: "persisted", role: "user", content: "oi" });
  });

  it("send acumula tokens numa mensagem streaming e finaliza como persisted no done", async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads/3/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([]));
        return;
      }
      if (req.method === "POST" && req.url === "/souls/soul-a/threads/3/messages/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"token","text":"ol"}\n\n');
        res.write('data: {"type":"token","text":"á"}\n\n');
        res.write('data: {"type":"done","messageId":8,"usage":{"promptTokens":1,"completionTokens":1,"source":"provider"}}\n\n');
        res.end();
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const { result } = renderHook(() => useThreadStream(config, "soul-a", 3));
    await waitFor(() => expect(result.current.sending).toBe(false));

    await act(async () => {
      await result.current.send("pergunta");
    });

    expect(result.current.messages).toMatchObject([
      { kind: "persisted", role: "user", content: "pergunta" },
      { kind: "persisted", id: 8, role: "assistant", content: "olá" },
    ]);
  });

  it("send mostra uma mensagem de erro quando o provider falha no meio do stream", async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads/3/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([]));
        return;
      }
      if (req.method === "POST" && req.url === "/souls/soul-a/threads/3/messages/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"token","text":"parc"}\n\n');
        res.write('data: {"type":"error","message":"provider falhou"}\n\n');
        res.end();
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const { result } = renderHook(() => useThreadStream(config, "soul-a", 3));
    await waitFor(() => expect(result.current.sending).toBe(false));

    await act(async () => {
      await result.current.send("pergunta");
    });

    const assistantMessage = result.current.messages[1];
    expect(assistantMessage).toMatchObject({ kind: "error", message: "provider falhou" });
  });
});
```

- [ ] **Step 6: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/hooks/useThreadStream.test.ts`
Expected: FAIL — `./useThreadStream` ainda não existe.

- [ ] **Step 7: Criar `src/hooks/useThreadStream.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getThreadMessages, type ApiClientConfig } from "../api/client";
import { streamThreadMessage, type StreamEvent } from "../api/stream";

export type DisplayMessage =
  | { kind: "persisted"; id: number; role: "user" | "assistant"; content: string }
  | { kind: "streaming"; id: string; role: "assistant"; chunks: string[] }
  | { kind: "pending"; id: string; role: "user"; content: string }
  | { kind: "error"; id: string; message: string };

export interface UseThreadStreamResult {
  messages: DisplayMessage[];
  sending: boolean;
  send: (prompt: string) => Promise<void>;
}

let nextLocalId = 0;

export function useThreadStream(config: ApiClientConfig, soulId: string, threadId: number | null): UseThreadStreamResult {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    if (threadId === null) return;
    let cancelled = false;
    void getThreadMessages(config, soulId, threadId).then((history) => {
      if (cancelled) return;
      setMessages(history.map((m) => ({ kind: "persisted" as const, id: m.id, role: m.role, content: m.content })));
    });
    return () => {
      cancelled = true;
    };
  }, [config, soulId, threadId]);

  const send = useCallback(
    async (prompt: string) => {
      if (threadId === null) return;
      const userId = `local-${nextLocalId++}`;
      const streamId = `local-${nextLocalId++}`;
      setMessages((prev) => [
        ...prev,
        { kind: "pending", id: userId, role: "user", content: prompt },
        { kind: "streaming", id: streamId, role: "assistant", chunks: [] },
      ]);
      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamThreadMessage(config, soulId, threadId, prompt, {
          signal: controller.signal,
          onEvent: (event: StreamEvent) => {
            if (event.type === "token") {
              setMessages((prev) =>
                prev.map((m) => (m.id === streamId && m.kind === "streaming" ? { ...m, chunks: [...m.chunks, event.text] } : m)),
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId && m.kind === "streaming"
                    ? { kind: "persisted" as const, id: event.messageId, role: "assistant" as const, content: m.chunks.join("") }
                    : m,
                ),
              );
            } else if (event.type === "error") {
              setMessages((prev) => prev.map((m) => (m.id === streamId ? { kind: "error" as const, id: streamId, message: event.message } : m)));
            }
          },
        });
      } finally {
        setSending(false);
      }
    },
    [config, soulId, threadId],
  );

  return { messages, sending, send };
}
```

- [ ] **Step 8: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/hooks/useThreadStream.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 9: Rodar a suíte inteira de `packages/web`**

Run: `npx vitest run`
Expected: todos os testes passam (App + client + stream + useThreads + useThreadStream).

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/hooks
git commit -m "feat(web): useThreads e useThreadStream — estado de threads e streaming ligado ao stream real"
```

---

### Task 5: ThreadScreen — composição final e verificação visual

**Files:**
- Create: `packages/web/src/screens/ThreadScreen.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/App.test.tsx`
- Test: `packages/web/src/screens/ThreadScreen.test.tsx`

**Interfaces:**
- Consumes: `useThreads`/`UseThreadsResult` de `../hooks/useThreads` (Task 4), `useThreadStream`/`DisplayMessage`/`UseThreadStreamResult` de `../hooks/useThreadStream` (Task 4), `ApiClientConfig` de `../api/client` (Task 2), `Message`/`MessageList`/`StreamingText`/`Markdown` de `@assistente-os/ui` (já mergeado).
- Produces: `ThreadScreen({ config, soulId }): JSX.Element` — montado por `App.tsx`, fim da cadeia desta fatia.

- [ ] **Step 1: Escrever o teste que falha (`src/screens/ThreadScreen.test.tsx`)**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";
import { ThreadScreen } from "./ThreadScreen";
import type { ApiClientConfig } from "../api/client";

let daemon: FakeDaemon;

afterEach(async () => {
  await daemon?.close();
});

describe("ThreadScreen", () => {
  it("lista as threads na sidebar, mostra o histórico e envia uma mensagem nova que aparece na tela ao terminar", async () => {
    const user = userEvent.setup();
    daemon = await startFakeDaemon((req, res, body) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            { id: 1, soul: "soul-a", accountId: null, title: "Onboarding", createdAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-01-01T00:00:00.000Z" },
          ]),
        );
        return;
      }
      if (req.method === "GET" && req.url === "/souls/soul-a/threads/1/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: 1, role: "user", content: "mensagem antiga", ts: "2026-01-01T00:00:00.000Z" }]));
        return;
      }
      if (req.method === "POST" && req.url === "/souls/soul-a/threads/1/messages/stream") {
        const parsed = JSON.parse(body || "{}") as { prompt?: string };
        expect(parsed.prompt).toBe("mensagem nova");
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"token","text":"resposta"}\n\n');
        res.write('data: {"type":"done","messageId":2,"usage":{"promptTokens":1,"completionTokens":1,"source":"provider"}}\n\n');
        res.end();
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };

    render(<ThreadScreen config={config} soulId="soul-a" />);

    expect(await screen.findByText("Onboarding")).toBeInTheDocument();
    expect(await screen.findByText("mensagem antiga")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/escreva uma mensagem/i);
    await user.type(input, "mensagem nova");
    await user.click(screen.getByRole("button", { name: /enviar/i }));

    await waitFor(() => expect(screen.getByText("resposta")).toBeInTheDocument());
    expect(screen.getByText("mensagem nova")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/screens/ThreadScreen.test.tsx`
Expected: FAIL — `./ThreadScreen` ainda não existe.

- [ ] **Step 3: Criar `src/screens/ThreadScreen.tsx`**

Mensagens `streaming` usam `StreamingText` (cursor piscando); `persisted`/`pending` usam `Markdown` puro (sem cursor — resolvido assim que `done` chega, ver Global Constraints); `error` mostra o texto em destaque no lugar da bolha.

```tsx
import { type FormEvent, useState } from "react";
import { Markdown, Message, MessageList, StreamingText } from "@assistente-os/ui";
import type { ApiClientConfig } from "../api/client";
import { useThreadStream } from "../hooks/useThreadStream";
import { useThreads } from "../hooks/useThreads";

export interface ThreadScreenProps {
  config: ApiClientConfig;
  soulId: string;
}

export function ThreadScreen({ config, soulId }: ThreadScreenProps) {
  const { threads, loading, error, activeThreadId, setActiveThreadId, createNewThread } = useThreads(config, soulId);
  const { messages, sending, send } = useThreadStream(config, soulId, activeThreadId);
  const [draft, setDraft] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || sending) return;
    setDraft("");
    void send(prompt);
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-border p-3">
        <button
          type="button"
          onClick={() => void createNewThread()}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        >
          + Nova thread
        </button>
        {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-col gap-1 overflow-y-auto">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setActiveThreadId(thread.id)}
              className={`rounded-md px-2 py-1.5 text-left text-sm ${
                thread.id === activeThreadId ? "bg-accent font-medium" : "hover:bg-accent/50"
              }`}
            >
              {thread.title || `Thread #${thread.id}`}
            </button>
          ))}
        </div>
      </aside>
      <main className="flex min-h-0 flex-1 flex-col">
        <MessageList className="flex-1">
          {messages.map((message) => {
            if (message.kind === "error") {
              return (
                <Message key={message.id} role="assistant">
                  <span className="text-destructive">{message.message}</span>
                </Message>
              );
            }
            if (message.kind === "streaming") {
              return (
                <Message key={message.id} role="assistant">
                  <StreamingText chunks={message.chunks} />
                </Message>
              );
            }
            return (
              <Message key={message.id} role={message.role}>
                <Markdown source={message.content} />
              </Message>
            );
          })}
        </MessageList>
        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
          <input
            className="flex-1 rounded-md border border-input px-3 py-2 text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Escreva uma mensagem..."
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/screens/ThreadScreen.test.tsx`
Expected: PASS — 1 teste.

- [ ] **Step 5: Ligar a `ThreadScreen` no `App.tsx`**

Substitui o placeholder do scaffold (Task 1) pela tela real, lendo a config fixa das env vars.

```tsx
import { ThreadScreen } from "./screens/ThreadScreen";
import type { ApiClientConfig } from "./api/client";

const config: ApiClientConfig = {
  baseUrl: "",
  token: import.meta.env.VITE_DEV_TOKEN as string,
};

const soulId = import.meta.env.VITE_DEV_SOUL_ID as string;

export function App() {
  if (!config.token || !soulId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-sm text-destructive">
        Configure VITE_DEV_TOKEN e VITE_DEV_SOUL_ID em packages/web/.env.local (veja .env.example).
      </div>
    );
  }
  return <ThreadScreen config={config} soulId={soulId} />;
}
```

- [ ] **Step 6: Atualizar `App.test.tsx`** (o placeholder do Step 1/Task 1 não existe mais — o teste antigo quebraria)

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("mostra um aviso de configuração quando VITE_DEV_TOKEN/VITE_DEV_SOUL_ID não estão definidas", () => {
    render(<App />);
    expect(screen.getByText(/configure vite_dev_token/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Rodar a suíte inteira, confirmar que passa**

Run: `npx vitest run`
Expected: todos os testes passam (nenhuma regressão nas Tasks 1-4).

- [ ] **Step 8: Rodar `npm run build`**

Run: `npm run build` (dentro de `packages/web`)
Expected: `tsc --noEmit` e `vite build` limpos.

- [ ] **Step 9: Verificação manual no navegador contra o daemon + Ollama reais**

Preencher `packages/web/.env.local` com um `VITE_DEV_TOKEN` válido (mesmo valor de `ASSISTENTE_OS_DAEMON_TOKEN` do daemon rodando) e um `VITE_DEV_SOUL_ID` de uma soul existente. Com o daemon (porta 4310, ver `assistente-os-infra` nas memórias do projeto) e o Ollama locais no ar:

Run: `npm run dev` (dentro de `packages/web`), abrir a URL impressa.

Expected, confirmado visualmente (não só pelos testes):
- A sidebar lista as threads reais da soul (ou aparece vazia com o botão "+ Nova thread" funcionando, se a soul ainda não tiver nenhuma).
- Selecionar uma thread carrega as mensagens antigas de verdade.
- Enviar uma mensagem: a bolha do usuário aparece na hora, a bolha do assistente começa vazia e o texto vai **aparecendo progressivamente** (não tudo de uma vez) — o cursor pisca enquanto está streaming.
- Ao terminar (`done`), o cursor some e a bolha vira texto estático.
- Se a soul/thread não existir, ou o `VITE_DEV_TOKEN` estiver errado, ou o Ollama estiver fora do ar, o erro aparece visível na tela (não trava silenciosamente).

Se qualquer um desses pontos falhar, a task não está pronta — voltar e corrigir antes do commit final.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/screens packages/web/src/App.tsx packages/web/src/App.test.tsx
git commit -m "feat(web): ThreadScreen — sidebar + streaming real ligado ao endpoint SSE"
```
