import { createWriteStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ZipArchive } from "archiver";

const execFileAsync = promisify(execFile);

export interface BackupResult {
  path: string;
  bytes: number;
  entries: string[];
}

/**
 * Backup completo: souls/, config/.env e demais arquivos de `home` (cópia de
 * arquivo simples — não há mais bancos SQLite embutidos aí) + um dump do
 * Postgres via `pg_dump --format=custom` (requer pg_dump no PATH; vem com o
 * pacote `postgresql-client` no Linux ou a instalação completa do Postgres).
 * Restaurar com: `pg_restore --clean --if-exists -d <DATABASE_URL> database.dump`.
 */
export async function createFullBackup(home: string, databaseUrl: string, now = new Date()): Promise<BackupResult> {
  if (!existsSync(home)) throw new Error(`home do Assistente OS não encontrada: ${home}`);

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const runId = randomUUID().slice(0, 8);
  const outputPath = join(home, `backup-${stamp}-${runId}.zip`);
  const partialPath = `${outputPath}.partial`;
  const outputName = basename(outputPath);
  const dirEntries = await readdir(home, { withFileTypes: true });
  const included = dirEntries.filter((entry) => !isPreviousBackup(entry.name) && entry.name !== outputName);
  const staging = await mkdtemp(join(tmpdir(), "assistente-os-backup-"));
  const archive = new ZipArchive({ level: 9 });
  let output: ReturnType<typeof createWriteStream> | undefined;
  let published = false;

  try {
    for (const entry of included) {
      await stageEntry(home, staging, entry.name, entry.isDirectory(), entry.isFile(), entry.isSymbolicLink());
    }

    let databaseDumpError: string | undefined;
    try {
      await dumpDatabase(databaseUrl, join(staging, "database.dump"));
    } catch (err) {
      databaseDumpError = err instanceof Error ? err.message : String(err);
    }

    const metadataName = `__assistente_os_backup_${runId}__`;
    const metadataDir = join(staging, metadataName);
    await mkdir(metadataDir);
    await writeFile(
      join(metadataDir, "manifest.json"),
      JSON.stringify(
        {
          createdAt: now.toISOString(),
          sourceHome: home,
          entries: included.map((entry) => entry.name),
          containsSecrets: included.some((entry) => entry.name === ".env"),
          database: databaseDumpError ? { ok: false, error: databaseDumpError } : { ok: true, file: "database.dump" },
        },
        null,
        2,
      ),
    );
    if (databaseDumpError) {
      console.error(`aviso: dump do banco falhou, backup segue só com os arquivos de ${home}: ${databaseDumpError}`);
    }

    output = createWriteStream(partialPath, { flags: "wx", mode: 0o600 });
    const completed = new Promise<void>((resolve, reject) => {
      output?.on("close", resolve);
      output?.on("error", reject);
      archive.on("error", reject);
      archive.on("warning", reject);
    });
    archive.pipe(output);
    archive.directory(staging, false);
    await Promise.all([archive.finalize(), completed]);
    await rename(partialPath, outputPath);
    published = true;
    await chmod(outputPath, 0o600);
    const info = await stat(outputPath);
    return { path: outputPath, bytes: info.size, entries: included.map((entry) => entry.name) };
  } catch (error) {
    archive.abort();
    output?.destroy();
    await rm(partialPath, { force: true });
    if (published) await rm(outputPath, { force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function dumpDatabase(databaseUrl: string, destination: string): Promise<void> {
  try {
    await execFileAsync("pg_dump", ["--format=custom", `--file=${destination}`, databaseUrl]);
  } catch (err: any) {
    // pg_dump pode não estar instalado (ENOENT) ou o banco pode ser inacessível.
    // Em ambos os casos, o backup segue apenas com os arquivos — o manifest
    // registra o erro para que o cliente saiba que o dump não foi gerado.
    const isENOENT = err.code === "ENOENT";
    throw new Error(
      `dump do banco ${isENOENT ? "não encontrado (instale postgresql-client)" : "falhou"}: ${err.message || String(err)}`,
    );
  }
}

async function stageEntry(
  home: string,
  staging: string,
  name: string,
  isDirectory: boolean,
  isFile: boolean,
  isSymbolicLink: boolean,
): Promise<void> {
  const source = join(home, name);
  const destination = join(staging, name);

  if (isDirectory || isFile || isSymbolicLink) {
    await cp(source, destination, { recursive: isDirectory, preserveTimestamps: true, verbatimSymlinks: true });
    return;
  }
  throw new Error(`tipo de arquivo não suportado no backup: ${source}`);
}

function isPreviousBackup(name: string): boolean {
  return /^backup-.*\.zip(?:\.partial)?$/i.test(name) || /^\.backup-/.test(name);
}
