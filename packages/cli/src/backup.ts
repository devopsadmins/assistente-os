import { createWriteStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipArchive } from "archiver";

const execFileAsync = promisify(execFile);

export interface BackupResult {
  path: string;
  bytes: number;
  entries: string[];
}

/**
 * Backup completo: souls/, config/.env e demais arquivos de `home` + um dump
 * do Postgres via `pg_dump --format=custom`. O ZIP vai para `backupDir` — um
 * diretório separado de `home` de propósito, para que a retenção (que apaga
 * arquivos) nunca rode misturada com os dados vivos. Se o pg_dump não estiver
 * instalado no host, usa o cliente de dentro do container Docker do Postgres
 * (detectado via `docker ps`; desative com AOS_DISABLE_DOCKER_FALLBACK=1).
 * Restaurar com: `pg_restore --clean --if-exists -d <DATABASE_URL> database.dump`.
 */
export async function createFullBackup(
  home: string,
  databaseUrl: string,
  backupDir: string,
  now = new Date(),
): Promise<BackupResult> {
  if (!existsSync(home)) throw new Error(`home do Assistente OS não encontrada: ${home}`);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const runId = randomUUID().slice(0, 8);
  const outputPath = join(backupDir, `backup-${stamp}-${runId}.zip`);
  const partialPath = `${outputPath}.partial`;
  const dirEntries = await readdir(home, { withFileTypes: true });
  const included = dirEntries.filter((entry) => !isPreviousBackup(entry.name));
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

export async function pruneOldBackups(backupDir: string, retentionDays: number, now = new Date()): Promise<string[]> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(backupDir, { withFileTypes: true });
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^backup-.*\.zip$/i.test(entry.name)) continue;
    const path = join(backupDir, entry.name);
    const info = await stat(path);
    if (info.mtimeMs >= cutoff) continue;
    await rm(path, { force: true });
    removed.push(entry.name);
  }
  return removed;
}

async function dumpDatabase(databaseUrl: string, destination: string): Promise<void> {
  const url = new URL(databaseUrl);

  try {
    await runPgDump("pg_dump", ["--format=custom", databaseUrl], destination);
    return;
  } catch (err: any) {
    // Sem pg_dump no host (ENOENT), usa o cliente de dentro do container Docker
    // do Postgres (mesma versão do servidor; stream via stdout). Qualquer outra
    // falha (banco inacessível, credenciais) não tem fallback.
    if (err.code !== "ENOENT") {
      throw new Error(`dump do banco falhou: ${err.message || String(err)}`);
    }
  }

  const container = await findPostgresContainer();
  if (!container) {
    throw new Error("dump do banco não encontrado: instale postgresql-client ou suba o Postgres via Docker");
  }
  const user = url.username || "postgres";
  const database = url.pathname.replace(/^\//, "") || "postgres";
  try {
    await runPgDump(
      "docker",
      ["exec", container, "pg_dump", "--format=custom", `--username=${user}`, database],
      destination,
    );
  } catch (err: any) {
    throw new Error(`dump do banco falhou (via docker exec ${container}): ${err.message || String(err)}`);
  }
}

// O dump vem pelo stdout (pg_dump -Fc aceita stream) e é gravado direto no ZIP
// de staging — nada é escrito no FS do container nem do host fora do backup.
async function runPgDump(command: string, args: string[], destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = createWriteStream(destination);
    child.stdout.pipe(out);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    out.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && out.writableFinished) resolve();
      else reject(Object.assign(new Error(`saiu com código ${code}: ${stderr.trim()}`), { code }));
    });
  });
}

async function findPostgresContainer(): Promise<string | undefined> {
  if (process.env.AOS_DISABLE_DOCKER_FALLBACK === "1") return undefined;
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}} {{.Image}}"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /postgres/i.test(line))
      ?.split(" ")[0];
  } catch {
    return undefined;
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
