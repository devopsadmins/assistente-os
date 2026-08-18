import type { IncomingMessage } from "node:http";
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import Busboy from "busboy";
import AdmZip from "adm-zip";

export interface UploadedFileResult {
  name: string;
  bytes: number;
  /** Presente só para .zip: lista de entradas extraídas. */
  extracted?: string[];
}

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface UploadResult {
  saved: UploadedFileResult[];
  rejected: RejectedFile[];
}

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB por arquivo — documentos/texto, não mídia
const MAX_FILES = 30;

/** Defesa contra zip-slip/path traversal: garante que `target` continua dentro de `root`. */
function assertInside(root: string, target: string): void {
  const rootWithSep = normalize(root + sep);
  if (!normalize(target).startsWith(rootWithSep)) {
    throw new Error(`caminho fora do destino permitido`);
  }
}

/** Nome de arquivo seguro: descarta qualquer diretório embutido no nome enviado. */
function sanitizeBaseName(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).trim();
  if (!base || base === "." || base === "..") throw new Error(`nome de arquivo inválido: "${name}"`);
  return base;
}

/**
 * Extrai um .zip (via arquivo temp) para dentro de `destDir`, rejeitando
 * entradas que tentem escapar. Escreve os bytes de cada entrada diretamente
 * no path já validado (não delega o join de path pra lib de zip).
 */
function extractZip(zipPath: string, destDir: string): string[] {
  const zip = new AdmZip(zipPath);
  const extracted: string[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.replace(/\\/g, "/");
    if (entryName.split("/").some((seg) => seg === "..")) {
      throw new Error(`entrada de zip suspeita (path traversal): ${entryName}`);
    }
    const targetPath = join(destDir, entryName);
    assertInside(destDir, targetPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, entry.getData());
    extracted.push(entryName);
  }
  return extracted;
}

/**
 * Recebe um POST multipart/form-data (campo "files", um ou mais arquivos) e
 * grava cada um em `uploadsDir`. Arquivos .zip são extraídos (com defesa
 * contra zip-slip); os demais são salvos como estão, com nome sanitizado.
 */
export async function handleUpload(req: IncomingMessage, uploadsDir: string): Promise<UploadResult> {
  mkdirSync(uploadsDir, { recursive: true });
  const stagingDir = await mkdtemp(join(tmpdir(), "aos-upload-"));
  const saved: UploadedFileResult[] = [];
  const rejected: RejectedFile[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      let busboyError: Error | null = null;
      const bb = Busboy({
        headers: req.headers as Record<string, string>,
        limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
      });
      const pending: Promise<void>[] = [];

      bb.on("file", (_field, stream, info) => {
        const tempPath = join(stagingDir, randomUUID());
        const out = createWriteStream(tempPath);
        let truncated = false;
        stream.on("limit", () => {
          truncated = true;
        });
        const task = new Promise<void>((res) => {
          out.on("close", () => {
            if (truncated) {
              rejected.push({ name: info.filename, reason: `excede o limite de ${MAX_FILE_BYTES / 1024 / 1024}MB` });
              rmSync(tempPath, { force: true });
              res();
              return;
            }
            try {
              const bytes = statSync(tempPath).size;
              const safeName = sanitizeBaseName(info.filename);
              if (safeName.toLowerCase().endsWith(".zip")) {
                const destDir = join(uploadsDir, safeName.replace(/\.zip$/i, ""));
                const extracted = extractZip(tempPath, destDir);
                saved.push({ name: safeName, bytes, extracted });
              } else {
                const targetPath = join(uploadsDir, safeName);
                assertInside(uploadsDir, targetPath);
                renameSync(tempPath, targetPath);
                saved.push({ name: safeName, bytes });
              }
            } catch (err) {
              rejected.push({ name: info.filename, reason: err instanceof Error ? err.message : String(err) });
            } finally {
              rmSync(tempPath, { force: true });
            }
            res();
          });
        });
        stream.pipe(out);
        pending.push(task);
      });

      bb.on("error", (err) => {
        busboyError = err instanceof Error ? err : new Error(String(err));
      });
      bb.on("close", async () => {
        await Promise.all(pending);
        if (busboyError) reject(busboyError);
        else resolve();
      });
      req.pipe(bb);
    });
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }

  return { saved, rejected };
}
