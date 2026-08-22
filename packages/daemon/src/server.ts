import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { statSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runOpenCode, type OpenCodeRunResult } from "./runner.js";
import { browserShutdown } from "./tools/browser.js";
import { loadConfig, getPool, runMigrations, addEvent, logger, sweepRetencaoFamilias } from "@assistente-os/core";
import { processPendingEvents } from "./events.js";
import { processDueAgenda } from "./agenda.js";
import { processEntityExtractionJobs } from "./entityExtraction.js";
import { checkMonitors } from "./monitors.js";
import { VoiceHandler } from "./voice.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";
import { TelegramChannel } from "./channels/telegram.js";
import { sendJson, type RequestContext, type RouteHandler } from "./routes/shared.js";
import { handleSouls } from "./routes/souls.js";
import { handleFamilias } from "./routes/familias.js";
import { handleChat } from "./routes/chat.js";
import { handleEvents } from "./routes/events.js";
import { handleWhatsapp } from "./routes/whatsapp.js";
import { handleTelegram } from "./routes/telegram.js";
import { handleMonitors } from "./routes/monitors.js";
import { handleAgenda } from "./routes/agenda.js";
import { handleInfra } from "./routes/infra.js";
import { handleMemory } from "./routes/memory.js";
import { handleVoice } from "./routes/voice.js";
import { handlePipelines } from "./routes/pipelines.js";
import { handleLlmsTxt } from "./routes/llms-txt.js";

/**
 * Servidor WS mínimo (handshake + enquadramento texto) sobre o mesmo HTTP.
 * Sem dependências: `node:http`/`node:crypto`/`node:net`. Envia eventos JSON
 * a todos os clientes conectados. Frames servidor->cliente são SEM máscara
 * (RFC6455 exige máscara apenas cliente->servidor).
 */
export class WsHub {
  private clients = new Set<Duplex>();
  private server: ReturnType<typeof createServer>;

