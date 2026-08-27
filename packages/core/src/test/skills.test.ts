import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFrontmatter, resolveSkillPath, scanSkillDirs, listSkills } from "../skills.js";
import { createSoulFull } from "../souls.js";
import type { Soul } from "../souls.js";

const OK = `---
name: sales-followup
description: Redigir follow-up de reunião
keywords: [recap, pós-call]
tools:
  - sales_get_lead_brief
  - soul_anotar
---
Corpo da skill.
Segunda linha.`;

test("parseSkillFrontmatter: frontmatter válido", () => {
  const r = parseSkillFrontmatter(OK);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.frontmatter.name, "sales-followup");
  assert.equal(r.frontmatter.description, "Redigir follow-up de reunião");
  assert.deepEqual(r.frontmatter.keywords, ["recap", "pós-call"]);
  assert.deepEqual(r.frontmatter.tools, ["sales_get_lead_brief", "soul_anotar"]);
  assert.match(r.body, /^Corpo da skill\.\nSegunda linha\.$/);
});

test("parseSkillFrontmatter: sem name → issue", () => {
  const r = parseSkillFrontmatter("---\ndescription: x\n---\ncorpo");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.issues.some((i) => /name/.test(i)));
});

test("parseSkillFrontmatter: name inválido / description longa / keywords não-lista", () => {
  const r = parseSkillFrontmatter(`---\nname: Bad Name\ndescription: ${"x".repeat(300)}\nkeywords: nao-e-lista\n---\nc`);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.issues.some((i) => /name/.test(i)));
  assert.ok(r.issues.some((i) => /description/.test(i)));
  assert.ok(r.issues.some((i) => /keywords/.test(i)));
});

test("parseSkillFrontmatter: sem delimitador → issue", () => {
  assert.equal(parseSkillFrontmatter("só corpo, sem frontmatter").ok, false);
});

test("parseSkillFrontmatter: keywords/tools ausentes viram []", () => {
  const r = parseSkillFrontmatter("---\nname: minima\ndescription: d\n---\nc");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.frontmatter.keywords, []);
  assert.deepEqual(r.frontmatter.tools, []);
});

// ── Task 2: descoberta + loader ──────────────────────────────────────────

function skillHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aos-skills-"));
  const g = join(home, "skills", "compartilhada");
  mkdirSync(g, { recursive: true });
  writeFileSync(join(g, "SKILL.md"), "---\nname: compartilhada\ndescription: skill global\nkeywords: [global-x]\n---\nCorpo global.");
  createSoulFull(home, "main", { name: "main" });
  const s = join(home, "souls", "main", "skills", "local");
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, "SKILL.md"), "---\nname: local\ndescription: skill da soul\n---\nCorpo local.");
  const ov = join(home, "souls", "main", "skills", "compartilhada");
  mkdirSync(ov, { recursive: true });
  writeFileSync(join(ov, "SKILL.md"), "---\nname: compartilhada\ndescription: override da soul\n---\nCorpo override.");
  return home;
}

test("resolveSkillPath: per-soul vence global; null se ausente", () => {
  const home = skillHome();
  try {
    assert.equal(resolveSkillPath(home, "main", "compartilhada")!.scope, "soul");
    assert.equal(resolveSkillPath(home, "main", "local")!.scope, "soul");
    assert.equal(resolveSkillPath(home, "main", "inexistente"), null);
    createSoulFull(home, "outra", { name: "outra" });
    assert.equal(resolveSkillPath(home, "outra", "compartilhada")!.scope, "global");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("scanSkillDirs: lista tudo que existe, sem allowlist", () => {
  const home = skillHome();
  try {
    const names = scanSkillDirs(home, "main").map((s) => `${s.name}:${s.scope}`).sort();
    assert.deepEqual(names, ["compartilhada:soul", "local:soul"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listSkills: só as da allowlist, resolvidas; ignora nome não resolvível", () => {
  const home = skillHome();
  try {
    const soul = {
      id: "main",
      dir: join(home, "souls", "main"),
      config: { name: "main", agent: { permissions: { tools: [], skills: ["local", "fantasma"] }, guardrails: {} } },
    } as unknown as Soul;
    const loaded = listSkills(home, soul);
    assert.deepEqual(loaded.map((s) => s.name), ["local"]);
    assert.equal(loaded[0]!.scope, "soul");
    assert.match(loaded[0]!.body, /Corpo local\./);
    assert.ok(loaded[0]!.bytes > 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listSkills: allowlist vazia → []", () => {
  const home = skillHome();
  try {
    const soul = { id: "main", dir: join(home, "souls", "main"), config: { name: "main" } } as unknown as Soul;
    assert.deepEqual(listSkills(home, soul), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
