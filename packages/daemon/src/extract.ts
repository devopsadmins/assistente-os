/**
 * FM1 — extração de texto de documentos (PDF/DOCX/XLSX) para o upload
 * self-service. O texto vira um sidecar `.md` ao lado do arquivo, que segue
 * pelo caminho normal de indexação RAG. DOCX/XLSX são zip+XML (parse manual
 * via adm-zip); só o PDF precisa de um parser dedicado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import AdmZip from "adm-zip";

export const DOC_EXT_RE = /\.(pdf|docx|xlsx)$/i;

export type ExtractResult = { ok: true; text: string } | { ok: false; reason: string };

/** Teto defensivo — um XLSX gigante não deve estourar a memória do daemon. */
const MAX_TEXT_CHARS = 5_000_000;

function clamp(text: string): string {
  return text.length <= MAX_TEXT_CHARS
    ? text
    : text.slice(0, MAX_TEXT_CHARS) + "\n\n[…texto truncado em 5.000.000 caracteres…]";
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

type PdfParse = (b: Buffer) => Promise<{ text?: string }>;
let pdfParsePromise: Promise<PdfParse> | null = null;

function loadPdfParse(): Promise<PdfParse> {
  // Importa o módulo interno de propósito: o index.js do pdf-parse roda um
  // bloco de "debug" no import quando não há `module.parent` (ESM) e quebra
  // tentando ler um PDF de teste inexistente.
  pdfParsePromise ??= import("pdf-parse/lib/pdf-parse.js").then(
    (m) => (m as unknown as { default: PdfParse }).default,
  );
  return pdfParsePromise;
}

async function extractPdf(buf: Buffer): Promise<ExtractResult> {
  const pdfParse = await loadPdfParse();

  // Uma retentativa cobre falhas transitórias do pdf.js antigo do pdf-parse;
  // um PDF de fato corrompido falha as duas vezes.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = await pdfParse(buf);
      const text = (parsed.text ?? "").trim();
      if (!text) return { ok: false, reason: "PDF sem camada de texto extraível (escaneado?) ou protegido" };
      return { ok: true, text: clamp(text) };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, reason: `PDF ilegível (${lastErr instanceof Error ? lastErr.message : String(lastErr)})` };
}

function extractDocx(buf: Buffer): ExtractResult {
  const entry = new AdmZip(buf).getEntry("word/document.xml");
  if (!entry) return { ok: false, reason: "DOCX inválido (sem word/document.xml)" };
  const xml = entry.getData().toString("utf8");
  const paragraphs = xml.split(/<\/w:p>/).map((chunk) => {
    const runs = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1]!));
    return runs.join("").replace(/<w:tab\/>/g, "\t");
  });
  const text = paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) return { ok: false, reason: "DOCX sem texto" };
  return { ok: true, text: clamp(text) };
}

function extractXlsx(buf: Buffer): ExtractResult {
  const zip = new AdmZip(buf);
  const readXml = (name: string) => zip.getEntry(name)?.getData().toString("utf8") ?? "";

  const shared = [...readXml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!)).join(""),
  );

  const sheetNames = [...readXml("xl/workbook.xml").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) =>
    decodeXml(m[1]!),
  );

  const sheetFiles = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));

  const parts: string[] = [];
  sheetFiles.forEach((file, i) => {
    const xml = readXml(file);
    const rows: string[] = [];
    for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cellM of rowM[1]!.matchAll(
        /<c\b([^>]*)>(?:<v>([\s\S]*?)<\/v>|<is>(?:<t[^>]*>([\s\S]*?)<\/t>)?<\/is>)?<\/c>/g,
      )) {
        const attrs = cellM[1] ?? "";
        const v = cellM[2];
        const inline = cellM[3];
        let value = "";
        if (inline != null) value = decodeXml(inline);
        else if (v != null) value = /\bt="s"/.test(attrs) ? shared[Number(v)] ?? "" : decodeXml(v);
        cells.push(value);
      }
      const line = cells.join(" | ").trimEnd();
      if (line.replace(/[\s|]/g, "")) rows.push(line);
    }
    if (rows.length) parts.push(`## ${sheetNames[i] ?? `Planilha ${i + 1}`}\n\n${rows.join("\n")}`);
  });

  const text = parts.join("\n\n").trim();
  if (!text) return { ok: false, reason: "XLSX sem células com conteúdo" };
  return { ok: true, text: clamp(text) };
}

/** Extrai texto de um PDF/DOCX/XLSX. Nunca lança — sempre devolve um resultado. */
export async function extractDocumentText(filePath: string): Promise<ExtractResult> {
  const ext = filePath.toLowerCase().match(DOC_EXT_RE)?.[1];
  if (!ext) return { ok: false, reason: "formato não suportado" };

  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    return { ok: false, reason: `não foi possível ler o arquivo (${err instanceof Error ? err.message : String(err)})` };
  }

  try {
    if (ext === "pdf") return await extractPdf(buf);
    if (ext === "docx") return extractDocx(buf);
    return extractXlsx(buf);
  } catch (err) {
    return { ok: false, reason: `falha ao extrair (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * Grava `<filePath>.md` com o texto extraído + um cabeçalho de origem, e
 * devolve o caminho do sidecar. É esse `.md` que a indexação RAG consome.
 */
export function writeKnowledgeSidecar(filePath: string, text: string): string {
  const sidecar = `${filePath}.md`;
  const name = basename(filePath);
  const date = new Date().toISOString().slice(0, 10);
  const header =
    `# ${name}\n\n` + `> Conhecimento extraído automaticamente de \`${name}\` no upload (${date}).\n\n`;
  writeFileSync(sidecar, header + text.trim() + "\n");
  return sidecar;
}
