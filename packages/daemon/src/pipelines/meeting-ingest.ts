/**
 * Ingestão de Transcrições de Reuniões/Calls
 * 
 * Parser para arquivos de transcrição brutos (.vtt, .srt, .txt)
 * e extração estruturada via LLM (Ollama fetch nativo): decisões tomadas,
 * pontos de ação (action items) e objeções levantadas.
 * 
 * Persistência em ~/.assistant-os/souls/<id>/sessoes/YYYY-MM-DD-meeting.md.
 * Reindexação semântica automática no PostgreSQL/pgvector (best-effort).
 * 
 * Filosofia Local-First: escrita garantida em Markdown; parsing/extração é
 * best-effort com fallback para texto transcrito puro.
 */

import { readFile } from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync
} from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { todayISODate } from "@assistente-os/core";

// ── Funções auxiliares de parse (inline - baseadas no meeting-ingest original) ──

/** Detecta formato do arquivo baseado na extensão */
function getFormat(filePath: string): "vtt" | "srt" | "txt" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".srt")) return "srt";
  return "txt";
}

/** Parser de arquivo VTT (WebVTT). */
function parseVTT(content: string): string {
  let text = content;
  text = text.replace(/^WEBVTT[\s\S]*?:/m, "");
  text = text.replace(
    /\d{2}:\d{2}:\d{2}[\,\s]\d{3}\s*\-->\s*\d{2}:\d{2}:\d{2}[\,\s]\d{3}\n/g,
    ""
  );
  text = text.replace(/^\d+\n/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\[[^\]]+\]\s*/g, "");
  return text.trim();
}

/** Parser de arquivo SRT (SubRip Subtitle). */
function parseSRT(content: string): string {
  let text = content;
  text = text.replace(/^\d+\n/m, "");
  text = text.replace(
    /\d{2}:\d{2}:\d{2}[\,\s]\d{3}\s*\-->\s*\d{2}:\d{2}:\d{2}[\,\s]\d{3}/g,
    ""
  );
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Parser para arquivos TXT brutos. */
function parseTXT(content: string): string {
  let text = content;
  text = text.replace(/^\[[^\]]+\]\s*/gm, "");
  text = text.replace(/^\s*Palestrante \d+\s*$/gm, "");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

// Função unificada: detecta tipo e faz parse
async function parseTranscriptionFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  const lowerPath = filePath.toLowerCase();

  if (lowerPath.endsWith(".vtt")) {
    return parseVTT(content);
  } else if (lowerPath.endsWith(".srt")) {
    return parseSRT(content);
  } else {
    return parseTXT(content);
  }
}

/** Métricas de telemetria/FinOps de uma chamada de extração via LLM. */
export interface MeetingUsageMetadata {
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
}

/** Extrai dados estruturados via Ollama LLM usando fetch nativo. */
async function extractMeetingWithOllama(
  prompt: string,
  ollamaUrl: string,
  chatModel: string
): Promise<{
  decisoes: string[];
  acoes: { texto: string; owner?: string; dueDate?: string }[];
  objeccoes: string[];
  resumo: string;
  rawTranscript?: string;
  fonteArquivo?: string;
  usage: MeetingUsageMetadata;
}> {
  const payload = {
    model: chatModel,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  const startedAt = Date.now();
  const empty = (): { decisoes: string[]; acoes: never[]; objeccoes: string[]; resumo: string; usage: MeetingUsageMetadata } => ({
    decisoes: [],
    acoes: [],
    objeccoes: [],
    resumo: "",
    usage: { latencyMs: Date.now() - startedAt },
  });

  // Usar AbortController para timeout
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 30000);

  try {
    const resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      return empty();
    }

    const data = await resp.json() as any;
    const content = data.message?.content || String(data);
    const usage: MeetingUsageMetadata = {
      promptTokens: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : undefined,
      completionTokens: typeof data.eval_count === "number" ? data.eval_count : undefined,
      latencyMs: Date.now() - startedAt,
    };

    try {
      const parsed = JSON.parse(content);
      return {
        decisoes: parsed.decisoes || [],
        acoes: parsed.acoes || [],
        objeccoes: parsed.objeccoes || [],
        resumo: parsed.resumo || "",
        usage,
      };
    } catch (err) {
      console.error("LLM output não é JSON válido na meeting extraction");
      return { ...empty(), usage };
    }
  } catch (err) {
    // Ollama offline ou erro de rede
    console.debug("Ollama unavailable in meeting extract:", (err as Error).message);
    return empty();
  }
}

// ── Tipos locais ────────────────────────────────────────────────────────────

/** Estrutura de payload de reunião */
interface MeetingPayload {
  decisoes?: string[];
  acoes?: { texto: string; owner?: string; dueDate?: string }[];
  objeccoes?: string[];
  resumo?: string;
  rawTranscript?: string;
  fonteArquivo?: string;
  usage?: MeetingUsageMetadata;
}

/**
 * Converte MeetingPayload em string Markdown.
 */