  /**
   * `token`, se fornecido, exige `?token=` na URL de conexão — o handshake WS
   * do browser não permite headers customizados, então o Bearer usado no
   * fetch() não se aplica aqui. Sem isso, qualquer cliente que alcançasse a
   * porta recebia todos os broadcasts (chat, custos, passos do grafo) mesmo
   * com ASSISTENTE_OS_DAEMON_TOKEN configurado.
   */
  constructor(server: ReturnType<typeof createServer>, token?: string) {
    this.server = server;
    server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"];
      if (typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      if (token && !isWsAuthorized(req, token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
    });
  }

  /** Envia um evento JSON a todos os clientes (sem máscara, como exige o servidor). */
  broadcast(event: Record<string, unknown>): void {
    const frame = encodeTextFrame(JSON.stringify(event));
    for (const client of this.clients) {
      if (client.writable) client.write(frame);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

/** Enquadra um texto em frame WS texto, sem máscara (servidor -> cliente). */
export function encodeTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, "utf8");
  let header: Buffer;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

export interface DaemonOptions {
  port?: number;
  home: string;
  /** Por segurança o daemon só escuta localhost por padrão. */
  host?: string;
  /** Necessário para escutar fora de localhost. Enviado como Bearer token. */
  token?: string;
  /** Injeção para testes; em produção usa runOpenCode. */
  run?: (prompt: string, options: Parameters<typeof runOpenCode>[1]) => Promise<OpenCodeRunResult>;
  /** Diretório com os arquivos estáticos da interface web (padrão: packages/daemon/web). */
  webDir?: string;
  /** Habilita o módulo de voz (padrão: false). */
  voiceEnabled?: boolean;
  /** Habilita o canal WhatsApp via Baileys (padrão: false). */
  whatsappEnabled?: boolean;
  /** Habilita o canal Telegram via Bot API (padrão: false). */
  telegramEnabled?: boolean;
}

export interface DaemonHandle {
  port: number;
  hub: WsHub;
  voice?: VoiceHandler;
  whatsapp?: WhatsAppChannel;
  telegram?: TelegramChannel;
  close: () => Promise<void>;
}

/**
 * Daemon API-first do Assistente OS.
 * Rotas:
 *   GET  /health                -> status + souls
 *   GET  /souls                 -> lista de souls
 *   GET  /souls/:id             -> detalhe da soul
 *   GET  /souls/:id/context     -> perfil/contexto/licoes/pessoas concatenados
 *   POST /souls/:id/chat        -> body { prompt, model?, timeoutSeconds? } roda opencode run headless
 *   GET  /router/status         -> degraus do roteador
 *   GET  /costs                 -> resumo de custos do kernel.db
 * O dispatch por rota vive em ./routes/*.ts, agrupado por domínio; ver handle() abaixo.
 */
export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const { port = 4310, home, host = "127.0.0.1" } = options;
  const token = options.token ?? process.env.ASSISTENTE_OS_DAEMON_TOKEN;
  if (!isLoopback(host) && !token) {
    throw new Error(
      `Recusando iniciar: host="${host}" não é loopback e ASSISTENTE_OS_DAEMON_TOKEN não está configurado — o daemon ficaria exposto sem autenticação. Configure o token ou restrinja host para 127.0.0.1.`,
    );
  }
  const startupConfig = loadConfig({ home });

  // Run migrations with retry logic (non-blocking for web server startup)
  const runMigrationsWithRetry = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const pool = getPool(startupConfig.databaseUrl);
        const applied = await runMigrations(pool);
        if (applied.length > 0) logger.info({ applied }, "migrações do banco aplicadas");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 10) {
          logger.error({ err, attempt }, "falha ao aplicar migrações após 10 tentativas — prosseguindo sem migrações");
          return;
        }
        logger.warn({ attempt, err: msg }, "falha ao conectar no banco — retentativa em 3s");
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  // Start web server first (so /health works even if DB is temporarily unavailable)
  const webDir = options.webDir ?? defaultWebDir();
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, { home, token, run: options.run ?? runOpenCode, hub, webDir, onEventDone, onAgendaDone, voiceHandler, whatsappChannel, telegramChannel });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  const hub = new WsHub(server, token);

  // Run migrations in background (non-blocking)
  runMigrationsWithRetry().catch((err) => {
    logger.error({ err }, "erro inesperado em migrações");
  });

  // Voice handler (opcional)
  let voiceHandler: VoiceHandler | undefined;
  if (options.voiceEnabled) {
    voiceHandler = new VoiceHandler({
      home,
      hub,
      // onChat é definido dinamicamente no /voice/start com a soul do request
    });
  }

