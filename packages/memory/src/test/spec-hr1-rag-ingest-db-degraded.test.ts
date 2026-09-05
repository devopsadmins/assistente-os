/**
 * SPEC-HR1 (fatia 3, 2026-09-05): `indexFile`/`indexDirectory` vazavam a
 * exceção crua do driver `pg` quando o Postgres estava fora do ar — sem
 * fallback conceitual (o propósito do ingest RAG é popular o vetorial), o
 * objetivo aqui é só falhar rápido com mensagem clara em vez do timeout de
 * conexão de 5s do pool com uma mensagem técnica ilegível.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPool } from "@assistente-os/core";
import { LiteralEmbedder } from "../embedders.js";
import { indexFile } from "../indexer.js";

// Porta sem ninguém escutando — ECONNREFUSED rápido, sem esperar o
// connectionTimeoutMillis cheio (5s) do pool real.
const UNREACHABLE_DB_URL = "postgres://x:x@127.0.0.1:1/x";

test("SPEC-HR1: indexFile com Postgres inatingível lança mensagem clara, não a exceção crua do pg", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-hr1-rag-"));
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    const file = join(dir, "docs", "a.md");
    writeFileSync(file, "# Título\n\nConteúdo qualquer.\n");
    const pool = getPool(UNREACHABLE_DB_URL);
    const startedAt = Date.now();
    await assert.rejects(
      () => indexFile(pool, "s1", join(dir, "docs"), file, new LiteralEmbedder()),
      /Postgres indisponível/,
    );
    assert.ok(Date.now() - startedAt < 3000, "deveria falhar rápido via sonda (1.5s)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
