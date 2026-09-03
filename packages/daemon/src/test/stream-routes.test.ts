import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-stream-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-stream-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function signup(base: string, email: string): Promise<{ accountId: number; token: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  const body = (await res.json()) as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  return { accountId: body.account.id, token: body.token };
}

async function createThreadViaApi(base: string, soulId: string, headers: Record<string, string>): Promise<number> {
  const res = await fetch(`${base}/souls/${soulId}/threads`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ title: "teste" }),
  });
  const body = (await res.json()) as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.id;
}

/** Lê um response SSE inteiro e devolve os StreamEvents parseados, na ordem. */
async function readAllSSEEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) {
        events.push(JSON.parse(chunk.slice("data: ".length)));
      }
      // linhas ": ping" (heartbeat) são ignoradas de propósito — não são "data:"
    }
  }
  return events;
}

/**
 * Fake do Ollama real (mesmo padrão de ollama-chat-stream.test.ts — um
 * `http.createServer` de verdade, não um mock): serve GET /api/tags (o probe
 * de disponibilidade que `routeFromPrompt` usa pra escolher o tier "local")
 * e POST /api/chat, que devolve NDJSON linha a linha (streaming de verdade,
 * um `res.write()` por chunk) ou um erro HTTP, conforme `opts`.
 *
 * F4 da revisão da task 5: os testes de sucesso do endpoint dependiam
 * silenciosamente de um Ollama real acessível em localhost:11434 — passavam
 * neste ambiente (que tem o container `memoria-ollama`) mas falhariam em
 * qualquer CI sem Ollama, que é o gate de merge real deste projeto (PR+CI).
 * Apontar `OLLAMA_URL` pra este fake elimina a dependência externa.
 */
