#!/usr/bin/env node
/**
 * soul-rag-watcher — serviço desanexado do Assistente OS.
 *
 * Observa ~/.assistant-os/souls/<soul>/ recursivamente e, quando arquivos
 * .md/.txt mudam, pede a reindexação da RAG via MCP (tools/call memory_index).
 *
 * Desacoplado de propósito:
 *   - não importa nada do monorepo (@assistente-os/*);
 *   - não fala com Postgres, daemon ou Ollama diretamente;
 *   - só conversa JSON-RPC/stdio com um processo MCP efêmero por indexação.
 *
 * A soul é inferida do caminho: souls/<id>/... — cada evento é roteado para a
 * soul certa automaticamente.
 *
 * Ambiente (tudo opcional):
 *   AOS_HOME               raiz do assistente (default: ~/.assistant-os)
 *   AOS_MCP_CMD            comando que sobe o servidor MCP stdio
 *                          (default: node <repo>/packages/tools/dist/index.js)
 *   AOS_WATCH_DEBOUNCE_MS  janela de quietude por soul (default: 20000)
 *   AOS_WATCH_TIMEOUT_MS   timeout de cada indexação (default: 1800000)
 *   AOS_WATCH_IGNORE_UPLOADS  ignora sources/uploads/ (default: true; o daemon
 *                          já indexa uploads sozinho)
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { watch } from "node:fs";

const HOME = process.env.AOS_HOME || join(homedir(), ".assistant-os");
const SOULS_DIR = join(HOME, "souls");
const REPO = process.env.AOS_REPO || "/home/support/assistente-os";
const MCP_CMD = process.env.AOS_MCP_CMD || `node ${join(REPO, "packages", "tools", "dist", "index.js")}`;
const DEBOUNCE_MS = Number(process.env.AOS_WATCH_DEBOUNCE_MS || 20_000);
const TIMEOUT_MS = Number(process.env.AOS_WATCH_TIMEOUT_MS || 30 * 60_000);
const IGNORE_UPLOADS = (process.env.AOS_WATCH_IGNORE_UPLOADS ?? "true") !== "false";

const TEXT_EXT = new Set([".md", ".markdown", ".txt"]);
const log = (...a) => console.log(new Date().toISOString(), "[rag-watcher]", ...a);

if (!existsSync(SOULS_DIR)) {
  console.error(`[rag-watcher] ERRO: ${SOULS_DIR} não existe. Ajuste AOS_HOME.`);
  process.exit(1);
}

/** souls conhecidas no boot (snapshot) — nada é indexado na partida. */
for (const d of readdirSync(SOULS_DIR, { withFileTypes: true })) {
  if (d.isDirectory()) log("observando soul:", d.name);
}

const pending = new Map(); // soul -> Set<arquivo relativo>
const timers = new Map(); // soul -> timeout
let running = false;
const queue = [];

function soulOf(absPath) {
  const rel = relative(SOULS_DIR, absPath);
  const [first, ...rest] = rel.split(/[\\/]/);
  if (!first || rest.length === 0) return null; // fora de uma soul
  return { soul: first, file: `${first}/${rest.join("/")}` };
}

function shouldIndex(file) {
  const name = file.split("/").pop() ?? "";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!TEXT_EXT.has(ext)) return false;
  if (name.startsWith(".") || name.endsWith("~") || /\.(tmp|swp|part)$/.test(name)) return false;
  if (IGNORE_UPLOADS && /[/\\]sources[/\\]uploads[/\\]/.test(file)) return false;
  return true;
}

function markDirty(soul, file) {
  let set = pending.get(soul);
  if (!set) pending.set(soul, (set = new Set()));
  set.add(file);
  clearTimeout(timers.get(soul));
  timers.set(
    soul,
    setTimeout(() => {
      timers.delete(soul);
      enqueue(soul);
    }, DEBOUNCE_MS),
  );
}

function enqueue(soul) {
  const files = pending.get(soul);
  if (!files || files.size === 0) return;
  pending.delete(soul);
  queue.push({ soul, files: [...files] });
  pump();
}

async function pump() {
  if (running || queue.length === 0) return;
  running = true;
  const job = queue.shift();
  try {
    await indexViaMcp(job.soul, job.files);
  } catch (err) {
    log(`ERRO ao indexar '${job.soul}':`, err?.message ?? err);
  }
  running = false;
  pump();
}

/** Sobe um MCP efêmero, faz handshake e chama memory_index para a soul. */
function indexViaMcp(soul, files) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = MCP_CMD.split(" ").filter(Boolean);
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout de ${TIMEOUT_MS / 1000}s excedido`));
    }, TIMEOUT_MS);

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

    child.stderr.on("data", (d) => process.stderr.write(d));

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`MCP saiu antes de responder (code=${code})`));
    });

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "memory_index", arguments: { soul } },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.removeAllListeners("exit");
          child.kill();
          if (msg.error) return reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          const out = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.result);
          log(`indexado via MCP → soul '${soul}' (${files.length} arquivo(s) alterado(s)): ${out}`);
          resolve(out);
          return;
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "soul-rag-watcher", version: "1.0.0" },
      },
    });
  });
}

log(`monitorando ${SOULS_DIR} (debounce ${DEBOUNCE_MS / 1000}s, mcp: ${MCP_CMD})`);

const watcher = watch(SOULS_DIR, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  const abs = join(SOULS_DIR, filename);
  const ref = soulOf(abs);
  if (!ref) return;
  if (!shouldIndex(filename)) return;
  log(`evento ${eventType}: ${ref.file} → soul '${ref.soul}'`);
  markDirty(ref.soul, ref.file);
});

watcher.on("error", (err) => {
  log("ERRO no watcher:", err?.message ?? err);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log(`recebido ${sig}, encerrando…`);
    watcher.close();
    for (const t of timers.values()) clearTimeout(t);
    process.exit(0);
  });
}
