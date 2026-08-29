import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFrontmatter, resolveSkillPath, scanSkillDirs, listSkills, matchSkills, skillMatchThreshold, renderSkillsPrompt, renderSkillsIndex, renderActiveSkills, type LoadedSkill } from "../skills.js";
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

// ── Task 3: matcher ─────────────────────────────────────────────────────

const mk = (name: string, description: string, keywords: string[] = []): LoadedSkill => ({
  name, description, keywords, tools: [], scope: "global", path: `/x/${name}`, body: `corpo ${name}`, bytes: 10,
});

test("matchSkills léxico: keyword frase inteira dá boost e entra acima do threshold", async () => {
  const skills = [
    mk("followup", "redigir follow-up de reunião comercial", ["próximos passos", "recap"]),
    mk("outra", "assunto totalmente diferente sobre jardinagem"),
  ];
  const res = await matchSkills("me faz um recap da call com próximos passos", skills, { max: 3 });
  assert.equal(res[0]!.skill.name, "followup");
  assert.ok(res[0]!.score >= skillMatchThreshold());
  assert.ok(res.every((m) => m.skill.name !== "outra"));
  assert.ok(res[0]!.lexicalHits.includes("recap") || res[0]!.lexicalHits.includes("próximos passos"));
});

test("matchSkills: nada casa → []", async () => {
  const res = await matchSkills("xyz abc def", [mk("aa", "sobre contabilidade e impostos")], { max: 3 });
  assert.deepEqual(res, []);
});

test("matchSkills: respeita max", async () => {
  const skills = [mk("aa", "deploy pm2"), mk("bb", "deploy docker"), mk("cc", "deploy vps"), mk("dd", "deploy tunnel")];
  const res = await matchSkills("como fazer deploy", skills, { threshold: 0.01, max: 2 });
  assert.equal(res.length, 2);
});

test("matchSkills: embed que lança → auto-skip para só-léxico (não quebra)", async () => {
  const skills = [mk("aa", "deploy pm2 na vps")];
  const res = await matchSkills("deploy pm2", skills, {
    threshold: 0.01, max: 3,
    embed: async () => { throw new Error("embedder off"); },
  });
  assert.equal(res.length, 1);
  assert.equal(res[0]!.usedEmbedding, false);
});

test("matchSkills: embed ok → usedEmbedding true e score combina léxico+embedding", async () => {
  const skills = [mk("aa", "deploy pm2 na vps")];
  const fakeEmbed = async (texts: string[]) => texts.map(() => [1, 0, 0]);
  const res = await matchSkills("qualquer coisa", skills, { threshold: 0.01, max: 3, embed: fakeEmbed });
  assert.equal(res[0]!.usedEmbedding, true);
  assert.ok(res[0]!.score >= 0.5);
});

// ── Task 4: renderer ────────────────────────────────────────────────────

test("renderSkillsPrompt: índice sempre; corpo só das ativas; tool indisponível marcada", () => {
  const a = mk("xx", "faz X");
  const b = mk("yy", "faz Y");
  b.tools = ["tool_ok", "tool_no"];
  const out = renderSkillsPrompt([a, b], [{ skill: b, score: 0.9, lexicalHits: [], usedEmbedding: false }], (t) => t === "tool_ok");
  assert.match(out, /## Skills disponíveis/);
  assert.match(out, /- xx — faz X/);
  assert.match(out, /- yy — faz Y/);
  assert.match(out, /## Skill ativa: yy/);
  assert.match(out, /corpo yy/);
  assert.doesNotMatch(out, /## Skill ativa: xx/);
  assert.match(out, /`tool_ok`/);
  assert.match(out, /`tool_no` \(indisponível para esta soul\)/);
});

test("renderSkillsPrompt: sem skills → string vazia", () => {
  assert.equal(renderSkillsPrompt([], [], () => true), "");
});

test("renderSkillsIndex / renderActiveSkills: split byte-idêntico ao renderSkillsPrompt (Etapa 9)", () => {
  const a = mk("xx", "faz X");
  const b = mk("yy", "faz Y");
  b.tools = ["tool_ok", "tool_no"];
  const active = [{ skill: b, score: 0.9, lexicalHits: [], usedEmbedding: false }];
  const allow = (t: string) => t === "tool_ok";

  const idx = renderSkillsIndex([a, b]);
  const act = renderActiveSkills(active, allow);
  assert.match(idx, /^## Skills disponíveis/);
  assert.doesNotMatch(idx, /## Skill ativa/);
  assert.match(act, /^## Skill ativa: yy/);
  assert.doesNotMatch(act, /## Skills disponíveis/);

  assert.equal(renderSkillsPrompt([a, b], active, allow), `${idx}\n\n${act}`);
  assert.equal(renderSkillsIndex([]), "");
  assert.equal(renderActiveSkills([], allow), "");
});

test("renderActiveSkills: dois corpos separados por linha em branco", () => {
  const b = mk("b1", "d");
  const c = mk("c1", "d");
  const out = renderActiveSkills(
    [
      { skill: b, score: 1, lexicalHits: [], usedEmbedding: false },
      { skill: c, score: 1, lexicalHits: [], usedEmbedding: false },
    ],
    () => true,
  );
  assert.match(out, /## Skill ativa: b1\ncorpo b1\n\n## Skill ativa: c1\ncorpo c1/);
});
