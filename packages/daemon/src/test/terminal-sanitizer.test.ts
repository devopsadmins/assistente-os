/**
 * Testes unitários do terminal-sanitizer.
 *
 * Uso: node --test dist/test/terminal-sanitizer.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TerminalSanitizer,
  sanitizeCommandOutput,
  defaultSanitizer,
} from "../tools/terminal-sanitizer.js";

describe("terminal-sanitizer", () => {
  const npmTestOutput = `
> assistente-os@0.1.0 test
> node --test dist/**/*.test.js

✓ packages/core/src/test/core.test.js (5 tests)
✓ packages/daemon/src/test/orchestrator-router.test.js (17 tests)
✓ packages/daemon/src/test/browser.test.js (3 tests)
✕ packages/daemon/src/test/meeting-ingest.test.js (2 tests, 1 failed)
  ● meeting-ingest › should ingest meeting
    AssertionError: expected 1 to equal 2

Test Suites: 1 failed, 3 passed
Tests:       1 failed, 27 passed
  `.trim();

  const gitStatusOutput = `
On branch main
Your branch is up to date with 'origin/main'.

Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
	modified:   packages/core/src/policy.ts
	new file:   packages/daemon/src/tools/worktree-manager.ts

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
	modified:   packages/daemon/src/orchestrator/router.ts

Untracked files:
  (use "git add <file>..." to include in your commit)
	packages/daemon/src/tools/terminal-sanitizer.ts
  `.trim();

  const lsOutput = `
total 124
drwxr-xr-x  10 user  staff   320 Aug 26 10:00 .
drwxr-xr-x   5 user  staff   160 Aug 26 09:00 ..
-rw-r--r--   1 user  staff  2048 Aug 26 10:00 package.json
-rw-r--r--   1 user  staff   512 Aug 26 10:00 README.md
drwxr-xr-x   6 user  staff   192 Aug 26 10:00 packages
drwxr-xr-x   3 user  staff    96 Aug 26 10:00 docs
drwxr-xr-x   2 user  staff    64 Aug 26 10:00 scripts
-rw-r--r--   1 user  staff   128 Aug 26 10:00 .gitignore
  `.trim();

  // ── npm test ────────────────────────────────────────────────────────

  it("npm test output: mantém apenas summary + erros", () => {
    const result = sanitizeCommandOutput("npm test", npmTestOutput);
    assert.ok(result.truncated);
    assert.ok(result.sanitized.includes("Test Suites:"));
    assert.ok(result.sanitized.includes("Tests:"));
    assert.ok(result.sanitized.includes("1 failed"));
    assert.ok(result.sanitized.includes("27 passed"));
    assert.ok(!result.sanitized.includes("> assistente-os@0.1.0 test"));
    assert.ok(result.keptLines < 20);
  });

  // ── git status ──────────────────────────────────────────────────────

  it("git status: mantém apenas modified/new/deleted", () => {
    const result = sanitizeCommandOutput("git status", gitStatusOutput);
    assert.ok(result.truncated);
    assert.ok(result.sanitized.includes("modified:"));
    assert.ok(result.sanitized.includes("new file:"));
    assert.ok(result.sanitized.includes("Untracked files:"));
    assert.ok(!result.sanitized.includes("On branch main"));
    assert.ok(!result.sanitized.includes("Your branch is up to date"));
  });

  // ── ls -la ──────────────────────────────────────────────────────────

  it("ls -la: mantém total + arquivos relevantes", () => {
    const result = sanitizeCommandOutput("ls -la", lsOutput);
    assert.ok(result.sanitized.includes("total 124"));
    assert.ok(result.sanitized.includes("package.json"));
    assert.ok(result.sanitized.includes("README.md"));
    // .gitignore deve ser mantido (padrão .*ignore)
    assert.ok(result.sanitized.includes(".gitignore"));
  });

  // ── Comando desconhecido ────────────────────────────────────────────

  it("comando desconhecido: passa direto (sem regra)", () => {
    const output = "linha 1\nlinha 2\nlinha 3";
    const result = sanitizeCommandOutput("comando-desconhecido", output);
    assert.equal(result.truncated, false);
    assert.equal(result.sanitized, output);
    assert.equal(result.keptLines, 3);
    assert.equal(result.discardedLines, 0);
  });

  // ── stderr com erro ─────────────────────────────────────────────────

  it("stderr com erro: sempre preservado", () => {
    const stdout = "stdout normal";
    const stderr = "Error: algo falhou\n    at test.js:10";
    const result = sanitizeCommandOutput("npm test", stdout, stderr);
    assert.ok(result.sanitized.includes("Error: algo falhou"));
    assert.ok(result.sanitized.includes("at test.js:10"));
  });

  // ── Regra custom ────────────────────────────────────────────────────

  it("regra custom: sobrescreve built-in", () => {
    const customSanitizer = new TerminalSanitizer([
      {
        commandPattern: /^custom-cmd/,
        maxLines: 2,
        keepPatterns: [/keep/],
        discardPatterns: [/discard/],
      },
    ]);
    const output = "keep this\ndiscard this\nkeep this too\nanother line";
    const result = customSanitizer.sanitize("custom-cmd", output);
    assert.ok(result.sanitized.includes("keep this"));
    assert.ok(!result.sanitized.includes("discard this"));
    assert.equal(result.keptLines, 2); // maxLines = 2
  });

  // ── Output vazio ────────────────────────────────────────────────────

  it("output vazio: retorna vazio", () => {
    const result = sanitizeCommandOutput("npm test", "");
    assert.equal(result.sanitized, "");
    assert.equal(result.keptLines, 0);
  });

  // ── Linhas ANSI color ──────────────────────────────────────────────

  it("linhas ANSI color: strip antes de processar", () => {
    const output = "\x1b[32mPASS\x1b[0m test passed\n\x1b[31mFAIL\x1b[0m test failed";
    const result = sanitizeCommandOutput("npm test", output);
    assert.ok(!result.sanitized.includes("\x1b["));
    assert.ok(result.sanitized.includes("PASS"));
    assert.ok(result.sanitized.includes("FAIL"));
  });

  // ── maxLines=0 ──────────────────────────────────────────────────────

  it("maxLines=0: descarta tudo exceto keepPatterns", () => {
    const customSanitizer = new TerminalSanitizer([
      {
        commandPattern: /^zero-cmd/,
        maxLines: 0,
        keepPatterns: [/important/],
        discardPatterns: [],
      },
    ]);
    const output = "line 1\nimportant line\nline 3";
    const result = customSanitizer.sanitize("zero-cmd", output);
    assert.equal(result.keptLines, 1);
    assert.ok(result.sanitized.includes("important line"));
  });

  // ── summaryExtractor custom ────────────────────────────────────────

  it("summaryExtractor custom: usa função fornecida", () => {
    const customSanitizer = new TerminalSanitizer([
      {
        commandPattern: /^summary-cmd/,
        maxLines: 10,
        keepPatterns: [],
        discardPatterns: [],
        summaryExtractor: (out) => `CUSTOM: ${out.split("\n").length} lines`,
      },
    ]);
    const output = "line 1\nline 2\nline 3";
    const result = customSanitizer.sanitize("summary-cmd", output);
    assert.ok(result.sanitized.startsWith("CUSTOM: 3 lines"));
  });
});