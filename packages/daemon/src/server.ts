import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { statSync, readFileSync, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runOpenCode, type OpenCodeRunResult } from "./runner.js";
import {
  loadConfig,
  getPool,
  runMigrations,
  recordCostCall,
  route,
  anotar,
  registrarLicao,
  decidir,
  getSoul,
  todayISODate,
  sumCostBySoul,
  addEvent,
  recentEvents,
  verifyRequest,
  openSession,
  bumpSessionPrompt,
  recordExecution,
  eventStats,
  listExecutions,
  addMonitor,
  listMonitors,
  deleteMonitor,
  getMonitor,
  addAgendaItem,
  getAgendaItems,
  logger,
  type EventRecord,
  type MonitorRecord,
  type AgendaItem,
  type RouterProbe,
  listarFamilias,
  buscarFamiliaPorId,
  criarFamilia,
  contarFamiliasAtivas,
} from "@assistente-os/core";
import { indexFile, indexStats, search, searchWithVerdict, graphStats, listEntities, listRelations, listObservations, addObservation, getEmbedder } from "@assistente-os/memory";
import { handleUpload } from "./upload.js";
import { buildPrompt } from "./context.js";
import { processPendingEvents } from "./events.js";
import { processDueAgenda } from "./agenda.js";
import { checkMonitors } from "./monitors.js";
import { relevanceRule } from "./relevance.js";
import { VoiceHandler } from "./voice.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";
import { TelegramChannel } from "./channels/telegram.js";
import { sanitizeUserPrompt, sanitizeLLMResponse } from "@assistente-os/core";
import { runLangGraphAgent, runLangGraphAgentStream, probeLangGraph } from "./langgraph-runner.js";
import { routeFromPrompt, type ExecutionMode } from "./orchestrator/router.js";

/**
 * Servidor WS mínimo (handshake + enquadramento texto) sobre o mesmo HTTP.
 * Sem dependências: `node:http`/`node:crypto`/`node:net`. Envia eventos JSON
 * a todos os clientes conectados. Frames servidor->cliente são SEM máscara
 * (RFC6455 exige máscara apenas cliente->servidor).
 */
export class WsHub {
  private clients = new Set<Duplex>();
  private server: ReturnType<typeof createServer>;

