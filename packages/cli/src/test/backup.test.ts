import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFullBackup, pruneOldBackups } from "../backup.js";

// URL propositalmente inalcançável: exercita o caminho de degradação graciosa
// do dump do Postgres (pg_dump ausente OU conexão recusada — qualquer um dos
// dois deve falhar sem derrubar o backup dos arquivos), sem depender de infra
// real. O fallback via docker exec é desativado para o teste não tocar no
// Postgres real da máquina.
process.env.AOS_DISABLE_DOCKER_FALLBACK = "1";
const UNREACHABLE_DB_URL = "postgres://nope:nope@127.0.0.1:1/nope";

test("cria um ZIP completo sem incluir backups anteriores; dump do banco falha sem derrubar o backup", async () => {
  const home = await mkdtemp(join(tmpdir(), "assistente-os-backup-"));
  try {
    await mkdir(join(home, "souls", "main", "sessoes"), { recursive: true });
    await writeFile(join(home, "souls", "main", "perfil.md"), "perfil");
    await writeFile(join(home, "souls", "main", "sessoes", "sessao.md"), "sessao");
    await writeFile(join(home, ".env"), "SECRET=redacted");
    await writeFile(join(home, "active.json"), "{}");
    await writeFile(join(home, "backup-antigo.zip"), "antigo");
    await mkdir(join(home, ".backup-antigo"));

    const result = await createFullBackup(home, UNREACHABLE_DB_URL, new Date("2026-08-15T12:00:00.000Z"));
    const archive = new AdmZip(result.path);
    const names = archive.getEntries().map((entry) => entry.entryName);

    assert.ok(result.bytes > 0);
    assert.deepEqual(result.entries.sort(), [".env", "active.json", "souls"]);
    for (const name of ["souls/main/perfil.md", "souls/main/sessoes/sessao.md", ".env"]) {
      assert.ok(names.includes(name), `esperado no ZIP: ${name}`);
    }
    assert.ok(!names.some((name) => name.includes("backup-antigo")), "backups anteriores não devem entrar no ZIP");

    const manifestFiles = archive.getEntries().filter((entry) => entry.entryName.endsWith("/manifest.json"));
    assert.equal(manifestFiles.length, 1);
    const manifest = JSON.parse(archive.readAsText(manifestFiles[0]!.entryName)) as {
      createdAt: string;
      entries: string[];
      containsSecrets: boolean;
      database: { ok: boolean; error?: string };
    };
    assert.equal(manifest.createdAt, "2026-08-15T12:00:00.000Z");
    assert.deepEqual(manifest.entries.sort(), [".env", "active.json", "souls"]);
    assert.equal(manifest.containsSecrets, true);
    // dump falhou (URL inalcançável) — manifest registra o erro, mas o zip ainda foi gerado.
    assert.equal(manifest.database.ok, false);
    assert.match(manifest.database.error ?? "", /dump do banco/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("pruneOldBackups remove apenas ZIPs de backup mais antigos que a retenção", async () => {
  const home = await mkdtemp(join(tmpdir(), "assistente-os-backup-prune-"));
  try {
    const oldTime = new Date("2026-08-01T12:00:00.000Z");
    await writeFile(join(home, "backup-2026-08-01T12-00-00-abcd1234.zip"), "velho");
    await writeFile(join(home, "backup-2026-08-20T12-00-00-efgh5678.zip"), "novo");
    await writeFile(join(home, "outro.txt"), "x");
    await utimes(join(home, "backup-2026-08-01T12-00-00-abcd1234.zip"), oldTime, oldTime);

    const removed = await pruneOldBackups(home, 7, new Date("2026-08-21T12:00:00.000Z"));

    assert.deepEqual(removed, ["backup-2026-08-01T12-00-00-abcd1234.zip"]);
    await assert.rejects(stat(join(home, "backup-2026-08-01T12-00-00-abcd1234.zip")));
    await stat(join(home, "backup-2026-08-20T12-00-00-efgh5678.zip"));
    await stat(join(home, "outro.txt"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
