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
