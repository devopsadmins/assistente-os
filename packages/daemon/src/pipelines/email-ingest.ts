/**
 * Pipeline Email → Conhecimento da Alma
 * 
 * Pipeline simplificada usando fetch nativo para Ollama + JSON parsing.
 * Extrai tópicos, decisões, itens de ação e lições aprendidas de corpo de e-mail,
 * gravando estruturadamente no Markdown da Alma.
 * 
 * Filosofia Local-First: escrita garantida em Markdown; extração é best-effort
 * com fallback para texto cru quando Ollama indisponível.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync
} from "node:fs";
import { join } from "node:path";
import { todayISODate } from "@assistente-os/core";

// ── Tipos de saída estruturada ───────────────────────────────────────

interface EmailExtractionResult {
  topicos: string[];
  secoes: string[];
  decisoes: string[];
  acoes: {
    texto: string;
    responsavel?: string | null;
    prazo?: string | null;
  }[];
  licoes?: string[] | null;
  raw_transcript: string;
}

/**
 * Sanitiza corpo de e-mail:
 * - Remove assinaturas (padrão -- separador)
 * - Remove tags HTML basicas
 * - Remove URLs standalone
 * - Normaliza whitespace
 */
function sanitizeEmailBody(raw: string): string {
  let text = raw;

  // Remove assinaturas que comecem com "--" na primeira ocorrencia
  const sigIdx = text.indexOf("\n--\n");
  if (sigIdx >= 0) {
    text = text.slice(0, sigIdx);
  }

  // Remover tags HTML basicas
  text = text.replace(/<[^>]+>/g, "");

  // Remover URLs standalone
  text = text.replace(/https?:\/\/\S+/g, "");

  // Normalizar whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Extrai informações via Ollama LLM usando fetch nativo.
 * Retorna JSON parseado ou fallback vazio.
 */
async function extractWithOllama(
  prompt: string,
  ollamaUrl: string,
  chatModel: string
): Promise<EmailExtractionResult> {
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
        topicos: [],
        secoes: [],
        decisoes: [],
        acoes: [],
        licoes: [],
        raw_transcript: prompt,
      };
    }

    const data = await resp.json() as any;
    const content = data.message?.content || String(data);

    try {
      const parsed = JSON.parse(content);
      return {
        topicos: parsed.topicos || [],
        secoes: parsed.secoes || [],
        decisoes: parsed.decisoes || [],
        acoes: parsed.acoes || [],
        licoes: parsed.lições || [],
        raw_transcript: prompt,
      };
    } catch (err) {
      console.error("LLM output não é JSON válido");
      return {
        topicos: [],
        secoes: [],
        decisoes: [],
        acoes: [],
        licoes: [],
        raw_transcript: prompt,
      };
    }
  } catch (err) {
    console.debug("Ollama unavailable in email extract:", (err as Error).message);
    return {
      topicos: [],
      secoes: [],
      decisoes: [],
      acoes: [],
      licoes: [],
      raw_transcript: prompt,
    };
  }
}

// ── Persistência no Markdown da Alma ──────────────────────────────────

