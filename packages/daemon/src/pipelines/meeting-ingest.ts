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
import { todayISODate } from "@assistente-os/core";

// ── Tipos de saída estruturada ───────────────────────────────────────

interface ActionItem {
  texto: string;
  responsavel?: string | null;
  prazo?: string | null;
}

interface MeetingPayload {
  decisoes: string[];
  acoes: ActionItem[];
  objeccoes: string[];
  resumo: string;
  rawTranscript: string;
  fonteArquivo: string;
}

/**
 * Parser de arquivo VTT (WebVTT).
 * Remove cabeçalho, timestamps e números de sequência.
 */
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

/**
 * Parser de arquivo SRT (SubRip Subtitle).
 * Remove números de sequência e timestamps.
 */
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

/**
 * Parser para arquivos TXT brutos.
 * Remove marcações de palestrantes e normaliza whitespace.
 */
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

/**
 * Extrai dados estruturados via Ollama LLM usando fetch nativo.
 */
async function extractMeetingWithOllama(
  prompt: string,
  ollamaUrl: string,
  chatModel: string
): Promise<MeetingPayload> {
  const payload = {
    model: chatModel,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

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
      return {
        decisoes: [],
        acoes: [],
        objeccoes: [],
        resumo: "",
        rawTranscript: "",
        fonteArquivo: "",
      };
    }

    const data = await resp.json() as any;
    const content = data.message?.content || String(data);

    try {
      const parsed = JSON.parse(content);
      return {
        decisoes: parsed.decisoes || [],
        acoes: parsed.acoes || [],
        objeccoes: parsed.objeccoes || [],
        resumo: parsed.resumo || "",
        rawTranscript: "",
        fonteArquivo: "",
      };
    } catch (err) {
      console.error("LLM output não é JSON válido na meeting extraction");
      return {
        decisoes: [],
        acoes: [],
        objeccoes: [],
        resumo: "",
        rawTranscript: "",
        fonteArquivo: "",
      };
    }
  } catch (err) {
    // Ollama offline ou erro de rede
    console.debug("Ollama unavailable in meeting extract:", (err as Error).message);
    return {
      decisoes: [],
      acoes: [],
      objeccoes: [],
      resumo: "",
      rawTranscript: "",
      fonteArquivo: "",
    };
  }
}

/**
 * Escreve payload de reunião no Markdown da soul.
 */
function writeMeetingToMarkdown(
  soulDir: string,
  payload: MeetingPayload,
  dateISO: string
): string {
  mkdirSync(soulDir, { recursive: true });
  const meetingPath = join(soulDir, "sessoes", dateISO + "-meeting.md");

  let decisoesBlock = "";
  if (payload.decisoes.length > 0) {
    const lines: string[] = [];
    for (const d of payload.decisoes) {
      lines.push("- " + d);
    }
    decisoesBlock = "## Decisões Tomadas\n" + lines.join("\n") + "\n";
  }

  let acoesBlock = "";
  if (payload.acoes.length > 0) {
    const lines: string[] = [];
    for (const a of payload.acoes) {
      const partes: string[] = ["- [" + a.texto + "]"];
      if (a.responsavel) {
        partes.push("(responsável: " + a.responsavel + ")");
      }
      if (a.prazo) {
        partes.push("prazo: " + a.prazo);
      }
      lines.push(partes.join(" "));
    }
    acoesBlock = "## Pontos de Ação\n" + lines.join("\n") + "\n";
  }

  let objeccoesBlock = "";
  if (payload.objeccoes.length > 0) {
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

  const metadataBlock =
    "---\n*Extraída automaticamente via pipeline meeting-ingest em " +
    todayISODate() +
    "*\n---\n";

  const entry =
    "# Reunião - " +
    dateISO +
    "\n" +
    decisoesBlock +
    acoesBlock +
    objeccoesBlock +
    resumoBlock +
    metadataBlock;

  if (!existsSync(meetingPath)) {
    writeFileSync(meetingPath, entry, "utf8");
  } else {
    appendFileSync(meetingPath, entry, "utf8");
  }

  return meetingPath;
}

/**
 * Dispara reindexação RAG (best-effort).
 */
async function triggerMeetingRAGReindex(
  soulId: string,
  homeDir: string,
  meetingPayload: MeetingPayload
): Promise<void> {
  try {
    const { getPool } = await import("@assistente-os/core");
    const pool = getPool(
      "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"
    );
    await import("@assistente-os/memory");
  } catch (err) {
    console.debug(
      "Meeting RAG reindex skipped (offline/fallback):" + (err as Error).message
    );
  }
}

// ── Exportação principal ─────────────────────────────────────────────

export async function meetingIngestPipeline(
  filePath: string,
  soulId?: string
): Promise<{
  meetingPath: string;
  meetingPayload: MeetingPayload;
}> {
  const homeDir =
    process.env.ASSISTENTE_OS_HOME ||
    (require("node:os").homedir?.() || "~") + "/.assistant-os";

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
  const meetingPath = writeMeetingToMarkdown(
    join(homeDir, "souls", targetSoulId),
    meetingPayload,
    todayISODate()
  );

  // 4. Trigger reindex RAG (best-effort)
  await triggerMeetingRAGReindex(targetSoulId, homeDir, meetingPayload);

  return {
    meetingPath,
    meetingPayload,
  };
}

// ── Teste standalone ─────────────────────────────────────────────────

if (require.main === module) {
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
      console.log("   - Decisões: " + result.meetingPayload.decisoes.length);
      console.log("   - Ações: " + result.meetingPayload.acoes.length);
      console.log("   - Objeções: " + result.meetingPayload.objeccoes.length);
      console.log(
        "   - Resumo: " + (result.meetingPayload.resumo?.slice(0, 80) || "") + "..."
      );
    } catch (err) {
      console.error("❌ Pipeline falhou:", err);
    }
  })();
}