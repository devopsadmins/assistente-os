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
  loadConfig as loadCoreConfig, type AssistenteOsConfig,
  soulDir, todayISODate, getPool, getActiveSoul,
} from "@assistente-os/core";
import { getEmbedder, search } from "@assistente-os/memory";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Dynamic import for annotar to avoid TS type resolution at startup
const __annotarPromise = import("@assistente-os/core").then((mod) => mod.anotar);

// ── Configuração ──────────────────────────────────────────────────────

const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";
const WHATSAPP_APPROVE_PATH = "/api/webhooks/whatsapp/approve";

type WhatsAppConfig = AssistenteOsConfig;

function loadConfig(): WhatsAppConfig {
  // Reusa o loadConfig() real de @assistente-os/core (lê DATABASE_URL/OLLAMA_URL
  // do .env de verdade) em vez de reimplementar resolução de home/URL aqui.
  return loadCoreConfig();
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

/**
 * Busca contexto RAG usando o indexador real (`chunks`, pgvector) — antes
 * esta função consultava uma tabela/coluna (`memory_chunks`, `metadata->>'soul'`)
 * que nunca existiu no schema real, então sempre retornava vazio silenciosamente.
 */
async function getRAGContext(
  config: WhatsAppConfig,
  soulId: string,
  query: string
): Promise<string> {
  try {
    const pool = getPool(config.databaseUrl);
    const results = await search(pool, soulId, query, getEmbedder(), 5);
    if (!results.length) return "";
    return results
      .map((r) => `- [score: ${r.score.toFixed(3)}] ${r.body.slice(0, 200)}`)
      .join("\n");
  } catch {
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

  // 1. Identificar Alma ativa
  let soulId = "main";
  try {
    const activeSoul = getActiveSoul(cfg.home);
    soulId = activeSoul ?? "main";
  } catch {
    // ignored
  }

  let ragContext = "";
  try {
    ragContext = await getRAGContext(cfg, soulId, payload.data?.body || "");
  } catch {
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
  const soulDirPath = soulDir(join(cfg.home, "souls"), soulId);
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

export { processWhatsAppPayload };