function meetingPayloadToMarkdown(payload: MeetingPayload): string {
  let decisoesBlock = "";
  if (payload.decisoes && payload.decisoes.length > 0) {
    const lines: string[] = [];
    for (const d of payload.decisoes) {
      lines.push("- " + d);
    }
    decisoesBlock = "## Decisões Tomadas\n" + lines.join("\n") + "\n";
  }

  let acoesBlock = "";
  if (payload.acoes && payload.acoes.length > 0) {
    const lines: string[] = [];
    for (const a of payload.acoes) {
      const partes: string[] = ["- [" + a.texto + "]"];
      if (a.owner) {
        partes.push("(responsável: " + a.owner + ")");
      }
      if (a.dueDate) {
        partes.push("prazo: " + a.dueDate);
      }
      lines.push(partes.join(" "));
    }
    acoesBlock = "## Pontos de Ação\n" + lines.join("\n") + "\n";
  }

  let objeccoesBlock = "";
  if (payload.objeccoes && payload.objeccoes.length > 0) {
    const lines: string[] = [];
    for (const o of payload.objeccoes) {
      lines.push("- " + o);
    }
    objeccoesBlock = "## Objeções Levantadas\n" + lines.join("\n") + "\n";
  }

  let resumoBlock = "";
  if (payload.resumo) {
    resumoBlock = "## Resumo\n" + payload.resumo + "\n";
  }

  const usageLines: string[] = [];
  if (payload.usage) {
    if (payload.usage.promptTokens !== undefined) usageLines.push("- prompt_tokens: " + payload.usage.promptTokens);
    if (payload.usage.completionTokens !== undefined) usageLines.push("- completion_tokens: " + payload.usage.completionTokens);
    usageLines.push("- latency_ms: " + payload.usage.latencyMs);
  }
  const usageBlock = usageLines.length > 0 ? "## Telemetria\n" + usageLines.join("\n") + "\n" : "";

  const metadataBlock =
    "---\n*Extraída automaticamente via pipeline meeting-ingest em " +
    todayISODate() +
    "*\n---\n";

  const entry =
    "# Reunião - " +
    payload.fonteArquivo +
    "\n" +
    decisoesBlock +
    acoesBlock +
    objeccoesBlock +
    resumoBlock +
    usageBlock +
    metadataBlock;

  return entry;
}

// ── Exportação principal ─────────────────────────────────────────────

export async function meetingIngestPipeline(
  filePath: string,
  soulId?: string
): Promise<{
  meetingPath: string;
  meetingPayload: MeetingPayload;
}> {
  const homeDir = process.env.ASSISTENTE_OS_HOME || `${homedir()}/.assistant-os`;

  const _core = await import("@assistente-os/core");
  let targetSoulId = soulId || _core.getActiveSoul(homeDir) || "main";

  if (soulId) targetSoulId = soulId;

  // 1. Fazer parse da transcrição
  const rawTranscript = await parseTranscriptionFile(filePath);

  // 2. Extrair via Ollama
  const config = {
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    ollamaChatModel:
      process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free",
  };
  const buildPrompt = `Extraia JSON com chaves: decisoes (string[]), acoes (objectos com texto/responsavel/prazo), objeccoes (string[]), resumo (string).

TRANSCRIÇÃO:
${rawTranscript}`;

  const meetingPayload = await extractMeetingWithOllama(
    buildPrompt,
    config.ollamaUrl,
    config.ollamaChatModel
  );

  // Completer rawTranscript and fonteArquivo
  meetingPayload.rawTranscript = rawTranscript;
  meetingPayload.fonteArquivo = basename(filePath);

  // 3. Persistir em Markdown
  const markdown = meetingPayloadToMarkdown(meetingPayload);
  const meetingDir = join(homeDir, "souls", targetSoulId);
  mkdirSync(meetingDir, { recursive: true });
  const meetingPath = join(meetingDir, "sessoes", todayISODate() + "-meeting.md");
  writeFileSync(meetingPath, markdown, "utf8");

  // 4. Persistir no grafo da soul (dispara extração de entidades/relações
  // em background via addObservation — ver packages/memory/src/graph.ts).
  try {
    const { getPool, loadConfig } = await import("@assistente-os/core");
    const { addObservation } = await import("@assistente-os/memory");
    const meetingConfig = loadConfig({ home: homeDir });
    const pool = getPool(meetingConfig.databaseUrl);
    const summaryParts = [
      meetingPayload.resumo,
      ...(meetingPayload.decisoes ?? []),
    ].filter(Boolean);
    if (summaryParts.length > 0) {
      await addObservation(pool, targetSoulId, meetingPayload.fonteArquivo ?? "reuniao", summaryParts.join("\n"), "meeting-ingest");
    }
  } catch (err) {
    console.debug(
      "Meeting: falha ao persistir observação no grafo (non-fatal):" + (err as Error).message
    );
  }

  return {
    meetingPath,
    meetingPayload,
  };
}

// ── Teste standalone ─────────────────────────────────────────────────

const isMainModule = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (isMainModule) {
  ;(async () => {
    const sampleVTT = `WEBVTT

1
00:00:01,000 --> 00:00:04,000
Bem-vindos à reunião de sprint.

2
00:00:05,000 --> 00:00:09,000
Decidimos adiar o lançamento para a próxima semana.

3
00:00:10,000 --> 00:00:15,000
Ação: corrigir bugs críticos. Responsável: Maria. Prazo: 03/02.

4
00:00:16,000 --> 00:00:20,000
Objeção: clientes podem cancelar se atrasar mais.
`;

    const tmpFile = "/tmp/test-meeting.vtt";
    try {
      const fs = await import("node:fs");
      fs.writeFileSync(tmpFile, sampleVTT);
    } catch {
      // falha silenciosa
    }

    try {
      const result = await meetingIngestPipeline(tmpFile);
      console.log("✅ Pipeline meeting-ingest concluído:");
      console.log("   - Arquivo: " + result.meetingPath);
      console.log("   - Decisões: " + (result.meetingPayload.decisoes?.length || 0));
      console.log("   - Ações: " + (result.meetingPayload.acoes?.length || 0));
      console.log("   - Objeções: " + (result.meetingPayload.objeccoes?.length || 0));
      console.log(
        "   - Resumo: " + (result.meetingPayload.resumo?.slice(0, 80) || "") + "..."
      );
    } catch (err) {
      console.error("❌ Pipeline falhou:", err);
    }
  })();
}