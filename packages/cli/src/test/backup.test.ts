import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFullBackup } from "../backup.js";

// URL propositalmente inalcançável: exercita o caminho de degradação graciosa
// do dump do Postgres (pg_dump ausente OU conexão recusada — qualquer um dos
// dois deve falhar sem derrubar o backup dos arquivos), sem depender de infra
// real (nem Postgres nem pg_dump precisam estar disponíveis pra este teste passar).
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
    const archive = await readFile(result.path);
    const index = archive.toString("latin1");

    assert.equal(archive.subarray(0, 2).toString(), "PK");
    assert.ok(result.bytes > 0);
    assert.deepEqual(result.entries.sort(), [".env", "active.json", "souls"]);
    for (const name of ["souls/main/perfil.md", "souls/main/sessoes/sessao.md", ".env", "manifest.json"]) {
      assert.match(index, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(index, /backup-antigo/);
    // dump falhou (URL inalcançável) — manifest registra o erro, mas o zip ainda foi gerado.
    assert.doesNotMatch(index, /database\.dump/);
    assert.match(index, /"database"/);
    assert.match(index, /"ok":\s*false/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