  // WhatsApp channel (opcional)
  let whatsappChannel: WhatsAppChannel | undefined;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("daemon não informou uma porta TCP após iniciar");
  }
  const actualPort = address.port;
  const runFn = options.run ?? runOpenCode;

  // WhatsApp channel (inicializado após server listen)
  if (options.whatsappEnabled) {
    logger.info("WhatsApp habilitado — inicializando canal Baileys");
    const config = loadConfig({ home });
    whatsappChannel = new WhatsAppChannel({
      home,
      hub,
      pool: getPool(config.databaseUrl),
      defaultSoul: config.whatsappDefaultSoul,
      soulMap: config.whatsappSoulMap,
      familiasEnabled: config.whatsappFamiliasEnabled,
      addEvent: (input) => addEvent(getPool(config.databaseUrl), input),
      phoneNumber: process.env.WHATSAPP_PHONE ?? undefined,
    });
    void whatsappChannel.start().catch((err) => {
      logger.error({ err }, "falha ao iniciar canal WhatsApp");
    });
  }

  // Telegram channel (opcional)
  let telegramChannel: TelegramChannel | undefined;
  if (options.telegramEnabled) {
    logger.info("Telegram habilitado — inicializando canal Bot API");
    const telegramDefaultSoul = process.env.TELEGRAM_DEFAULT_SOUL || "main";
    const telegramSoulMapStr = process.env.TELEGRAM_SOUL_MAP;
    const telegramSoulMap = telegramSoulMapStr ? JSON.parse(telegramSoulMapStr) : {};
    telegramChannel = new TelegramChannel({
      home,
      hub,
      pool: getPool(process.env.DATABASE_URL || "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"),
      defaultSoul: telegramDefaultSoul,
      soulMap: telegramSoulMap,
      onResponse: async (jid, text) => {
        // Responder via Telegram quando houver aprovação humana
        try {
          if (telegramChannel && telegramChannel.getStatus().connected) {
            await telegramChannel.sendMessage(jid, text);
          }
        } catch (err) {
          console.error("[server] Erro ao enviar resposta Telegram:", err);
        }
      },
    });
    void telegramChannel.start().catch((err) => {
      logger.error({ err }, "falha ao iniciar canal Telegram");
    });
  }

  const onEventDone = (event: { id: number; type: string; soul: string | null; status: string }) => {
    try {
      hub.broadcast({ type: "event.processed", event });
    } catch {
      /* ws opcional */
    }
  };
  const onAgendaDone = (item: { id: number; title: string; soul: string | null; status: string }) => {
    try {
      hub.broadcast({ type: "agenda.processed", item });
    } catch {
      /* ws opcional */
    }
  };
  // Loops de observabilidade em background (unref: não seguram o processo).
  const monitorTimer = setInterval(() => {
    void checkMonitors(home)
      .then((monitors) => {
        try {
          hub.broadcast({ type: "monitor.updated", monitors });
        } catch {
          /* ws opcional */
        }
      })
      .catch(() => {});
  }, 60_000);
  monitorTimer.unref?.();
  const eventTimer = setInterval(() => {
    void processPendingEvents({
      home,
      run: runFn,
      onDone: onEventDone,
      onResponse: whatsappChannel
        ? (eventId, stdout) => void whatsappChannel!.processResponse(eventId, stdout)
        : undefined,
    }).catch(() => {});
  }, 30_000);
  eventTimer.unref?.();
  // Rotina de retenção LGPD (familias): primeira varredura logo após o boot
  // (migrações já aplicadas) e depois uma vez por dia. Exclui em cascata as
  // famílias encerradas cujo retencao_ate venceu — ver ADR-PRIV-001.
  const sweepRetencao = () => {
    const config = loadConfig({ home });
    return sweepRetencaoFamilias(getPool(config.databaseUrl), join(home, "souls"));
  };
  void sweepRetencao()
    .then((purgados) => {
      for (const p of purgados) logger.info({ familiaId: p.familiaId, soulId: p.soulId }, "retenção familias: família eliminada");
    })
    .catch((err) => logger.error({ err }, "sweep de retenção de famílias falhou"));
  const retencaoTimer = setInterval(() => {
    void sweepRetencao()
      .then((purgados) => {
        for (const p of purgados) logger.info({ familiaId: p.familiaId, soulId: p.soulId }, "retenção familias: família eliminada");
      })
      .catch((err) => logger.error({ err }, "sweep de retenção de famílias falhou"));
  }, 86_400_000);
  retencaoTimer.unref?.();
  // Adicionar suporte ao canal Telegram na loop de respostas pendentes
  const telegramResponse = telegramChannel
    ? ((eventId: number, stdout: string) => void telegramChannel!.processResponse(eventId, stdout))
    : undefined;
  const agendaTimer = setInterval(() => {
    void processDueAgenda({ home, run: runFn, onDone: onAgendaDone }).catch(() => {});
  }, 30_000);
  agendaTimer.unref?.();
  const onEntityExtractionDone = (job: { id: number; soul: string; status: string }) => {
    try {
      hub.broadcast({ type: "entity_extraction.processed", job });
    } catch {
      /* ws opcional */
    }
  };
  const entityExtractionTimer = setInterval(() => {
    void processEntityExtractionJobs({ home, onDone: onEntityExtractionDone }).catch(() => {});
  }, 20_000);
  entityExtractionTimer.unref?.();
  return {
    port: actualPort,
    hub,
    voice: voiceHandler,
    whatsapp: whatsappChannel,
    telegram: telegramChannel,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(monitorTimer);
        clearInterval(eventTimer);
        clearInterval(agendaTimer);
        clearInterval(entityExtractionTimer);
        voiceHandler?.stop();
        void whatsappChannel?.stop();
        void telegramChannel?.stop();
        void browserShutdown();
        server.close(() => resolve());
      }),
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// Arquivos estáticos na raiz que o browser busca sozinho (sem header Authorization
// customizado) — precisam ficar fora do middleware de Bearer token, senão o
// manifest e o service worker nunca carregam e a instalação como PWA quebra.
const PUBLIC_ROOT_FILES = new Set(["/manifest.json", "/sw.js"]);

