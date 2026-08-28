import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSoulCanvas, isAgenticSoul, maxLevelForPattern, type CanvasSystemFacts } from "../soul-canvas.js";
import type { Soul } from "../souls.js";

const FACTS: CanvasSystemFacts = {
  routerTiers: ["local", "zen", "soul"],
  ragRerankMode: "off",
  ragInjectionMode: "aviso",
  ragHnswEfSearch: 40,
  semanticCache: false,
};

function soul(id: string, config: Partial<Soul["config"]> = {}): Soul {
  return { id, dir: `/tmp/souls/${id}`, config: { name: id, ...config } };
}

test("maxLevelForPattern: exata, wildcard de namespace, curinga", () => {
  assert.equal(maxLevelForPattern("memory_status"), "L1");
  assert.equal(maxLevelForPattern("memory:*"), "L2"); // memory_index é L2
  assert.equal(maxLevelForPattern("soul_chat"), "L3");
  assert.equal(maxLevelForPattern("*"), "L3");
  assert.equal(maxLevelForPattern("tool_que_nao_existe"), undefined);
});

test("isAgenticSoul: sem agent (defaults) → agentic por conter tools L3 no default", () => {
  // DEFAULT_ALLOWED_TOOLS inclui worktree_merge_locally / git_commit_push (L3)
  const r = isAgenticSoul(soul("s"));
  assert.equal(r.agentic, true);
  assert.ok(r.reasons.some((x) => x.includes("L3")));
});

test("isAgenticSoul: allowlist só de leitura → não agentic", () => {
  const r = isAgenticSoul(
    soul("ro", {
      agent: {
        permissions: { tools: ["memory_search", "memory_status", "graph_list", "soul_context"] },
        guardrails: {},
      },
    }),
  );
  assert.equal(r.agentic, false);
  assert.deepEqual(r.reasons, []);
});

test("isAgenticSoul: curinga total → agentic", () => {
  const r = isAgenticSoul(
    soul("god", { agent: { permissions: { tools: ["*"] }, guardrails: {} } }),
  );
  assert.equal(r.agentic, true);
  assert.ok(r.reasons.some((x) => x.includes("`*`")));
});

test("buildSoulCanvas: determinístico e reflete o config", () => {
  const s = soul("acme", {
    description: "Soul da ACME",
    provider: "zen-acme",
    models: { chat: "modelo-x" },
    dailyLimit: 5,
    agent: {
      permissions: { tools: ["memory:*", "spec_grill_plan"], connectors: ["cloudflare"] },
      guardrails: { maxTurns: 3, allowedOrigins: ["acme.com"] },
      autonomy: "suggest",
      approvalPolicy: ["spec_grill_plan"],
      memoryPolicy: { classification: "confidential", retention: "P90D", enforcement: "partial" },
    },
  });
  const a = buildSoulCanvas(s, FACTS);
  const b = buildSoulCanvas(s, FACTS);
  assert.equal(a, b, "mesma entrada → mesma saída");

  assert.match(a, /# Canvas de Arquitetura — soul `acme`/);
  assert.match(a, /\*\*Agentic:\*\* sim/); // spec_grill_plan é L3
  assert.match(a, /descrição:\*\* Soul da ACME/);
  assert.match(a, /provider:\*\* zen-acme/);
  assert.match(a, /modelo \(chat\):\*\* modelo-x/);
  assert.match(a, /\| `spec_grill_plan` \| L3 \|/);
  assert.match(a, /autonomy:\*\* suggest/);
  assert.match(a, /approvalPolicy \(sempre confirmam\):\*\* `spec_grill_plan`/);
  assert.match(a, /maxTurns \/ sessão:\*\* 3/);
  assert.match(a, /dailyLimit \(config\.json\):\*\* 5/);
  assert.match(a, /classificação:\*\* confidential/);
  assert.match(a, /connectors MCP autorizados:\*\* cloudflare/);
  assert.match(a, /## 9\. Decisões \(preencher à mão\)  · decisão/);
});

test("buildSoulCanvas: semanticCache=true aparece como ligado", () => {
  const a = buildSoulCanvas(soul("x"), { ...FACTS, semanticCache: true });
  assert.match(a, /semântico \*\*ligado\*\*/);
});