function startFakeOllama(
  opts: {
    chatChunks?: object[];
    chatStatusCode?: number;
    /** Chamado com o corpo (JSON parseado) de cada POST /api/chat recebido — usado pelo teste do N3 pra inspecionar o `messages` (system prompt) que o daemon de fato mandou pro provider. */
    onChatRequest?: (body: any) => void;
  } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/tags") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/chat") {
        let rawBody = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => (rawBody += chunk));
        req.on("end", () => {
          if (opts.onChatRequest) {
            try {
              opts.onChatRequest(JSON.parse(rawBody));
            } catch {
              /* corpo malformado — o teste que passou onChatRequest vai notar pela ausência da chamada */
            }
          }
          if (opts.chatStatusCode && opts.chatStatusCode >= 400) {
            res.writeHead(opts.chatStatusCode);
            res.end("erro simulado");
            return;
          }
          res.writeHead(200, { "content-type": "application/x-ndjson" });
          const chunks = opts.chatChunks ?? [];
          let i = 0;
          const sendNext = () => {
            if (i >= chunks.length) {
              res.end();
              return;
            }
            res.write(JSON.stringify(chunks[i]) + "\n");
            i++;
            setTimeout(sendNext, 5);
          };
          sendNext();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Aponta OLLAMA_URL pro fake pela duração de `fn`, restaurando o valor original depois (mesmo padrão de kill-switch.test.ts / mission-runner.test.ts). */
async function withFakeOllama<T>(fake: { url: string }, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = fake.url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prev;
  }
}

test("stream: soul inexistente devolve 404 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/nao-existe/threads/1/messages/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), false);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: thread inexistente devolve 404 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream1@exemplo.com");
    createSoul(home, "soul-stream1", { name: "soul-stream1", ownerAccountId: alice.accountId });
    const res = await fetch(`${base}/souls/soul-stream1/threads/999999/messages/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: sem prompt devolve 400 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream2@exemplo.com");
    createSoul(home, "soul-stream2", { name: "soul-stream2", ownerAccountId: alice.accountId });
    const headers = { authorization: `Bearer ${alice.token}` };
    const threadId = await createThreadViaApi(base, "soul-stream2", headers);
    const res = await fetch(`${base}/souls/soul-stream2/threads/${threadId}/messages/stream`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: emite step/token/done contra um Ollama fake (determinístico, sem rede externa), e a mensagem fica gravada por thread_id", async () => {
  const { home, cleanup } = await tempHome();
  const fake = await startFakeOllama({
    chatChunks: [
      { message: { content: "olá" } },
      { message: { content: ", " } },
      { message: { content: "mundo!" } },
      { done: true, prompt_eval_count: 12, eval_count: 4 },
    ],
  });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream3@exemplo.com");
      createSoul(home, "soul-stream3", { name: "soul-stream3", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream3", headers);

      const res = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "diga oi" }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

      const events = await readAllSSEEvents(res);
      assert.ok(events.length > 0, "esperava pelo menos um evento");
      assert.ok(events.some((e) => e.type === "step"), "esperava ao menos um evento de step (preparação)");
      assert.ok(events.some((e) => e.type === "token"), "esperava eventos de token (streaming progressivo do fake)");
      const doneEvent = events.find((e) => e.type === "done") as { messageId?: number } | undefined;
      assert.ok(doneEvent, "esperava um evento done ao final");
      assert.equal(events.at(-1)?.type, "done", "done deve ser o último evento");

      // GET .../threads/:id/messages agora deve refletir o turno gravado com thread_id —
      // prova de que Task 3's threadId-write funciona ponta a ponta pelo endpoint real.
      const messagesRes = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ id: number; role: string; content: string }>;
      assert.equal(messages.length, 2, "esperava as duas mensagens do turno (user + assistant)");
      assert.ok(messages.some((m) => m.role === "user" && m.content === "diga oi"));
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.equal(assistantMsg!.content, "olá, mundo!");
      assert.equal(doneEvent!.messageId, assistantMsg!.id, "done.messageId deve bater com o id da linha do assistente");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: provider falha no meio (HTTP 500 do Ollama fake) → emite {type:error}, sem done, sem gravar nenhuma linha", async () => {
  const { home, cleanup } = await tempHome();
  // /api/tags responde ok (o router escolhe o tier "ollama"); /api/chat falha
  // com 500 — deterministicamente, sem depender de timeout de rede nenhum.
  const fake = await startFakeOllama({ chatStatusCode: 500 });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-fail@exemplo.com");
      createSoul(home, "soul-stream-fail", { name: "soul-stream-fail", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-fail", headers);

      const res = await fetch(`${base}/souls/soul-stream-fail/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "diga oi" }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

      const events = await readAllSSEEvents(res);
      assert.ok(
        events.some((e) => e.type === "error"),
        "esperava um evento {type:'error'} quando o provider falha",
      );
      assert.ok(
        !events.some((e) => e.type === "done"),
        "não deveria haver 'done' quando a execução falhou",
      );

      const messagesRes = await fetch(`${base}/souls/soul-stream-fail/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as unknown[];
      assert.equal(messages.length, 0, "nenhuma linha (nem a do usuário) deve ser gravada quando a execução falha");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: N2 — um segredo partido entre dois onToken() nunca aparece em texto puro num evento token", async () => {
  // "sk-" + 36 chars alfanuméricos casa DEFAULT_PATTERNS.OPENAI_API_KEY
  // (>= 20 chars após "sk-"). Partido no meio ("...PQR" | "STU...") — exatamente
  // o caso que sanitizar cada onToken() isoladamente (regex sobre uma string só)
  // deixaria escapar, já que nenhum dos dois pedaços sozinho casa o padrão.
  const secret = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const secretHead = secret.slice(0, 22); // primeira metade — sozinha, curta demais pra casar o padrão (precisa de >=20 chars após "sk-")
  const secretTail = secret.slice(22); // segunda metade — sozinha, não tem o prefixo "sk-" nem casaria
  const fake = await startFakeOllama({
    chatChunks: [
      { message: { content: `A chave e ${secretHead}` } },
      { message: { content: `${secretTail} ok.` } },
      { done: true, prompt_eval_count: 5, eval_count: 5 },
    ],
  });
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-secret@exemplo.com");
      createSoul(home, "soul-stream-secret", { name: "soul-stream-secret", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-secret", headers);

      const res = await fetch(`${base}/souls/soul-stream-secret/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "qual e a chave da API?" }),
      });
      assert.equal(res.status, 200);

      const events = await readAllSSEEvents(res);
      const tokenEvents = events.filter((e) => e.type === "token") as Array<{ text: string }>;
      assert.ok(tokenEvents.length > 0, "esperava ao menos um evento token");

      for (const e of tokenEvents) {
        assert.ok(!e.text.includes(secret), `evento token não deveria conter o segredo em texto puro: ${JSON.stringify(e.text)}`);
        assert.ok(!e.text.includes(secretHead), `evento token não deveria conter nem a metade do segredo em texto puro: ${JSON.stringify(e.text)}`);
      }
      const wireText = tokenEvents.map((e) => e.text).join("");
      assert.ok(wireText.includes("[REDACTED_OPENAI_KEY]"), `o texto reconstruído da SSE deveria mostrar o marcador de redação: ${JSON.stringify(wireText)}`);
      assert.ok(!wireText.includes(secret), "o texto reconstruído da SSE não deveria conter o segredo de jeito nenhum");

      // A cópia persistida também deve estar redigida (comportamento já
      // existente, reconfirmado aqui lado a lado com o texto que saiu na SSE).
      const messagesRes = await fetch(`${base}/souls/soul-stream-secret/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.ok(!assistantMsg!.content.includes(secret), "a mensagem persistida não deveria conter o segredo");
      assert.ok(assistantMsg!.content.includes("[REDACTED_OPENAI_KEY]"));
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: R1 — chave privada PEM transmitida em pedaços nunca vaza em texto puro (128 chars de lookback sozinho não bastava)", async () => {
  // Um bloco PEM de verdade (RSA-2048) tem ~1700 chars — bem além dos 128 de
  // lookback. O clamp de PEM em emitSanitizedToken precisa segurar TODO o
  // corte até ver o "-----END" correspondente, não só os últimos 128 chars.
  const pemLines = Array.from({ length: 20 }, (_, i) => `LINE${i}FAKEKEYDATA1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ`);
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${pemLines.join("\n")}\n-----END RSA PRIVATE KEY-----`;
  const fullText = `Aqui esta a chave: ${pem} — guarde com cuidado.`;
  const CHUNK_SIZE = 40; // mesmo tamanho de chunk que a re-revisão usou pra reproduzir o bug (P3)
  const chatChunks: object[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
    chatChunks.push({ message: { content: fullText.slice(i, i + CHUNK_SIZE) } });
  }
  chatChunks.push({ done: true, prompt_eval_count: 5, eval_count: 5 });

  const fake = await startFakeOllama({ chatChunks });
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-pem@exemplo.com");
      createSoul(home, "soul-stream-pem", { name: "soul-stream-pem", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-pem", headers);

      const res = await fetch(`${base}/souls/soul-stream-pem/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "qual e a chave privada?" }),
      });
      assert.equal(res.status, 200);

      const events = await readAllSSEEvents(res);
      const tokenEvents = events.filter((e) => e.type === "token") as Array<{ text: string }>;
      assert.ok(tokenEvents.length > 0, "esperava ao menos um evento token");

      for (const e of tokenEvents) {
        assert.ok(!e.text.includes("-----BEGIN"), `evento token não deveria conter o cabeçalho PEM cru: ${JSON.stringify(e.text)}`);
        for (const line of pemLines) {
          assert.ok(!e.text.includes(line), `evento token não deveria conter material da chave em texto puro: ${JSON.stringify(e.text)}`);
        }
      }
      const wireText = tokenEvents.map((e) => e.text).join("");
      assert.ok(wireText.includes("[REDACTED_PRIVATE_KEY]"), `esperava o marcador de redação no texto reconstruído: ${JSON.stringify(wireText)}`);
      assert.ok(!wireText.includes("-----BEGIN"), "o texto reconstruído não deveria conter o cabeçalho PEM cru");
      for (const line of pemLines) assert.ok(!wireText.includes(line), "o texto reconstruído não deveria conter material da chave");

      const messagesRes = await fetch(`${base}/souls/soul-stream-pem/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.ok(assistantMsg!.content.includes("[REDACTED_PRIVATE_KEY]"));
      // A propriedade que R1/N2 existem pra garantir: o que saiu na SSE e o
      // que ficou persistido são o MESMO texto — sem divergência entre o
      // que o cliente viu e o que a transcrição mostra depois.
      assert.equal(wireText.trim(), assistantMsg!.content.trim());
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: R1 — token/JWT longo (400+ chars, sem espaço interno) transmitido em pedaços nunca vaza em texto puro", async () => {
  // GENERIC_TOKEN é limitado só por whitespace, não por tamanho — um JWT de
  // verdade tem rotineiramente 300-900 chars, bem além dos 128 de lookback.
  // Sem o clamp de "nunca corta no meio de uma palavra", o corte de 128 chars
  // partiria o token ao meio e a metade sem o prefixo "token:" nunca casaria
  // o padrão sozinha — vazando em texto puro.
  const jwtBody = `ey${"A".repeat(60)}.${"B".repeat(300)}.${"C".repeat(80)}`; // > 400 chars, sem nenhum espaço
  const fullText = `Aqui esta o token: ${jwtBody} — guarde com cuidado.`;
  const CHUNK_SIZE = 30;
  const chatChunks: object[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
    chatChunks.push({ message: { content: fullText.slice(i, i + CHUNK_SIZE) } });
  }
  chatChunks.push({ done: true, prompt_eval_count: 5, eval_count: 5 });

  const fake = await startFakeOllama({ chatChunks });
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-jwt@exemplo.com");
      createSoul(home, "soul-stream-jwt", { name: "soul-stream-jwt", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-jwt", headers);

      const res = await fetch(`${base}/souls/soul-stream-jwt/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "qual e o token de acesso?" }),
      });
      assert.equal(res.status, 200);

      const events = await readAllSSEEvents(res);
      const tokenEvents = events.filter((e) => e.type === "token") as Array<{ text: string }>;
      assert.ok(tokenEvents.length > 0, "esperava ao menos um evento token");

      for (const e of tokenEvents) {
        assert.ok(!e.text.includes(jwtBody), `evento token não deveria conter o JWT completo em texto puro: ${JSON.stringify(e.text.slice(0, 80))}`);
        assert.ok(!e.text.includes("A".repeat(60)), "evento token não deveria conter a primeira seção do JWT em texto puro");
      }
      const wireText = tokenEvents.map((e) => e.text).join("");
      assert.ok(wireText.includes("[REDACTED_TOKEN]"), `esperava o marcador de redação no texto reconstruído: ${JSON.stringify(wireText)}`);
      assert.ok(!wireText.includes(jwtBody), "o texto reconstruído não deveria conter o JWT completo");

      const messagesRes = await fetch(`${base}/souls/soul-stream-jwt/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.equal(wireText.trim(), assistantMsg!.content.trim());
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: S1 — JWT longo SEGUIDO de mais de 128 chars de texto comum nunca vaza (exercita o corte no meio do stream)", async () => {
  // As 4 rodadas anteriores de testes só cobriram segredo NO FIM da resposta,
  // com trailer curto (< 128 chars) — nesse formato o corte ingênuo nunca
  // passa do segredo e tudo sai num flush só (1 evento token), sem NUNCA
  // exercitar a lógica de corte no meio do stream. Aqui o trailer tem > 128
  // chars de propósito: o corte ingênuo AVANÇA pra dentro do texto comum e,
  // sem o arredondamento pra fronteira de espaço, cairia dentro do JWT.
  const jwtBody = `ey${"A".repeat(60)}.${"B".repeat(300)}.${"C".repeat(80)}`; // > 400 chars, sem nenhum espaço
  const trailer =
    " palavraxx e depois mais texto normal lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud.";
  assert.ok(trailer.length > 128, "o trailer PRECISA ser maior que o lookback de 128 — é o ponto do teste");
  const fullText = `Aqui esta o token: ${jwtBody}${trailer}`;
  const CHUNK_SIZE = 30;
  const chatChunks: object[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
    chatChunks.push({ message: { content: fullText.slice(i, i + CHUNK_SIZE) } });
  }
  chatChunks.push({ done: true, prompt_eval_count: 5, eval_count: 5 });

  const fake = await startFakeOllama({ chatChunks });
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-jwt-tail@exemplo.com");
      createSoul(home, "soul-stream-jwt-tail", { name: "soul-stream-jwt-tail", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-jwt-tail", headers);

      const res = await fetch(`${base}/souls/soul-stream-jwt-tail/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "qual e o token de acesso?" }),
      });
      assert.equal(res.status, 200);

      const events = await readAllSSEEvents(res);
      const tokenEvents = events.filter((e) => e.type === "token") as Array<{ text: string }>;
      assert.ok(tokenEvents.length > 1, `com trailer > 128 chars o corte no meio do stream TEM que acontecer (esperava mais de 1 evento token, veio ${tokenEvents.length})`);

      // 1) nenhum evento token isolado pode conter pedaço reconhecível do JWT
      for (const e of tokenEvents) {
        assert.ok(!e.text.includes(jwtBody), `evento token não deveria conter o JWT completo: ${JSON.stringify(e.text.slice(0, 80))}`);
        assert.ok(!e.text.includes("A".repeat(60)), `evento token não deveria conter a 1ª seção do JWT: ${JSON.stringify(e.text.slice(0, 80))}`);
        assert.ok(!e.text.includes("B".repeat(60)), `evento token não deveria conter corpo do JWT: ${JSON.stringify(e.text.slice(0, 80))}`);
        assert.ok(!e.text.includes("C".repeat(60)), `evento token não deveria conter a 3ª seção do JWT: ${JSON.stringify(e.text.slice(0, 80))}`);
      }
      // 2) nem a concatenação de TODOS eles (o que o cliente realmente vê)
      const wireText = tokenEvents.map((e) => e.text).join("");
      assert.ok(!wireText.includes(jwtBody), "o texto reconstruído da SSE não deveria conter o JWT");
      assert.ok(!wireText.includes("B".repeat(60)), "o texto reconstruído da SSE não deveria conter corpo cru do JWT");
      assert.ok(wireText.includes("[REDACTED_TOKEN]"), `esperava o marcador de redação no texto reconstruído: ${JSON.stringify(wireText.slice(0, 200))}`);
      assert.ok(wireText.includes("palavraxx"), "o texto comum depois do segredo tem que chegar ao cliente normalmente");

      // 3) o que saiu na SSE é o MESMO texto que ficou persistido (sem
      //    divergência silenciosa entre o que o cliente viu e a auditoria)
      const messagesRes = await fetch(`${base}/souls/soul-stream-jwt-tail/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.ok(!assistantMsg!.content.includes(jwtBody), "a mensagem persistida não deveria conter o JWT");
      assert.equal(wireText.trim(), assistantMsg!.content.trim());
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: S1 — DATABASE_URL (postgres://user:pass@host) seguida de texto comum nunca vaza na SSE", async () => {
  // Classe de falha distinta da do JWT: quando o corte caía dentro do
  // "postgres://...", NENHUM dos dois pedaços casava o regex de DATABASE_URL —
  // ou seja, a redação não disparava de jeito nenhum no caminho ao vivo e a
  // URL inteira, senha incluída, chegava crua ao cliente.
  const dbUrl = "postgres://admin:SuperSecretPassword123@db.internal.example.com:5432/producao?sslmode=require";
  const trailer =
    " palavraxx e depois mais texto normal lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud.";
  assert.ok(trailer.length > 128, "o trailer PRECISA ser maior que o lookback de 128");
  const fullText = `Use esta url: ${dbUrl}${trailer}`;
  const CHUNK_SIZE = 30;
  const chatChunks: object[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
    chatChunks.push({ message: { content: fullText.slice(i, i + CHUNK_SIZE) } });
  }
  chatChunks.push({ done: true, prompt_eval_count: 5, eval_count: 5 });

  const fake = await startFakeOllama({ chatChunks });
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-dburl@exemplo.com");
      createSoul(home, "soul-stream-dburl", { name: "soul-stream-dburl", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-dburl", headers);

      const res = await fetch(`${base}/souls/soul-stream-dburl/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "qual e a url do banco?" }),
      });
      assert.equal(res.status, 200);

      const events = await readAllSSEEvents(res);
      const tokenEvents = events.filter((e) => e.type === "token") as Array<{ text: string }>;
      assert.ok(tokenEvents.length > 1, `com trailer > 128 chars o corte no meio do stream TEM que acontecer (veio ${tokenEvents.length} evento(s))`);

      for (const e of tokenEvents) {
        assert.ok(!e.text.includes(dbUrl), `evento token não deveria conter a URL completa: ${JSON.stringify(e.text.slice(0, 80))}`);
        assert.ok(!e.text.includes("SuperSecretPassword123"), `evento token não deveria conter a senha da URL: ${JSON.stringify(e.text.slice(0, 80))}`);
        assert.ok(!e.text.includes("postgres://"), `evento token não deveria conter o esquema cru da URL: ${JSON.stringify(e.text.slice(0, 80))}`);
      }
      const wireText = tokenEvents.map((e) => e.text).join("");
      assert.ok(!wireText.includes(dbUrl), "o texto reconstruído da SSE não deveria conter a URL do banco");
      assert.ok(!wireText.includes("SuperSecretPassword123"), "o texto reconstruído da SSE não deveria conter a senha");
      assert.ok(wireText.includes("[REDACTED_DB_URL]"), `esperava o marcador de redação no texto reconstruído: ${JSON.stringify(wireText.slice(0, 200))}`);
      assert.ok(wireText.includes("palavraxx"), "o texto comum depois do segredo tem que chegar ao cliente normalmente");

      const messagesRes = await fetch(`${base}/souls/soul-stream-dburl/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.ok(!assistantMsg!.content.includes("SuperSecretPassword123"), "a mensagem persistida não deveria conter a senha");
      assert.equal(wireText.trim(), assistantMsg!.content.trim());
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: R2 — provider que só emite {done:true} (nenhum conteúdo real) não vira sucesso sintético '(sem resposta)'", async () => {
  const fake = await startFakeOllama({
    chatChunks: [{ done: true, prompt_eval_count: 3, eval_count: 0 }],
  });
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-empty@exemplo.com");
      createSoul(home, "soul-stream-empty", { name: "soul-stream-empty", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-empty", headers);

      const res = await fetch(`${base}/souls/soul-stream-empty/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "qual e a resposta?" }),
      });
      assert.equal(res.status, 200);

      const events = await readAllSSEEvents(res);
      assert.ok(events.some((e) => e.type === "error"), "esperava {type:'error'} quando o provider não emite conteúdo real");
      assert.ok(!events.some((e) => e.type === "done"), "não deveria haver 'done' — seria uma resposta sintética '(sem resposta)'");
      assert.ok(!events.some((e) => e.type === "token"), "nenhum evento token real deveria ter sido emitido");

      const messagesRes = await fetch(`${base}/souls/soul-stream-empty/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as unknown[];
      assert.equal(messages.length, 0, "nenhuma linha deveria ser persistida — nem a do usuário, nem um '(sem resposta)' sintético");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: N3 — histórico da thread sobrevive à rotação de sessão por ociosidade (120min default)", async () => {
  const { home, cleanup } = await tempHome();
  const chatRequests: any[] = [];
  const fake = await startFakeOllama({
    chatChunks: [{ message: { content: "entendido" } }, { done: true, prompt_eval_count: 1, eval_count: 1 }],
    onChatRequest: (body) => chatRequests.push(body),
  });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  const prevIdleMinutes = process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES;
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-history@exemplo.com");
      createSoul(home, "soul-stream-history", { name: "soul-stream-history", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-history", headers);

      const streamOnce = async (prompt: string) => {
        const r = await fetch(`${base}/souls/soul-stream-history/threads/${threadId}/messages/stream`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        await readAllSSEEvents(r);
      };

      // Turno 1: planta o fato que o turno 3 (pós-rotação) precisa lembrar.
      await streamOnce("meu nome eh Zebra987");

      // Força a sessão a girar em TODA chamada seguinte de openSession — sem
      // isso, esperar 120min de verdade num teste é inviável; 0min faz
      // qualquer intervalo (mesmo poucos ms) contar como "ocioso".
      process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES = "0";

      // Turno 2: sessão já gira aqui (é o próximo openSession depois do ajuste
      // acima) — prova que mesmo girando a cada turno, o histórico por THREAD
      // (não mais por sessão) continua entregando o fato ao provider.
      await streamOnce("qual eh o meu nome?");
      await streamOnce("e agora, qual eh o meu nome?");

      assert.equal(chatRequests.length, 3, "esperava 3 chamadas a /api/chat, uma por turno");
      const systemContentOf = (i: number): string => chatRequests[i]?.messages?.find((m: any) => m.role === "system")?.content ?? "";

      assert.ok(systemContentOf(1).includes("Zebra987"), "turno 2 deveria ver o fato do turno 1 no histórico enviado ao provider");
      assert.ok(
        systemContentOf(2).includes("Zebra987"),
        "turno 3 (pós-rotação de sessão) ainda deveria ver o fato do turno 1 — histórico é por THREAD, não por sessão",
      );

      // GET .../messages continua mostrando a transcrição inteira (nunca
      // escondeu nada — o bug do N3 era só o que o MODELO via, não a UI).
      const messagesRes = await fetch(`${base}/souls/soul-stream-history/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as unknown[];
      assert.equal(messages.length, 6, "3 turnos completos = 6 linhas (user+assistant cada)");
    });
  } finally {
    if (prevIdleMinutes === undefined) delete process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES;
    else process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES = prevIdleMinutes;
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: threads diferentes do mesmo cliente não compartilham histórico (sessão por thread)", async () => {
  const { home, cleanup } = await tempHome();
  const fake = await startFakeOllama({
    chatChunks: [{ message: { content: "ok" } }, { done: true, prompt_eval_count: 1, eval_count: 1 }],
  });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream4@exemplo.com");
      createSoul(home, "soul-stream4", { name: "soul-stream4", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadA = await createThreadViaApi(base, "soul-stream4", headers);
      const threadB = await createThreadViaApi(base, "soul-stream4", headers);

      await fetch(`${base}/souls/soul-stream4/threads/${threadA}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "mensagem só da thread A" }),
      }).then((r) => readAllSSEEvents(r));

      const messagesA = (await fetch(`${base}/souls/soul-stream4/threads/${threadA}/messages`, { headers }).then((r) => r.json())) as any[];
      const messagesB = (await fetch(`${base}/souls/soul-stream4/threads/${threadB}/messages`, { headers }).then((r) => r.json())) as any[];

      assert.equal(messagesA.length, 2, "thread A deve ter as duas linhas do turno (user + assistant)");
      assert.equal(messagesB.length, 0, "thread B não deve ver a mensagem gravada só na thread A");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});