/** Serve arquivo estático da interface web (index.html em /, assets sob /assets). */
function serveStatic(req: IncomingMessage, res: ServerResponse, webDir: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!pathname.startsWith("/assets/") && pathname !== "/" && !PUBLIC_ROOT_FILES.has(pathname)) return false;
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(resolve(webDir, rel));
  const rootPrefix = webDir.endsWith(sep) ? webDir : webDir + sep;
  if (target !== webDir && !target.startsWith(rootPrefix)) {
    sendJson(res, 403, { error: "acesso negado" });
    return true;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    sendJson(res, 404, { error: "não encontrado" });
    return true;
  }
  const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
  const body = readFileSync(target);
  res.writeHead(200, {
    "content-type": type,
    "content-length": body.length,
    "cache-control": pathname === "/" ? "no-cache" : "public, max-age=3600",
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
  return true;
}

/** Rotas por domínio, tentadas nesta ordem; a primeira que responder (retorna true) vence. */
const ROUTE_HANDLERS: RouteHandler[] = [
  handleSouls,
  handleFamilias,
  handleChat,
  handleEvents,
  handleWhatsapp,
  handleTelegram,
  handleMonitors,
  handleAgenda,
  handleInfra,
  handleMemory,
  handleVoice,
  handlePipelines,
  handleLlmsTxt,
];

async function handle(req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> {
  const { token, webDir } = context;
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  logger.info({ method: req.method, path }, "incoming request");

  if (serveStatic(req, res, webDir)) return;

  // Exige Bearer token quando ASSISTENTE_OS_DAEMON_TOKEN está configurado.
  // /health fica público (infra/monitoramento); demais rotas exigem o token.
  if (token && path !== "/health" && !isAuthorized(req, token, path)) {
    sendJson(res, 401, { error: "não autorizado" });
    return;
  }

  for (const handler of ROUTE_HANDLERS) {
    if (await handler(req, res, url, path, context)) return;
  }

  // Fallback original
  sendJson(res, 404, { error: `rota não encontrada: ${req.method} ${path}` });
}

/** Resolve packages/daemon/web a partir deste arquivo (funciona em src/ e dist/). */
function defaultWebDir(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "web");
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function isAuthorized(req: IncomingMessage, token: string, path: string): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const provided = Buffer.from(auth.slice(7), "utf8");
    const expected = Buffer.from(token, "utf8");
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
  }
  // <img>/<audio>/<video> não conseguem mandar Authorization customizado —
  // aceita o token via query string só pra rotas de mídia (não globalmente,
  // pra não vazar o token no log de "incoming request" de toda requisição).
  if (path.includes("/media/")) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const provided = Buffer.from(url.searchParams.get("token") ?? "", "utf8");
    const expected = Buffer.from(token, "utf8");
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

/** Equivalente a isAuthorized() para o handshake WS, que não permite headers customizados. */
function isWsAuthorized(req: IncomingMessage, token: string): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  const provided = Buffer.from(url.searchParams.get("token") ?? "", "utf8");
  const expected = Buffer.from(token, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
