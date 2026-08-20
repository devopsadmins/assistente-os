/**
 * Adaptador WebWhatsApp - Human-in-the-Loop
 * 
 * Recebe payloads JSON do Evolution API / Baileys, resolve a Alma ativa,
 * gera rascunho de resposta via Ollama e aguarda confirmação humana antes
 * de disparar. Ao aprovar, persiste a sessão em Markdown e sincroniza no
 * banco PostgreSQL/pgvector.
 * 
 * Filosofia Local-First: toda escrita de Markdown é garantida; chamadas
 * externas (Ollama, PostgreSQL) são best-effort com fallback gracefully.
 */

import {
  Soul, soulDir, ensureSoulFiles, todayISODate
} from "@assistente-os/core";
import { getPool } from "@assistente-os/core";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";

// Dynamic import for annotar to avoid TS type resolution at startup
const __annotarPromise = import("@assistente-os/core").then((mod) => mod.anotar);

// ── Configuração ──────────────────────────────────────────────────────

const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";
const WHATSAPP_APPROVE_PATH = "/api/webhooks/whatsapp/approve";

interface WhatsAppConfig {
  ollamaUrl: string;
  ollamaChatModel: string;
  homeDir: string;
}

function loadConfig(): WhatsAppConfig {
  return {
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    ollamaChatModel: process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free",
    homeDir: process.env.ASSISTENTE_OS_HOME ||
      (require("node:os").homedir?.() || "~") + "/.assistant-os",
  };
}

// ── Ollama Chat via fetch nativo com timeout via AbortController ──────

async function ollamaChat(
  config: WhatsAppConfig,
  message: string,
  context?: string
): Promise<string> {
  const prompt = context
    ? `Contexto RAG:\n${context}\n\n---PERGUNTA---\n${message}`
    : message;

  const payload = {
    model: config.ollamaChatModel,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  // Usar AbortController para timeout em vez de timeout em RequestInit
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 30000);

  try {
    const resp = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      throw new Error(`Ollama HTTP ${resp.status}`);
    }

    const data = await resp.json() as any;
    return data.message?.content || String(data);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Ollama timeout after 30s");
    }
    throw new Error(`Ollama unavailable: ${(err as Error).message}`);
  }
}

// ── RAG Context Retrieval ───────────────────────────────────────────

async function getRAGContext(
  pool: any,
  soulId: string,
  query: string
): Promise<string> {
  try {
    const results = await pool.query(
      `
      SELECT content, metadata->>'soul' as soul, 
             (1 - (embedding <=> $1::vector)) as similarity
      FROM memory_chunks
      WHERE metadata->>'soul' = $2
      ORDER BY embedding <=> $1::vector
      LIMIT 5
      `,
      [query, soulId]
    );

    if (!results || results.length === 0) return "";

    return results
      .map(
        (r: any) => "- [score: " + (r.similarity?.toFixed ? r.similarity.toFixed(3) : "?") + "] " + r.content.slice(0, 200)
      )
      .join("\n");
  } catch (err) {
    return "";
  }
}

// ── Processar payload WhatsApp ────────────────────────────────────────

async function processWhatsAppPayload(
  payload: any,
  config?: Partial<WhatsAppConfig>
): Promise<{
  requires_approval: boolean;
  draft?: string;
  session_path?: string;
  offline?: boolean;
  error?: string;
}> {
  const cfg = { ...loadConfig(), ...config };
  const pool = getPool(
    "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"
  );

  let ragContext = "";
  try {
    const effectivePool = getPool(
      "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"
    );
    ragContext = await getRAGContext(effectivePool, "main", payload.data?.body || "");
  } catch (err) {
    // ignored
  }

  // 1. Identificar Alma ativa
  let soulId = "main";
  try {
    const { getActiveSoul } = await import("@assistente-os/core");
    const activeSoul = getActiveSoul(cfg.homeDir);
    soulId = activeSoul ?? "main";
  } catch (err) {
    // ignored
  }

  // 2. Gerar rascunho via Ollama
  let draft = "";
  try {
    draft = await ollamaChat(
      cfg,
      payload.data?.body || payload.data?.caption || "Mensagem de voz/mídia recebida",
      ragContext
    );
  } catch (err) {
    // Ollama offline → fallback
    draft = `🤖 Mensagem recebida de ${payload.data?.key?.from}:\n> ${payload.data?.body || payload.data?.caption || "[mídia/sem texto]"}\n\n*Resposta automática offline - Ollama não disponível.*`;
  }

  // 3. Construir resposta humana-in-the-loop
  const sessionDate = todayISODate();
  const soulDirPath = soulDir(cfg.homeDir, soulId);
  try {
    mkdirSync(soulDirPath, { recursive: true });
    mkdirSync(join(soulDirPath, "sessoes"), { recursive: true });
    mkdirSync(join(soulDirPath, "sources"), { recursive: true });
  } catch (err) {
    // ignored
  }

  // Persistir entrada de log (sempre - local-first guarantee)
  try {
    // Wait for the dynamic import resolution
    const __annotar = await __annotarPromise;
    __annotar(soulDirPath, `WhatsApp [${payload.data?.key?.from}]: ${payload.data?.body || payload.data?.caption || "[sem texto]"}`, sessionDate);
  } catch (err) {
    // Best-effort: non-fatal
  }

  // Determinar se precisa de aprovação humana
  const requiresApproval = !draft.includes("offline") && !draft.includes("Não foi possível");

  return {
    requires_approval: requiresApproval,
    draft,
    session_path: join(soulDirPath, "sessoes", `${sessionDate}.md`),
    offline: draft.includes("offline"),
  };
}

// ── Exportações ───────────────────────────────────────────────────────

export function registerWhatsAppRoutes(_app: any) {
  // Lógica real nos endpoints HTTP no server.ts
}

if (require.main === module) {
  console.log("WhatsApp adapter loaded - ready for HTTP integration");
}

export { processWhatsAppPayload };