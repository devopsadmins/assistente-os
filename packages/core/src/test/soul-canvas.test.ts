import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSoulCanvas,
  isAgenticSoul,
  maxLevelForPattern,
  mergeCanvasDecisions,
  canvasDrift,
  type CanvasSystemFacts,
} from "../soul-canvas.js";
import type { Soul } from "../souls.js";

const FACTS: CanvasSystemFacts = {
  routerTiers: ["local", "zen", "soul"],
  ragRerankMode: "off",
  ragInjectionMode: "aviso",
  ragHnswEfSearch: 40,
  semanticCache: false,
  langgraphEnabled: false,
};
const LG = { ...FACTS, langgraphEnabled: true };

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

test("isAgenticSoul: langgraph OFF → nunca agentic, mesmo com tools L3 no default", () => {
  const r = isAgenticSoul(soul("s"), { langgraphEnabled: false });
  assert.equal(r.agentic, false);
  assert.ok(r.reasons[0]!.includes("LANGGRAPH_ENABLED off"));
});

test("isAgenticSoul: langgraph ON + allowlist alcança L3 → agentic", () => {
  const r = isAgenticSoul(soul("s"), { langgraphEnabled: true }); // default tem git_commit_push (L3)
  assert.equal(r.agentic, true);
  assert.ok(r.reasons[0]!.includes("L3"));
});

test("isAgenticSoul: langgraph ON mas allowlist só de leitura → não agentic", () => {
  const r = isAgenticSoul(
    soul("ro", {
      agent: {
        permissions: { tools: ["memory_search", "memory_status", "graph_list", "soul_context"] },
        guardrails: {},
      },
    }),
    { langgraphEnabled: true },
  );
  assert.equal(r.agentic, false);
  assert.ok(r.reasons[0]!.includes("não alcança tools L3"));
});

test("isAgenticSoul: langgraph ON + curinga total → agentic", () => {
  const r = isAgenticSoul(soul("god", { agent: { permissions: { tools: ["*"] }, guardrails: {} } }), {
    langgraphEnabled: true,
  });
  assert.equal(r.agentic, true);
  assert.ok(r.reasons[0]!.includes("L3"));
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
  const a = buildSoulCanvas(s, LG);
  const b = buildSoulCanvas(s, LG);
  assert.equal(a, b, "mesma entrada → mesma saída");

  assert.match(a, /# Canvas de Arquitetura — soul `acme`/);
  assert.match(a, /\*\*Agentic:\*\* sim/); // langgraph on + spec_grill_plan é L3
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

  // langgraph off → não agentic
  assert.match(buildSoulCanvas(s, FACTS), /\*\*Agentic:\*\* não/);
});

test("buildSoulCanvas: semanticCache=true aparece como ligado", () => {
  const a = buildSoulCanvas(soul("x"), { ...LG, semanticCache: true });
  assert.match(a, /semântico \*\*ligado\*\*/);
});

test("mergeCanvasDecisions: preserva o bloco 9 preenchido; ignora quando é o template", () => {
  const s = soul("m", { agent: { permissions: { tools: ["*"] }, guardrails: {} } });
  const fresh = buildSoulCanvas(s, LG);

  // arquivo com bloco 9 preenchido
  const marker = "\n## 9. Decisões";
  const i = fresh.indexOf(marker);
  const preenchido = fresh.slice(0, i) + marker + " (preencher à mão)  · decisão\n- **Custo do erro:** ALTO — decisões vinculantes.\n";
  const merged = mergeCanvasDecisions(fresh, preenchido);
  assert.match(merged, /Custo do erro:\*\* ALTO — decisões vinculantes\./);
  assert.equal(merged.slice(0, i), fresh.slice(0, i), "blocos auto regenerados");

  // arquivo == template fresco → nada a preservar, devolve o fresco
  assert.equal(mergeCanvasDecisions(fresh, fresh), fresh);
  assert.equal(mergeCanvasDecisions(fresh, null), fresh);
});

test("canvasDrift: ausente → defasado; igual → atualizado; config mudou → defasado", () => {
  const s = soul("d", { description: "v1", agent: { permissions: { tools: ["*"] }, guardrails: {} } });
  assert.equal(canvasDrift(s, LG, null).stale, true);

  const gerado = buildSoulCanvas(s, LG);
  assert.equal(canvasDrift(s, LG, gerado).stale, false);

  const s2 = soul("d", { description: "v2 (mudou)", agent: { permissions: { tools: ["*"] }, guardrails: {} } });
  const drift = canvasDrift(s2, LG, gerado);
  assert.equal(drift.stale, true);
  assert.match(drift.reason, /config\.json mudou/);
});
