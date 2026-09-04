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

  it("mantém o histórico real da thread mesmo quando send() vence a corrida contra o GET de montagem", async () => {
    daemon = await startFakeDaemon((req, res) => {
      if (req.method === "GET" && req.url === "/souls/soul-a/threads/3/messages") {
        // Atraso deliberado pra garantir que send() vença a corrida.
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify([{ id: 1, role: "user", content: "mensagem antiga", ts: "2026-01-01T00:00:00.000Z" }]));
        }, 50);
        return;
      }
      if (req.method === "POST" && req.url === "/souls/soul-a/threads/3/messages/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"token","text":"nova"}\n\n');
        res.write('data: {"type":"done","messageId":9,"usage":{"promptTokens":1,"completionTokens":1,"source":"provider"}}\n\n');
        res.end();
        return;
      }
      res.writeHead(404, {});
      res.end();
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const { result } = renderHook(() => useThreadStream(config, "soul-a", 3));

    await act(async () => {
      await result.current.send("mensagem nova");
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(3));

    expect(result.current.messages).toMatchObject([
      { kind: "persisted", role: "user", content: "mensagem antiga" },
      { kind: "persisted", role: "user", content: "mensagem nova" },
      { kind: "persisted", role: "assistant", content: "nova" },
    ]);
  });
});
