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
