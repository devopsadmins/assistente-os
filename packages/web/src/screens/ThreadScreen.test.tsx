import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";
import { ThreadScreen } from "./ThreadScreen";
import type { ApiClientConfig } from "../api/client";

let daemon: FakeDaemon;
// Capturado pelo handler, verificado no corpo do teste — ver a mesma nota em
// client.test.ts: uma expect() dentro do handler HTTP fake vira um hang/
// throw não-tratado no servidor em vez de uma falha de teste normal.
let capturedStreamPrompt: string | undefined;

afterEach(async () => {
  await daemon?.close();
});

describe("ThreadScreen", () => {
  it("lista as threads na sidebar, mostra o histórico e envia uma mensagem nova que aparece na tela ao terminar", async () => {
    capturedStreamPrompt = undefined;
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
        capturedStreamPrompt = parsed.prompt;
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
    expect(capturedStreamPrompt).toBe("mensagem nova");
  });
});
