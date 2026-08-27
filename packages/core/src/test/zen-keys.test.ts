import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseZenApiKeys, resolveZenApiKeys, nextZenApiKey, __resetZenRotation } from "../zen-keys.js";
import { loadConfig } from "../config.js";

test("parseZenApiKeys: ZEN_API_KEYS separado por vírgula e quebra de linha, ignora espaços/vazios", () => {
  const keys = parseZenApiKeys({ ZEN_API_KEYS: " a, b ,\n c ,, \n" } as NodeJS.ProcessEnv);
  assert.deepEqual(keys, ["a", "b", "c"]);
});

test("parseZenApiKeys: ZEN_API_KEYS deduplica preservando a ordem", () => {
  const keys = parseZenApiKeys({ ZEN_API_KEYS: "a,b,a,c,b" } as NodeJS.ProcessEnv);
  assert.deepEqual(keys, ["a", "b", "c"]);
});

test("parseZenApiKeys: cai para ZEN_API_KEY_1..7 quando não há ZEN_API_KEYS", () => {
  const keys = parseZenApiKeys({
    ZEN_API_KEY_1: "k1",
    ZEN_API_KEY_2: "k2",
    ZEN_API_KEY_4: "k4",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(keys, ["k1", "k2", "k4"]);
});

test("parseZenApiKeys: cai para ZEN_API_KEY única (compat)", () => {
  assert.deepEqual(parseZenApiKeys({ ZEN_API_KEY: "só-uma" } as NodeJS.ProcessEnv), ["só-uma"]);
});

test("parseZenApiKeys: nenhuma variável → lista vazia", () => {
  assert.deepEqual(parseZenApiKeys({} as NodeJS.ProcessEnv), []);
});

test("parseZenApiKeys: ZEN_API_KEYS tem precedência sobre numeradas e única", () => {
  const keys = parseZenApiKeys({
    ZEN_API_KEYS: "x,y",
    ZEN_API_KEY_1: "n1",
    ZEN_API_KEY: "single",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(keys, ["x", "y"]);
});

test("resolveZenApiKeys: usa config.zenApiKeys quando presente", () => {
  assert.deepEqual(resolveZenApiKeys({ zenApiKeys: ["a", "b"], zenApiKey: "a" }), ["a", "b"]);
});

test("resolveZenApiKeys: cai para [zenApiKey] quando zenApiKeys vazio", () => {
  assert.deepEqual(resolveZenApiKeys({ zenApiKeys: [], zenApiKey: "x" }), ["x"]);
  assert.deepEqual(resolveZenApiKeys({ zenApiKeys: undefined, zenApiKey: "x" }), ["x"]);
});

test("resolveZenApiKeys: nada configurado → []", () => {
  assert.deepEqual(resolveZenApiKeys({ zenApiKeys: [], zenApiKey: undefined }), []);
});

test("nextZenApiKey: round-robin a,b,c,a,b,c…", () => {
  __resetZenRotation();
  const cfg = { zenApiKeys: ["a", "b", "c"], zenApiKey: "a" };
  const seq = Array.from({ length: 7 }, () => nextZenApiKey(cfg));
  assert.deepEqual(seq, ["a", "b", "c", "a", "b", "c", "a"]);
});

test("nextZenApiKey: uma só chave → sempre ela", () => {
  __resetZenRotation();
  const cfg = { zenApiKeys: ["única"], zenApiKey: "única" };
  assert.deepEqual([nextZenApiKey(cfg), nextZenApiKey(cfg), nextZenApiKey(cfg)], ["única", "única", "única"]);
});

test("nextZenApiKey: nenhuma chave → undefined", () => {
  __resetZenRotation();
  assert.equal(nextZenApiKey({ zenApiKeys: [], zenApiKey: undefined }), undefined);
});

test("__resetZenRotation: reinicia o cursor do rodízio", () => {
  const cfg = { zenApiKeys: ["a", "b"], zenApiKey: "a" };
  __resetZenRotation();
  assert.equal(nextZenApiKey(cfg), "a");
  assert.equal(nextZenApiKey(cfg), "b");
  __resetZenRotation();
  assert.equal(nextZenApiKey(cfg), "a");
});

test("loadConfig: popula zenApiKeys de ZEN_API_KEYS e alinha zenApiKey ao [0]", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-zencfg-"));
  const saved = {
    ZEN_API_KEYS: process.env.ZEN_API_KEYS,
    ZEN_API_KEY: process.env.ZEN_API_KEY,
    ZEN_API_KEY_1: process.env.ZEN_API_KEY_1,
  };
  try {
    delete process.env.ZEN_API_KEY;
    delete process.env.ZEN_API_KEY_1;
    process.env.ZEN_API_KEYS = "prim,seg,ter";
    const cfg = loadConfig({ home });
    assert.deepEqual(cfg.zenApiKeys, ["prim", "seg", "ter"]);
    assert.equal(cfg.zenApiKey, "prim");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