function writeEmailKnowledgeToMarkdown(
  soulDir: string,
  result: EmailExtractionResult,
  dateISO: string
): string {
  mkdirSync(soulDir, { recursive: true });
  const conhecimentoPath = join(soulDir, "conhecimento.md");

  let topicosBlock = "";
  if (result.topicos.length > 0) {
    const lines: string[] = [];
    for (const t of result.topicos) {
      lines.push("- " + t);
    }
    topicosBlock = "## Tópicos\n" + lines.join("\n") + "\n";
  }

  let secoesBlock = "";
  if (result.secoes.length > 0) {
    const lines: string[] = [];
    for (const s of result.secoes) {
      lines.push("- " + s);
    }
    secoesBlock = "## Seções\n" + lines.join("\n") + "\n";
  }

  let decisoesBlock = "";
  if (result.decisoes.length > 0) {
    const lines: string[] = [];
    for (const d of result.decisoes) {
      lines.push("- " + d);
    }
    decisoesBlock = "## Decisões\n" + lines.join("\n") + "\n";
  }

  let acoesBlock = "";
  if (result.acoes.length > 0) {
    const lines: string[] = [];
    for (const a of result.acoes) {
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

  let liçoesBlock = "";
  if (result.licoes && result.licoes.length > 0) {
    const lines: string[] = [];
    for (const l of result.licoes) {
      lines.push("- " + l);
    }
    liçoesBlock = "## Lições Aprendidas\n" + lines.join("\n") + "\n";
  }

  const metadataBlock =
    "---\n*Extraída automaticamente via pipeline email-ingest em " +
    todayISODate() +
    "*\n---\n";

  const entry =
    "# Extração de E-mail - " +
    dateISO +
    "\n" +
    topicosBlock +
    secoesBlock +
    decisoesBlock +
    acoesBlock +
    liçoesBlock +
    metadataBlock;

  if (!existsSync(conhecimentoPath)) {
    writeFileSync(conhecimentoPath, entry, "utf8");
  } else {
    appendFileSync(conhecimentoPath, entry, "utf8");
  }

  return conhecimentoPath;
}

/**
 * Dispara hook de reindexação RAG no PostgreSQL/pgvector (best-effort).
 */
async function triggerRAGReindex(
  soulId: string,
  homeDir: string,
  emailBody: string
): Promise<void> {
  try {
    const { getPool } = await import("@assistente-os/core");
    const pool = getPool(
      "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"
    );
    await import("@assistente-os/memory");
  } catch (err) {
    console.debug("RAG reindex skipped (offline/fallback):", (err as Error).message);
  }
}

// ── Exportação principal ─────────────────────────────────────────────

export async function emailIngestPipeline(
  rawEmailBody: string,
  soulId?: string
): Promise<{
  conhecimentoPath: string;
  extractionResult: EmailExtractionResult;
  triggeredReindex: Promise<void>;
}> {
  const homeDir =
    process.env.ASSISTENTE_OS_HOME ||
    (require("node:os").homedir?.() || "~") + "/.assistant-os";

  const _core = await import("@assistente-os/core");
  const targetSoulId =
    soulId || _core.getActiveSoul(homeDir) || "main";

  // 1. Sanitizar
  const cleanBody = sanitizeEmailBody(rawEmailBody);

  // 2. Extrair via Ollama fetch
  const config = {
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    ollamaChatModel:
      process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free",
  };
  const extractionResult = await extractWithOllama(
    `Extraia JSON com chaves: topicos (string[]), secoes (string[]), decisoes (string[]), acoes (objectos com texto/responsavel/prazo), lições (string[]).

EMAIL BODY:
${cleanBody}`,
    config.ollamaUrl,
    config.ollamaChatModel
  );

  // 3. Persistir em Markdown
  const conhecimentoPath = writeEmailKnowledgeToMarkdown(
    join(homeDir, "souls", targetSoulId),
    extractionResult,
    todayISODate()
  );

  // 4. Trigger reindex (best-effort)
  const reindexPromise = triggerRAGReindex(targetSoulId, homeDir, cleanBody);

  return {
    conhecimentoPath,
    extractionResult,
    triggeredReindex: reindexPromise,
  };
}

// ── Teste standalone ─────────────────────────────────────────────────

if (require.main === module) {
  ;(async () => {
    const sampleEmail = `
De: fulano@empresa.com
Para: equipe@produto.com
Data: 2025-01-15

Olá equipe,

Decidimos adiar o lançamento para a próxima quinzena devido a bugs críticos encontrados no QA.

Tarefas:
- Corrigir bug de login no módulo auth
- Atualizar documentação da API

Atenciosamente,
Fulano
`;

    try {
      const result = await emailIngestPipeline(sampleEmail);
      console.log("✅ Pipeline email-ingest concluído:");
      console.log("   - Arquivo: " + result.conhecimentoPath);
      console.log("   - Tópicos: " + result.extractionResult.topicos.length);
      console.log("   - Decisões: " + result.extractionResult.decisoes.length);
      console.log("   - Ações: " + result.extractionResult.acoes.length);
      console.log(
        "   - Lições: " + (result.extractionResult.licoes?.length || 0)
      );
    } catch (err) {
      console.error("❌ Pipeline falhou:", err);
    }
  })();
}