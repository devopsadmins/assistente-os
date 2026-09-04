import { describe, expect, it, afterEach } from "vitest";
import { SSEFrameParser, type StreamEvent, streamThreadMessage, type ApiClientConfig } from "./stream";
import { startFakeDaemon, type FakeDaemon } from "../test/fakeDaemon";

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

describe("streamThreadMessage", () => {
  let daemon: FakeDaemon;

  afterEach(async () => {
    await daemon?.close();
  });

  it("entrega os eventos step/token/done na ordem, mesmo com o corpo escrito em pedaços pequenos", async () => {
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
    expect(received).toEqual([
      { type: "step", step: "router" },
      { type: "token", text: "ol" },
      { type: "token", text: "á" },
      { type: "done", messageId: 9, usage: { promptTokens: 1, completionTokens: 1, source: "provider" } },
    ]);
  });

  it("resposta não-2xx antes do stream vira um único evento error sintético", async () => {
    daemon = await startFakeDaemon((req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "limite de turnos da sessão atingido" }));
    });
    const config: ApiClientConfig = { baseUrl: daemon.url, token: "dev-token" };
    const received: unknown[] = [];
    await streamThreadMessage(config, "soul-a", 1, "oi", { onEvent: (e) => received.push(e) });
    expect(received).toEqual([{ type: "error", message: "limite de turnos da sessão atingido" }]);
  });
});