  constructor(server: ReturnType<typeof createServer>) {
    this.server = server;
    server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"];
      if (typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
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
 */
export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const { port = 4310, home, host = "127.0.0.1" } = options;
  const token = options.token ?? process.env.ASSISTENTE_OS_DAEMON_TOKEN;
  if (!isLoopback(host) && !token) {
    logger.warn("AVISO: Daemon escutando fora de localhost sem ASSISTENTE_OS_DAEMON_TOKEN configurado. Certifique-se de que está protegido por um proxy/tunnel.");
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
  const hub = new WsHub(server);

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
  // Adicionar suporte ao canal Telegram na loop de respostas pendentes
  const telegramResponse = telegramChannel
    ? ((eventId: number, stdout: string) => void telegramChannel!.processResponse(eventId, stdout))
    : undefined;
  const agendaTimer = setInterval(() => {
    void processDueAgenda({ home, run: runFn, onDone: onAgendaDone }).catch(() => {});
  }, 30_000);
  agendaTimer.unref?.();
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
        voiceHandler?.stop();
        void whatsappChannel?.stop();
        void telegramChannel?.stop();
        server.close(() => resolve());
      }),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * Sonda barata e segura de repetir (não executa o prompt): só o degrau `local`
 * (provider "ollama") tem um jeito de checar disponibilidade sem custo —
 * `GET /api/tags` não roda inferência. Degraus `zen`/`soul` não têm um health
 * check equivalente pelo daemon (dependem do provider configurado no
 * opencode.json), então são considerados disponíveis; falhas reais neles só
 * aparecem na execução de fato (após route() já ter escolhido o degrau).
 */
function makeLocalFallbackProbe(ollamaUrl: string): RouterProbe {
  return async (target) => {
    if (target.provider !== "ollama") return { ok: true };
    let baseUrl = ollamaUrl;
    if (baseUrl.includes("host.docker.internal")) {
      baseUrl = baseUrl.replace("host.docker.internal", "192.168.65.254");
    }
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * Chama o /api/chat do Ollama via node:http. O fetch() do Node (undici) aborta
 * com "fetch failed" após 300s aguardando os headers da resposta — tempo que um
 * modelo local em CPU pode exceder só no prompt eval. Aqui o único limite é o
 * timeoutMs do chamador (o timeoutSeconds da requisição de chat).
 */
function ollamaChat(
  baseUrl: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    let url: URL;
    try {
      url = new URL("/api/chat", baseUrl);
    } catch {
      resolvePromise({ code: 1, stdout: "", stderr: `OLLAMA_URL inválida: ${baseUrl}`, timedOut: false });
      return;
    }
    const body = JSON.stringify(payload);
    let timedOut = false;
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            resolvePromise({ code: 1, stdout: "", stderr: `Ollama HTTP ${res.statusCode}: ${data.slice(0, 300)}`, timedOut: false });
            return;
          }
          try {
            const parsed = JSON.parse(data) as { message?: { content?: string } };
            resolvePromise({ code: 0, stdout: parsed.message?.content || "(sem resposta)", stderr: "", timedOut: false });
          } catch {
            resolvePromise({ code: 1, stdout: "", stderr: `resposta inválida do Ollama: ${data.slice(0, 200)}`, timedOut: false });
          }
        });
      },
    );
    // Resposta não-streaming: nenhum byte chega antes da resposta completa,
    // então o timeout de inatividade do socket equivale ao timeout total.
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy(new Error(`Ollama não respondeu em ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on("error", (err) => resolvePromise({ code: 1, stdout: "", stderr: err.message, timedOut }));
    req.end(body);
  });
}

interface RequestContext {
  home: string;
  token?: string;
  run: DaemonOptions["run"];
  hub: WsHub;
  webDir: string;
  onEventDone: (event: { id: number; type: string; soul: string | null; status: string }) => void;
  onAgendaDone: (item: { id: number; title: string; soul: string | null; status: string }) => void;
  voiceHandler?: VoiceHandler;
  whatsappChannel?: WhatsAppChannel;
  telegramChannel?: TelegramChannel;
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

/** Serve arquivo estático da interface web (index.html em /, assets sob /assets). */
function serveStatic(req: IncomingMessage, res: ServerResponse, webDir: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!pathname.startsWith("/assets/") && pathname !== "/") return false;
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

async function handle(req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> {
  const { home, token, run, hub, webDir, onEventDone, onAgendaDone, voiceHandler, whatsappChannel, telegramChannel } = context;
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  logger.info({ method: req.method, path }, "incoming request");

  if (serveStatic(req, res, webDir)) return;

  // Autenticação dispensada temporariamente (requisições livres).
// Para reativar, descomente a verificação original em isAuthorized().
// Se precisar de controle mais granular, defina ASSISTENTE_OS_DAEMON_TOKEN
// e use o modo original com Bearer header.

  if (req.method === "GET" && path === "/health") {
    const { listSouls } = await import("@assistente-os/core");
    sendJson(res, 200, { ok: true, service: "assistente-os", souls: listSouls(home).map((s) => s.id) });
    return;
  }

  if (req.method === "GET" && path === "/souls") {
    const { listSouls } = await import("@assistente-os/core");
    sendJson(res, 200, listSouls(home).map((s) => ({ id: s.id, config: s.config })));
    return;
  }

  if (req.method === "GET" && path === "/costs") {
    const { loadConfig, listSouls, recentCalls } = await import("@assistente-os/core");
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const bySoul: Record<string, number> = {};
    for (const soul of listSouls(home)) bySoul[soul.id] = await sumCostBySoul(pool, soul.id);
    sendJson(res, 200, { bySoul, recent: await recentCalls(pool, "main", 10) });
    return;
  }

  if (req.method === "GET" && path === "/sessions/stats") {
    const { loadConfig, countSessions } = await import("@assistente-os/core");
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, { total: await countSessions(pool) });
    return;
  }

  if (req.method === "GET" && path === "/familias") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const statusFilter = new URL(req.url ?? "", "http://localhost").searchParams.get("status") ?? undefined;
    const familias = await listarFamilias(pool, statusFilter);
    const ativas = await contarFamiliasAtivas(pool);
    sendJson(res, 200, { total: familias.length, ativas, familias });
    return;
  }

  const familiaMatch = path.match(/^\/familias\/(\d+)$/);
  if (familiaMatch && req.method === "GET") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const id = Number(familiaMatch[1]);
    const familia = await buscarFamiliaPorId(pool, id);
    if (!familia) return sendJson(res, 404, { error: "família não encontrada" });
    sendJson(res, 200, familia);
    return;
  }

  if (req.method === "POST" && path === "/familias") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    let rawBody = "";
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", async () => {
      try {
        const { telefone, nomeFamilia, nomeCrianca } = JSON.parse(rawBody) as {
          telefone?: string;
          nomeFamilia?: string;
          nomeCrianca?: string;
        };
        if (!telefone || !nomeFamilia) {
          return sendJson(res, 400, { error: "telefone e nomeFamilia são obrigatórios" });
        }
        const ativas = await contarFamiliasAtivas(pool);
        if (ativas >= 10) {
          return sendJson(res, 429, { error: "limite de famílias atingido", limite: 10, ativas });
        }
        try {
          const familia = await criarFamilia(pool, telefone, nomeFamilia, nomeCrianca);
          sendJson(res, 201, familia);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("unique")) {
            return sendJson(res, 409, { error: "telefone já cadastrado" });
          }
          throw err;
        }
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return;
  }

  const onboardingMatch = path.match(/^\/familias\/(\d+)\/onboarding$/);
  if (onboardingMatch && req.method === "GET") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const id = Number(onboardingMatch[1]);
    const familia = await buscarFamiliaPorId(pool, id);
    if (!familia) return sendJson(res, 404, { error: "família não encontrada" });
    const phaseNames = ["infanto-juvenil", "psicoterapia-familiar"];
    const currentPhase = familia.anamnesePhase;
    const isComplete = currentPhase >= 2;
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, familia.soulId);
    sendJson(res, 200, {
      familia,
      phase: currentPhase,
      phaseName: phaseNames[currentPhase] ?? "concluido",
      complete: isComplete,
      soulExists: !!soul,
    });
    return;
  }

  const soulMatch = path.match(/^\/souls\/([^/]+)$/);
  if (soulMatch && req.method === "GET") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(soulMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    sendJson(res, 200, soul);
    return;
  }

  const contextMatch = path.match(/^\/souls\/([^/]+)\/context$/);
  if (contextMatch && req.method === "GET") {
    const { getSoul } = await import("@assistente-os/core");
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const soul = getSoul(home, decodeURIComponent(contextMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    const files = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"];
    const parts: string[] = [];
    for (const f of files) {
      const p = join(soul.dir, f);
      if (existsSync(p)) parts.push(`# ${f}\n\n${readFileSync(p, "utf8")}`);
    }
    sendJson(res, 200, { soul: soul.id, context: parts.join("\n\n") });
    return;
  }

  const bufferMatch = path.match(/^\/souls\/([^/]+)\/buffer$/);
  if (bufferMatch && req.method === "GET") {
    const soul = getSoul(home, decodeURIComponent(bufferMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
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
    return;
  }

  const chatMatch = path.match(/^\/souls\/([^/]+)\/chat$/);
  if (chatMatch && req.method === "POST") {
    const parsed = await readJson(req);
    if (parsed.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (parsed.error === "invalid") return sendJson(res, 400, { error: "JSON inválido" });
    const body = parsed.body;
    const prompt = body && typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) return sendJson(res, 400, { error: "prompt é obrigatório" });
    const timeoutSeconds = body && typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : 300;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) {
      return sendJson(res, 400, { error: "timeoutSeconds deve ser um inteiro entre 1 e 600" });
    }
    const requestedModel = body && typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const requestedTier = body && typeof body.tier === "string" && body.tier.trim() ? body.tier.trim() : undefined;
    const explicitMode: ExecutionMode | undefined = body?.mode === "fast" || body?.mode === "pro" ? body.mode : undefined;
    const langgraphMode: string | undefined = typeof body?.langgraphMode === "string" ? body.langgraphMode : undefined;
    const memorizar = body && body.memorizar === true;
    const soul = getSoul(home, decodeURIComponent(chatMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });

    const config = await loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    {
      // ---- Limites: teto diário de custo e turnos por sessão ----
      const dailyLimit = soul.config.dailyLimit;
      const maxTurns = soul.config.agent?.guardrails?.maxTurns ?? soul.config.maxTurns ?? config.defaultMaxTurns;
      const spentToday = await sumCostBySoul(pool, soul.id, todayISODate());
      if (dailyLimit !== undefined && spentToday >= dailyLimit) {
        return sendJson(res, 429, { error: "teto diário de gastos atingido", limit: dailyLimit, spent: spentToday });
      }
      const session = await openSession(pool, soul.id, maxTurns, dailyLimit);
      if (session.promptCount >= session.maxTurns) {
        return sendJson(res, 429, { error: "limite de turnos da sessão atingido", maxTurns: session.maxTurns, prompts: session.promptCount });
      }
      const promptsUsed = await bumpSessionPrompt(pool, session.id);

      // ---- Sanitização de secrets no prompt do usuário ----
      const promptSanitized = sanitizeUserPrompt(prompt, { taskId: String(session.id), soulId: soul.id });
      if (promptSanitized.count > 0) {
        logger.warn(`[content-filter] ${promptSanitized.count} secret(s) detectado(s) no prompt da soul ${soul.id}`);
      }

      // ---- Buffer da soul: contexto persistente + RAG com gate de relevância ----
      const built = await buildPrompt({ home, soul, prompt: promptSanitized.sanitized, config });

      // route() sonda cada degrau (sem executar o prompt) e cai para o próximo se o
      // degrau local não responder; a execução real acontece uma única vez, abaixo,
      // no degrau vencedor.
      const orchDecision = await routeFromPrompt(pool, config, soul, promptSanitized.sanitized, makeLocalFallbackProbe(config.ollamaUrl), explicitMode);
      const decision = orchDecision.route;
      const model = requestedModel ?? orchDecision.model;
    const tier = requestedTier ?? decision.target.tier;
      const startedAt = Date.now();
      let result: { code: number; stdout: string; stderr: string; timedOut: boolean; toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }> };
      if (decision.target.provider === "ollama") {
        let baseUrl = config.ollamaUrl;
        if (baseUrl.includes("host.docker.internal")) {
          baseUrl = baseUrl.replace("host.docker.internal", "192.168.65.254");
        }
        
        const ollamaModel = (requestedModel ?? decision.target.model).replace(/^openai\//, "");
        result = await ollamaChat(
          baseUrl,
          {
            model: ollamaModel,
            messages: [
              { role: "system", content: built.fullPrompt.replace(prompt, "").trim() },
              { role: "user", content: prompt },
            ],
            stream: false,
          },
          timeoutSeconds * 1000,
        );
      } else if (decision.target.provider === "langgraph") {
        result = await runLangGraphAgentStream(pool, {
          soul: soul.id,
          prompt: promptSanitized.sanitized,
          timeoutSeconds,
          useTools: langgraphMode !== "generate",
          onStep: (step: { node: string; iterationCount: number; messageCount: number; lastContent?: string; toolCalls?: any[] }) => {
            try {
              hub.broadcast({
                type: "graph.step",
                soul: soul.id,
                node: step.node,
                iterationCount: step.iterationCount,
                messageCount: step.messageCount,
                lastContent: step.lastContent,
                toolCalls: step.toolCalls,
              });
            } catch {
              /* ws opcional */
            }
          },
        });
      } else {
        const env = { ...(process.env as Record<string, string>) };
        result = await run!(built.fullPrompt, {
          cwd: soul.dir,
          model,
          timeoutSeconds,
          agent: soul.config.agent ? soul.id : undefined,
          soulId: soul.id,
          env,
        });
      }
      await recordCostCall(pool, {
        soul: soul.id,
        provider: decision.target.provider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `tier=${tier}; latency_ms=${Date.now() - startedAt}`,
      });
      await recordExecution(pool, {
        sessionId: session.id,
        soul: soul.id,
        kind: "chat",
        promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
        model,
        tier: tier,
        filesLoaded: built.files.filter((f) => f.chars > 0).length,
        contextChars: built.contextChars,
        verdict: built.verdict == null ? undefined : JSON.stringify(built.verdict),
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `latency_ms=${Date.now() - startedAt}`,
      });
      // evento WS de conclusão (fire-and-forget; não bloqueia a resposta)
      try {
        hub.broadcast({ type: "chat.done", soul: soul.id, code: result.code, timedOut: result.timedOut, tier: tier });
      } catch {
        /* ws opcional */
      }

      // Write-back opt-in: memorizar=true persiste um resumo da interação na sessão do dia.
      // Nunca grava sobre falhas/timeout (result.code !== 0 || timedOut).
      let memorizado = false;
      if (memorizar && result.code === 0 && !result.timedOut) {
        try {
          anotar(soul.dir, `Interação: ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`);
          memorizado = true;
        } catch {
          /* fall-through: chat responde mesmo se o write-back falhar */
        }
      }

      // ---- Sanitização de secrets na resposta do LLM ----
      const responseSanitized = sanitizeLLMResponse(result.stdout, { taskId: String(session.id), soulId: soul.id });
      if (responseSanitized.count > 0) {
        logger.warn(`[content-filter] ${responseSanitized.count} secret(s) detectado(s) na resposta da soul ${soul.id}`);
      }
      const sanitizedStdout = responseSanitized.sanitized;

      sendJson(res, 200, {
        ok: result.code === 0 && !result.timedOut,
        soul: soul.id,
        model,
        tier: tier,
        mode: orchDecision.mode,
        code: result.code,
        timedOut: result.timedOut,
        stdout: sanitizedStdout.slice(-2000),
        stderr: result.stderr.slice(-1000),
        routerReason: decision.reason,
        ragVerdict: built.verdict,
        memorizado,
        limit: { dailyLimit: dailyLimit ?? null, spentToday, maxTurns, prompts: promptsUsed },
        contentFilter: responseSanitized.count > 0 ? { detected: responseSanitized.count } : undefined,
        toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
      });
    }
    return;
}

// ----- Endpoints LangGraph ──────────────────────────────────────────
  // /souls/:soul/langgraph/status - status do grafo
  // /souls/:soul/langgraph/history - histórico de execução
  const lgSoulMatch = path.match(/^\/souls\/([^/]+)\/langgraph\//);
  if (lgSoulMatch && (req.url?.includes("/langgraph/status") || req.url?.includes("/langgraph/history"))) {
    const soulId = decodeURIComponent(lgSoulMatch[1]!);
    const home = context.home;
    const { loadConfig } = await import("@assistente-os/core");
    const cfg = loadConfig({ home });
    const { getSoul } = await import("@assistente-os/core");
    const { probeLangGraph } = await import("./langgraph-runner.js");
    const ollamaUrl = cfg.ollamaUrl || "http://127.0.0.1:11434/v1";
    const probe = await probeLangGraph(ollamaUrl);

    if (req.url?.includes("/langgraph/status")) {
      const soul = getSoul(home, soulId);
      if (!soul) return sendJson(res, 404, { error: "Soul não encontrada" });
      sendJson(res, 200, {
        ok: true,
        soul: soul.id,
        ollamaAvailable: probe.ok,
        mode: soul.config.models?.chat || "auto",
        maxIterations: soul.config.agent?.guardrails?.maxIterations ?? 5,
      });
      return;
    }

    if (req.url?.includes("/langgraph/history")) {
      // TODO: histórico real seria armazenado em checkpoint do LangGraph
      // Por enquanto retorna dados mockados indicando suporte
      sendJson(res, 200, {
        ok: true,
        soul: soulId,
        steps: [],
        message: "Histórico em breve - requires LangGraph checkpointer persistence",
      });
      return;
    }
  }

  // ----- Webhooks assinados: fila de eventos processados em background -----
  if (req.method === "POST" && path === "/events") {
    const config = loadConfig({ home });
    if (!config.webhookSecret) {
      return sendJson(res, 503, { error: "ASSISTENTE_OS_WEBHOOK_SECRET não configurado; HMAC é obrigatório" });
    }
    const raw = await readRawBody(req);
    if (raw.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (raw.error === "invalid") return sendJson(res, 400, { error: "leitura do body falhou" });
    const bodyBuffer = raw.body ?? Buffer.alloc(0);
    const signature = req.headers["x-aos-signature"];
    const ts = req.headers["x-aos-timestamp"];
    const verified = verifyRequest(config.webhookSecret, bodyBuffer, signature as string | undefined, ts as string | undefined);
    if (!verified.ok) return sendJson(res, 401, { error: verified.reason });
    let body: { type?: unknown; payload?: unknown; soul?: unknown };
    try {
      body = JSON.parse(bodyBuffer.toString("utf8")) as { type?: unknown; payload?: unknown; soul?: unknown };
    } catch {
      return sendJson(res, 400, { error: "JSON inválido" });
    }
    const type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : "";
    if (!type) return sendJson(res, 400, { error: "type é obrigatório" });
    const soul = typeof body.soul === "string" ? body.soul : null;
    const pool = getPool(config.databaseUrl);
    const ev: EventRecord = await addEvent(pool, { type, payload: body.payload, soul, signature: String(signature) });
    // Consumo imediato em background; o loop periódico cobre reinícios/atrasos.
    setImmediate(() => {
      void processPendingEvents({ home, run, onDone: onEventDone }).catch(() => {});
    });
    try {
      hub.broadcast({ type: "event.received", event: ev });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 202, { id: ev.id, status: ev.status, type: ev.type, soul: ev.soul });
    return;
  }

  if (req.method === "GET" && path === "/events") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, { stats: await eventStats(pool), recent: await recentEvents(pool, 20) });
    return;
  }

  // ── WhatsApp: histórico de mensagens ─────────────────────────────────
  if (req.method === "GET" && path === "/api/whatsapp/messages") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const limit = Math.min(Number(new URL(req.url!, `http://${req.headers.host}`).searchParams.get("limit")) || 100, 500);
    const { rows } = await pool.query(
      "SELECT id, ts, payload, soul, status FROM events WHERE type = 'whatsapp.message' ORDER BY id DESC LIMIT $1",
      [limit],
    );
    sendJson(res, 200, rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      payload: r.payload,
      soul: r.soul,
      status: r.status,
    })));
    return;
  }

  // ── WhatsApp: status do canal ────────────────────────────────────────
  if (req.method === "GET" && path === "/api/whatsapp/status") {
    if (!context.whatsappChannel) {
      sendJson(res, 200, { connected: false, phone: null, jid: null });
      return;
    }
    sendJson(res, 200, context.whatsappChannel.getStatus());
    return;
  }

  // ── Telegram: status do canal ────────────────────────────────────────
  if (req.method === "GET" && path === "/api/telegram/status") {
    if (!context.telegramChannel) {
      sendJson(res, 200, { connected: false, username: null, jid: null });
      return;
    }
    sendJson(res, 200, context.telegramChannel.getStatus());
    return;
  }

  // ── WhatsApp: enviar mensagem ────────────────────────────────────────
  if (req.method === "POST" && path === "/api/whatsapp/send") {
    if (!context.whatsappChannel) {
      sendJson(res, 503, { error: "canal WhatsApp não habilitado" });
      return;
    }
    const { body } = await readJson(req);
    const jid = body?.jid as string | undefined;
    const text = body?.text as string | undefined;
    if (!jid || !text) {
      sendJson(res, 400, { error: "jid e text obrigatórios" });
      return;
    }
    const ok = await context.whatsappChannel.sendMessage(jid, text);
    sendJson(res, ok ? 200 : 500, { ok });
    return;
  }

  // ── Telegram: enviar mensagem ────────────────────────────────────────
  if (req.method === "POST" && path === "/api/telegram/send") {
    if (!context.telegramChannel) {
      sendJson(res, 503, { error: "canal Telegram não habilitado" });
      return;
    }
    const { body } = await readJson(req);
    const chatId = body?.chatId as string | number | undefined;
    const text = body?.text as string | undefined;
    if (!chatId || !text) {
      sendJson(res, 400, { error: "chatId e text obrigatórios" });
      return;
    }
    const ok = await context.telegramChannel.sendMessage(chatId, text);
    sendJson(res, ok ? 200 : 500, { ok });
    return;
  }

  // ── WhatsApp: servir mídia ──────────────────────────────────────────
  if (req.method === "GET" && path.startsWith("/api/whatsapp/media/")) {
    const filename = path.slice("/api/whatsapp/media/".length);
    if (!filename || filename.includes("..")) {
      sendJson(res, 400, { error: "filename inválido" });
      return;
    }
    const config = loadConfig({ home });
    const mediaPath = join(config.home, "media", "whatsapp", normalize(filename));
    if (!existsSync(mediaPath)) {
      sendJson(res, 404, { error: "mídia não encontrada" });
      return;
    }
    const s = statSync(mediaPath);
    const ext = extname(mediaPath).toLowerCase();
    const types: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
      ".gif": "image/gif", ".webp": "image/webp", ".ogg": "audio/ogg",
      ".opus": "audio/ogg", ".mp4": "video/mp4", ".pdf": "application/pdf",
    };
    res.writeHead(200, {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Content-Length": s.size,
      "Cache-Control": "public, max-age=3600",
    });
    const { createReadStream } = await import("node:fs");
    createReadStream(mediaPath).pipe(res);
    return;
  }

  // ── WhatsApp: transcrever áudio ────────────────────────────────────
  if (req.method === "POST" && path === "/api/whatsapp/transcribe") {
    const { body } = await readJson(req);
    const eventId = body?.eventId as number | undefined;
    if (!eventId) {
      sendJson(res, 400, { error: "eventId obrigatório" });
      return;
    }
    try {
      const { execSync } = await import("node:child_process");
      try { execSync("which ffmpeg", { stdio: "ignore" }); } catch {
        try { execSync("/home/support/bin/ffmpeg -version", { stdio: "ignore" }); } catch {
          sendJson(res, 501, { error: "ffmpeg não instalado — apt install ffmpeg" });
          return;
        }
      }
    } catch {
      sendJson(res, 501, { error: "ffmpeg não instalado — apt install ffmpeg" });
      return;
    }
    try {
      const { execSync } = await import("node:child_process");
      const config = loadConfig({ home });
      const pool = getPool(config.databaseUrl);
      const { rows } = await pool.query(
        "SELECT payload FROM events WHERE id = $1",
        [eventId],
      );
      if (!rows.length) { sendJson(res, 404, { error: "evento não encontrado" }); return; }
      const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload as string) : rows[0].payload as Record<string, unknown>;
      if (payload.mediaType !== "audio" || !payload.mediaFile) {
        sendJson(res, 400, { error: "evento não é áudio" }); return;
      }
      const oggPath = join(config.home, "media", "whatsapp", payload.mediaFile as string);
      const wavPath = oggPath.replace(/\.\w+$/, ".wav");
      let ffmpegCmd = "ffmpeg";
      try { require("node:child_process").execSync("which ffmpeg", { stdio: "ignore" }); } catch {
        ffmpegCmd = "/home/support/bin/ffmpeg";
      }
      execSync(`${ffmpegCmd} -y -i "${oggPath}" -ar 16000 -ac 1 -f f32le "${wavPath}" 2>/dev/null`);
      const { readFileSync, unlinkSync } = await import("node:fs");
      const pcm = readFileSync(wavPath);
      const { SpeechToText } = await import("@assistente-os/voice");
      const stt = new SpeechToText({ model: "base", language: "pt" });
      await stt.load();
      const result = await stt.transcribe(pcm, 16000);
      try { unlinkSync(wavPath); } catch {}
      payload.transcription = result;
      if (!payload.body || payload.body === "[audio]") payload.body = result;
      await pool.query("UPDATE events SET payload = $1 WHERE id = $2", [JSON.stringify(payload), eventId]);
      sendJson(res, 200, { transcription: result });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // ----- Observabilidade: sites monitorados (up/down configurável na UI) -----
  if (req.method === "GET" && path === "/monitors") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, await listMonitors(pool));
    return;
  }

  if (req.method === "POST" && path === "/monitors") {
    const parsed = await readJson(req);
    if (parsed.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (parsed.error === "invalid") return sendJson(res, 400, { error: "JSON inválido" });
    const body = parsed.body ?? {};
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
    const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";
    if (!name || !url) return sendJson(res, 400, { error: "name e url são obrigatórios" });
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return sendJson(res, 400, { error: "url inválida" });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return sendJson(res, 400, { error: "url deve usar http(s)" });
    }
    const expectedCode = body && typeof body.expectedCode === "number" ? Math.floor(body.expectedCode) : 200;
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const monitor = await addMonitor(pool, { name, url, expectedCode });
    try {
      hub.broadcast({ type: "monitor.added", monitor });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 201, monitor);
    return;
  }

  if (req.method === "POST" && path === "/monitors/check") {
    const monitors = await checkMonitors(home);
    try {
      hub.broadcast({ type: "monitor.updated", monitors });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 200, { ok: true, checked: monitors.length, monitors });
    return;
  }

  const monitorDeleteMatch = path.match(/^\/monitors\/([^/]+)$/);
  if (monitorDeleteMatch && req.method === "DELETE") {
    const id = Number(monitorDeleteMatch[1]);
    if (!Number.isInteger(id) || id < 1) return sendJson(res, 400, { error: "id inválido" });
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const existing = await getMonitor(pool, id);
    if (!existing) return sendJson(res, 404, { error: "monitor não encontrado" });
    await deleteMonitor(pool, id);
    try {
      hub.broadcast({ type: "monitor.deleted", id });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 200, { ok: true, deleted: id });
    return;
  }

  // ----- Agendador (F2): fila de tarefas com due_at, despachada via opencode run -----
  if (req.method === "GET" && path === "/agenda") {
    const filter = url.searchParams.get("status");
    const doneFilter = filter === "done" || filter === "all" ? filter : "pending";
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, await getAgendaItems(pool, doneFilter));
    return;
  }

  if (req.method === "POST" && path === "/agenda") {
    const parsed = await readJson(req);
    if (parsed.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (parsed.error === "invalid") return sendJson(res, 400, { error: "JSON inválido" });
    const body = parsed.body ?? {};
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "";
    if (!title) return sendJson(res, 400, { error: "title é obrigatório" });
    const soul = typeof body.soul === "string" && body.soul.trim() ? body.soul.trim() : null;
    const itemBody = typeof body.body === "string" && body.body.trim() ? body.body.trim() : null;
    const dueAt = typeof body.due_at === "string" && body.due_at.trim() ? body.due_at.trim() : null;
    if (soul) {
      const { getSoul } = await import("@assistente-os/core");
      if (!getSoul(home, soul)) return sendJson(res, 404, { error: `soul não encontrada: ${soul}` });
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const item: AgendaItem = await addAgendaItem(pool, soul, title, itemBody, dueAt);
    // Despacho imediato em background se já vencido; o loop periódico cobre reinícios/atrasos.
    setImmediate(() => {
      void processDueAgenda({ home, run, onDone: onAgendaDone }).catch(() => {});
    });
    try {
      hub.broadcast({ type: "agenda.added", item });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 201, item);
    return;
  }

  if (req.method === "GET" && path === "/infra/status") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const { listSouls } = await import("@assistente-os/core");
    const souls = listSouls(home).map((s) => s.id);

    /* --- Ollama --- */
    let ollamaOk = false;
    let ollamaLatencyMs: number | null = null;
    let ollamaModels = 0;
    try {
      const t0 = Date.now();
      const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      ollamaOk = r.ok;
      ollamaLatencyMs = Date.now() - t0;
      if (r.ok) {
        const data = (await r.json()) as { models?: unknown[] };
        ollamaModels = data.models?.length ?? 0;
      }
    } catch {
      ollamaOk = false;
    }

    /* --- Postgres --- */
    const { rows: sizeRows } = await pool.query<{ bytes: string }>("SELECT pg_database_size(current_database()) AS bytes");
    const pgKernelBytes = Number(sizeRows[0]?.bytes ?? 0);
    let pgVersion = "";
    let pgTables = 0;
    let pgConnections = 0;
    try {
      const [verRows, tblRows, connRows] = await Promise.all([
        pool.query<{ version: string }>("SELECT version() AS version"),
        pool.query<{ count: string }>("SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public'"),
        pool.query<{ count: string }>("SELECT count(*) AS count FROM pg_stat_activity WHERE state = 'active'"),
      ]);
      pgVersion = verRows.rows[0]?.version ?? "";
      pgTables = Number(tblRows.rows[0]?.count ?? 0);
      pgConnections = Number(connRows.rows[0]?.count ?? 0);
    } catch {
      /* best-effort */
    }

    /* --- memory.db (SQLite fallback file) --- */
    let memoryBytes = 0;
    try {
      const sqlitePath = join(home, "memory.db");
      if (existsSync(sqlitePath)) {
        const st = await stat(sqlitePath);
        memoryBytes = st.size;
      }
    } catch {
      /* ignore */
    }

    /* --- Linux / sistema --- */
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    const cpuModel = cpus[0]?.model ?? "unknown";
    const loadAvg = os.loadavg(); // [1min, 5min, 15min]
    const ramTotal = os.totalmem();
    const ramFree = os.freemem();
    const ramUsed = ramTotal - ramFree;
    const cpuPercent = cpuCount > 0 ? Math.round(((loadAvg[0] ?? 0) / cpuCount) * 1000) / 10 : 0;
    let diskUsed = 0;
    let diskTotal = 0;
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync("df", ["-B1", "/"]);
      const lines = stdout.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1]!.trim().split(/\s+/);
        diskTotal = Number(parts[1]) || 0;
        diskUsed = Number(parts[2]) || 0;
      }
    } catch {
      /* ignore */
    }

    /* --- RAG --- */
    let ragChunks = 0;
    try {
      const { rows: chunkRows } = await pool.query<{ count: string }>("SELECT count(*) AS count FROM chunks");
      ragChunks = Number(chunkRows[0]?.count ?? 0);
    } catch {
      /* chunks table may not exist yet */
    }

    sendJson(res, 200, {
      ok: true,
      service: "assistente-os",
      ts: new Date().toISOString(),
      daemon: { tier: "local" },
      souls: { total: souls.length, ids: souls },
      ollama: { ok: ollamaOk, url: config.ollamaUrl, latencyMs: ollamaLatencyMs, models: ollamaModels },
      databases: { kernelBytes: pgKernelBytes, memoryBytes },
      postgres: { version: pgVersion, tables: pgTables, connections: pgConnections },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        uptime: Math.round(os.uptime()),
        cpuModel,
        cpuCount,
        cpuPercent,
        loadAvg: loadAvg.map((v) => Math.round(v * 100) / 100),
        ramUsed,
        ramTotal,
        diskUsed,
        diskTotal,
      },
      rag: { chunks: ragChunks },
      router: { tiers: config.routerTiers },
      events: await eventStats(pool),
      monitors: await listMonitors(pool),
      executions: await listExecutions(pool, undefined, 5),
    });
    return;
  }

  if (req.method === "GET" && path === "/router/status") {
    const { loadConfig } = await import("@assistente-os/core");
    const config = loadConfig({ home });
    sendJson(res, 200, { tiers: config.routerTiers, ollamaUrl: config.ollamaUrl });
    return;
  }

  const memoryMatch = path.match(/^\/souls\/([^/]+)\/memory\/status$/);
  if (memoryMatch && req.method === "GET") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(memoryMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, { soul: soul.id, chunks: await indexStats(pool, soul.id), graph: await graphStats(pool, soul.id) });
    return;
  }

  const memorySearchMatch = path.match(/^\/souls\/([^/]+)\/memory\/search$/);
  if (memorySearchMatch && req.method === "POST") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(memorySearchMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    const parsed = await readJson(req);
    if (parsed.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (parsed.error === "invalid") return sendJson(res, 400, { error: "JSON inválido" });
    const body = parsed.body;
    const query = body && typeof body.query === "string" && body.query.trim() ? body.query.trim() : "";
    if (!query) return sendJson(res, 400, { error: "query é obrigatório" });
    const limit = body && typeof body.limit === "number" ? Math.max(1, Math.min(20, body.limit)) : 5;
    const rawMinScore = body && typeof body.minScore === "number" ? Math.max(0, Math.min(1, body.minScore)) : 0.3;
// Map slider [0,1] to threshold [0.1, 0.5] — more permissive: slider 0 = 0.1, slider 1 = 0.5
// This allows low-relevance results like "dimastec" to appear while still filtering
const minScore = rawMinScore * 0.4 + 0.1;
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const embedder = getEmbedder();
    const { results, verdict } = await searchWithVerdict(pool, soul.id, query, embedder, relevanceRule(), limit, minScore);
    // Se o gate de relevância recusou (ok=false), filtra resultados por score >= minScore
    const scoreThreshold = minScore || 0.3;
    const filteredResults = verdict.ok
      ? results
      : results.filter((r) => r.score && r.score >= scoreThreshold);
    const payload = {
      soul: soul.id,
      query,
      verdict,
      results: filteredResults.map((r) => ({ doc: r.docKey, path: r.path, score: r.score, method: r.method, snippet: r.body.slice(0, 300) })),
    };
    // modo "recusar" + gate fechado -> 409 para que clientes saibam que a busca foi recusada
    if (!verdict.ok && verdict.modo === "recusar") return sendJson(res, 409, payload);
    sendJson(res, 200, payload);
    return;
  }

  // ----- Upload de arquivos/zips pra base da soul (sources/uploads/) -----
  const uploadMatch = path.match(/^\/souls\/([^/]+)\/upload$/);
  if (uploadMatch && req.method === "POST") {
    const soul = getSoul(home, decodeURIComponent(uploadMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    if (!(req.headers["content-type"] ?? "").startsWith("multipart/form-data")) {
      return sendJson(res, 400, { error: "esperado multipart/form-data (campo files)" });
    }
    const uploadsDir = join(soul.dir, "sources", "uploads");
    let result;
    try {
      result = await handleUpload(req, uploadsDir);
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    // Indexa em segundo plano só os arquivos recém-salvos (.md/.txt): reindexar
    // a soul inteira (indexDirectory) a cada upload re-embeda tudo via Ollama —
    // horas em CPU — e a resposta HTTP ficava presa até o fim (a UI travava em
    // "enviando…"). Reindex completo continua disponível pela CLI (comando index).
    const TEXT_EXT = /\.(md|markdown|txt)$/i;
    const newFiles: string[] = [];
    for (const s of result.saved) {
      if (s.extracted) {
        const destDir = join(uploadsDir, s.name.replace(/\.zip$/i, ""));
        for (const entry of s.extracted) if (TEXT_EXT.test(entry)) newFiles.push(join(destDir, entry));
      } else if (TEXT_EXT.test(s.name)) {
        newFiles.push(join(uploadsDir, s.name));
      }
    }
    try {
      hub.broadcast({ type: "upload.done", soul: soul.id, saved: result.saved.length, rejected: result.rejected.length });
    } catch {
      /* ws opcional */
    }
    sendJson(res, result.rejected.length > 0 && result.saved.length === 0 ? 400 : 200, { ok: true, ...result, indexing: newFiles.length });
    if (newFiles.length > 0) {
      const config = loadConfig({ home });
      const pool = getPool(config.databaseUrl);
const embedder = getEmbedder();
      void (async () => {
        let indexed = 0;
        for (const file of newFiles) {
          try {
            indexed += await indexFile(pool, soul.id, soul.dir, file, embedder);
          } catch (err) {
            logger.warn({ err, file }, "falha ao indexar arquivo de upload");
          }
        }
        try {
          hub.broadcast({ type: "index.done", soul: soul.id, indexed, files: newFiles.length });
        } catch {
          /* ws opcional */
        }
      })();
    }
    return;
  }

  // ----- Escrita de memória da alma (openclaw-style) -----
  const almaBaseMatch = path.match(/^\/souls\/([^/]+)\/(anotar|licao|decidir)$/);
  if (almaBaseMatch && req.method === "POST") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(almaBaseMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    const parsed = await readJson(req);
    if (parsed.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (parsed.error === "invalid") return sendJson(res, 400, { error: "JSON inválido" });
    const body = parsed.body ?? {};
    const dir = soul.dir;
    try {
      const op = almaBaseMatch[2]!;
      if (op === "anotar") {
        const texto = body && typeof body.texto === "string" && body.texto.trim() ? body.texto.trim() : null;
        if (!texto) return sendJson(res, 400, { error: "texto é obrigatório" });
        const file = anotar(dir, texto);
        return sendJson(res, 200, { ok: true, arquivo: file, texto });
      }
      if (op === "licao") {
        const texto = body && typeof body.texto === "string" && body.texto.trim() ? body.texto.trim() : null;
        if (!texto) return sendJson(res, 400, { error: "texto é obrigatório" });
        const file = registrarLicao(dir, texto);
        return sendJson(res, 200, { ok: true, arquivo: file, texto });
      }
      // decidir
      const titulo = body && typeof body.titulo === "string" && body.titulo.trim() ? body.titulo.trim() : null;
      if (!titulo) return sendJson(res, 400, { error: "titulo é obrigatório" });
      const file = decidir(dir, {
        titulo,
        contexto: typeof body.contexto === "string" ? body.contexto : undefined,
        decisao: typeof body.decisao === "string" ? body.decisao : undefined,
        alternativas: typeof body.alternativas === "string" ? body.alternativas : undefined,
        consequencias: typeof body.consequencias === "string" ? body.consequencias : undefined,
      });
      return sendJson(res, 200, { ok: true, arquivo: file, titulo });
    } catch (err) {
      return sendJson(res, 409, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const healthMatch = path.match(/^\/souls\/([^/]+)\/health$/);
  if (healthMatch && req.method === "GET") {
    const { getSoul, soulHealth } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(healthMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    sendJson(res, 200, soulHealth(soul.dir));
    return;
  }

  const limparMatch = path.match(/^\/souls\/([^/]+)\/limpar$/);
  if (limparMatch && req.method === "POST") {
    const { getSoul, limparSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(limparMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    const parsed = await readJson(req);
    if (parsed.error === "too_large") return sendJson(res, 413, { error: "body excede 1 MB" });
    if (parsed.error === "invalid") return sendJson(res, 400, { error: "JSON inválido" });
    const body = parsed.body ?? {};
    const maxAgeDays = typeof body.maxAgeDays === "number" ? body.maxAgeDays : undefined;
    const maxBytes = typeof body.maxBytes === "number" ? body.maxBytes : undefined;
    const result = limparSoul(soul.dir, { maxAgeDays, maxBytes });
    sendJson(res, 200, { soul: soul.id, ...result });
    return;
  }

  const graphMatch = path.match(/^\/souls\/([^/]+)\/graph$/);
  if (graphMatch && req.method === "GET") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(graphMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, {
      soul: soul.id,
      entities: await listEntities(pool, soul.id),
      relations: await listRelations(pool, soul.id),
      observations: await listObservations(pool, soul.id),
    });
    return;
  }

  // ----- POST /souls/:soul/graph/observation — adiciona observação ao grafo -----
  const obsMatch = path.match(/^\/souls\/([^/]+)\/graph\/observation$/);
  if (obsMatch && req.method === "POST") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(obsMatch[1]!));
    if (!soul) return sendJson(res, 404, { error: "soul não encontrada" });
    try {
      const parsed = await readJson(req);
      const b = parsed.body || {};
      const entity: string = (b.entity as string) || "";
      const body: string = (b.body as string) || "";
      const source: string | undefined = (b.source as string) || undefined;
      if (!entity || !body) return sendJson(res, 400, { error: "entity e body são obrigatórios" });
      const config = loadConfig({ home });
      const pool = getPool(config.databaseUrl);
      await addObservation(pool, soul.id, entity, body, source);
      sendJson(res, 200, { ok: true, soul: soul.id, entity });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // ----- Voice: controle do pipeline de voz -----
  if (req.method === "POST" && path === "/voice/start") {
    if (!voiceHandler) {
      return sendJson(res, 503, { error: "voice não habilitado (defina VOICE_ENABLED=true)" });
    }
    try {
      const parsed = await readJson(req);
      const soulId: string = (parsed.body?.soul as string) ?? "";

      // Configura o handler de chat com a soul do request (ou sem handler se soul não informada)
      const soul = soulId ? getSoul(home, soulId) : null;
      if (soul) {
        voiceHandler.setOnChat(async (prompt: string) => {
          const config = loadConfig({ home });
          const built = await buildPrompt({ home, soul, prompt, config });
          const pool = getPool(config.databaseUrl);
          const decision = await route(pool, config, soul, makeLocalFallbackProbe(config.ollamaUrl), config.routerTiers);
          const model = soul.config.models?.chat ?? decision.target.model ?? "local";
          const result = await run!(built.fullPrompt, {
            cwd: soul.dir,
            model,
            timeoutSeconds: 120,
            agent: soul.config.agent ? soul.id : undefined,
            soulId: soul.id,
          });
          return result.stdout || "(sem resposta)";
        });
      }

      await voiceHandler.start();
      sendJson(res, 200, { ok: true, message: "pipeline de voz iniciado" });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (req.method === "POST" && path === "/voice/stop") {
    if (!voiceHandler) {
      return sendJson(res, 503, { error: "voice não habilitado" });
    }
    voiceHandler.stop();
    sendJson(res, 200, { ok: true, message: "pipeline de voz parado" });
    return;
  }

  if (req.method === "GET" && path === "/voice/status") {
    if (!voiceHandler) {
      return sendJson(res, 200, { enabled: false, running: false });
    }
    sendJson(res, 200, { enabled: true, running: voiceHandler.isRunning });
    return;
  }

  // ── WhatsApp Webhook Human-in-the-Loop ──────────────────────────────
  if (req.method === "POST" && path === "/api/webhooks/whatsapp") {
    try {
      const { processWhatsAppPayload, registerWhatsAppRoutes } = await import(
        "./adapters/whatsapp.js"
      );
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const payload: any = JSON.parse(body);
          const result = await processWhatsAppPayload(payload);
          if (result.requires_approval) {
            sendJson(res, 200, {
              status: "pending_approval",
              requires_approval: true,
              draft: result.draft,
              session_path: result.session_path,
            });
          } else {
            // Auto-approve: already persisted by processWhatsAppPayload
            sendJson(res, 200, {
              status: "approved",
              message: "Resposta disparada automaticamente",
              session_path: result.session_path,
            });
          }
        } catch (err) {
          console.error("WhatsApp webhook error:", err);
          sendJson(res, 500, { error: "Internal processing error" });
        }
      });
      // O handler de 'end' é assíncrono; precisamos bloquear o retorno
      // Como este é um servidor HTTP simples, enviamos OK imediatamente
      // e a lógica completa termina no callback 'end'. Para simplificar,
      // retornamos 202 Accepted indicando que o processamento começou.
      sendJson(res, 202, { status: "queued", message: "Payload recebido para processamento" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON payload" });
    }
    return;
  }

  if (req.method === "POST" && path === "/api/webhooks/whatsapp/approve") {
    try {
      const { anotar } = await import("@assistente-os/core");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const payload: any = JSON.parse(body);
          // O payload deve conter: session_path e a aprovação do draft
          const { session_path, draft, contato } = payload;
          if (!session_path) {
            return sendJson(res, 400, { error: "session_path é obrigatório" });
          }
          // Persistir aprovação no log de sessão
          const approvalEntry = `🟢 Aprovação humana confirmada em ${new Date().toISOString()}\nContato: ${contato || "desconhecido"}\nRascunho aprovado:\n${draft || ""}`;
          const file = anotar(
            session_path.split(`/sessoes/${session_path.split(`/sessoes/`)[1]}`)[0],
            approvalEntry
          );
          sendJson(res, 200, { ok: true, arquivo: file, message: "Aprovação registrada" });
        } catch (err) {
          console.error("WhatsApp approve error:", err);
          sendJson(res, 500, { error: "Internal processing error" });
        }
      });
      // Retornar imediatamente; o 'end' callback completará o processamento
      sendJson(res, 202, { status: "approval_queued", message: "Aprovação recebida para processamento" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON payload" });
    }
    return;
  }

  // ── Email → Knowledge Pipeline ───────────────────────────────────────
  if (req.method === "POST" && path === "/api/pipelines/email-ingest") {
    try {
      const { emailIngestPipeline } = await import("./pipelines/email-ingest.js");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { rawEmailBody } = JSON.parse(body);
          const result = await emailIngestPipeline(rawEmailBody);
          sendJson(res, 200, {
            status: "completed",
            conhecimentoPath: result.conhecimentoPath,
            topicos: result.extractionResult.topicos.length,
            decisoes: result.extractionResult.decisoes.length,
            acoes: result.extractionResult.acoes.length,
            lições: result.extractionResult.licoes?.length || 0,
          });
        } catch (err) {
          console.error("Email ingest error:", err);
          sendJson(res, 500, { error: "Pipeline failed" });
        }
      });
      sendJson(res, 202, { status: "queued", message: "Pipeline email iniciada" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return;
  }

  // ── Meeting Ingest Pipeline ──────────────────────────────────────────
  if (req.method === "POST" && path === "/api/pipelines/meeting-ingest") {
    try {
      const { meetingIngestPipeline } = await import("./pipelines/meeting-ingest.js");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { filePath } = JSON.parse(body);
          const result = await meetingIngestPipeline(filePath);
          sendJson(res, 200, {
            status: "completed",
            meetingPath: result.meetingPath,
            decisoes: (result.meetingPayload.decisoes ?? []).length,
            acoes: (result.meetingPayload.acoes ?? []).length,
            objeccoes: (result.meetingPayload.objeccoes ?? []).length,
            resumo: (result.meetingPayload.resumo ?? "").slice(0, 60) + "...",
          });
        } catch (err) {
          console.error("Meeting ingest error:", err);
          sendJson(res, 500, { error: "Pipeline failed" });
        }
      });
      sendJson(res, 202, { status: "queued", message: "Pipeline meeting iniciada" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return;
  }

  // Fallback original
  sendJson(res, 404, { error: `rota não encontrada: ${req.method} ${path}` });
}

/** Resolve packages/daemon/web a partir deste arquivo (funciona em src/ e dist/). */
function defaultWebDir(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "web");
}

function readJson(req: IncomingMessage): Promise<{ body: Record<string, unknown> | null; error?: "invalid" | "too_large" }> {
  return new Promise((resolve) => {
    let raw = "";
    let bytes = 0;
    let settled = false;
    const finish = (value: { body: Record<string, unknown> | null; error?: "invalid" | "too_large" }) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) {
        req.resume();
        finish({ body: null, error: "too_large" });
        return;
      }
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (settled || !raw.trim()) return finish({ body: null });
      try {
        finish({ body: JSON.parse(raw) as Record<string, unknown> });
      } catch {
        finish({ body: null, error: "invalid" });
      }
    });
    req.on("error", () => finish({ body: null, error: "invalid" }));
  });
}

/** Lê o body cru (Buffer) para verificação de HMAC; respeita o limite de 1 MB. */
function readRawBody(req: IncomingMessage): Promise<{ body?: Buffer; error?: "invalid" | "too_large" }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (value: { body?: Buffer; error?: "invalid" | "too_large" }) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) {
        req.resume();
        finish({ error: "too_large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      finish({ body: Buffer.concat(chunks) });
    });
    req.on("error", () => finish({ error: "invalid" }));
  });
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return false;
  const provided = Buffer.from(auth.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
