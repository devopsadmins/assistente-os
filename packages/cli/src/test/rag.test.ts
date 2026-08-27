import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isIndexStale } from "../rag.js";

function tmpSoul(): string {
  const dir = mkdtempSync(join(tmpdir(), "aos-stale-"));
  mkdirSync(join(dir, "conhecimento"), { recursive: true });
  writeFileSync(join(dir, "perfil.md"), "# soul\n");
  writeFileSync(join(dir, "conhecimento", "a.md"), "conteudo\n");
  return dir;
}

test("isIndexStale: markdown mais novo que lastIndexedAt → defasado", () => {
  const dir = tmpSoul();
  try {
    const past = new Date(Date.now() - 3600_000).toISOString();
    assert.equal(isIndexStale(dir, past), true);

    const future = new Date(Date.now() + 3600_000).toISOString();
    assert.equal(isIndexStale(dir, future), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isIndexStale: nunca indexado com arquivos → defasado; sem arquivos → não", () => {
  const dir = tmpSoul();
  try {
    assert.equal(isIndexStale(dir, null), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const empty = mkdtempSync(join(tmpdir(), "aos-empty-"));
  try {
    assert.equal(isIndexStale(empty, null), false);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("isIndexStale: só conta a mtime mais recente dos .md/.txt", () => {
  const dir = tmpSoul();
  try {
    const t = Date.now() / 1000;
    utimesSync(join(dir, "perfil.md"), t - 10000, t - 10000);
    utimesSync(join(dir, "conhecimento", "a.md"), t - 10000, t - 10000);
    const between = new Date(Date.now() - 5000_000).toISOString();
    assert.equal(isIndexStale(dir, between), false, "índice depois dos dois arquivos");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
