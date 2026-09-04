import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLangGraphMaxIterations } from "../config.js";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("resolveLangGraphMaxIterations: default 5 sem nenhuma env setada", () => {
  const n = withEnv({ LANGGRAPH_MAX_ITERATIONS: undefined, ASSISTENTE_OS_MAX_ITERATIONS: undefined }, () =>
    resolveLangGraphMaxIterations(),
  );
  assert.equal(n, 5);
});

test("resolveLangGraphMaxIterations: usa ASSISTENTE_OS_MAX_ITERATIONS quando só ela está setada", () => {
  const n = withEnv({ LANGGRAPH_MAX_ITERATIONS: undefined, ASSISTENTE_OS_MAX_ITERATIONS: "10" }, () =>
    resolveLangGraphMaxIterations(),
  );
  assert.equal(n, 10, "ASSISTENTE_OS_MAX_ITERATIONS sozinha deveria afetar o teto do LangGraph — hoje não afeta, é o bug que este task corrige");
});

test("resolveLangGraphMaxIterations: LANGGRAPH_MAX_ITERATIONS tem precedência sobre ASSISTENTE_OS_MAX_ITERATIONS quando as duas estão setadas", () => {
  const n = withEnv({ LANGGRAPH_MAX_ITERATIONS: "3", ASSISTENTE_OS_MAX_ITERATIONS: "10" }, () =>
    resolveLangGraphMaxIterations(),
  );
  assert.equal(n, 3);
});

test("resolveLangGraphMaxIterations: valor inválido/não-numérico cai pro default 5", () => {
  const n = withEnv({ LANGGRAPH_MAX_ITERATIONS: "not-a-number", ASSISTENTE_OS_MAX_ITERATIONS: undefined }, () =>
    resolveLangGraphMaxIterations(),
  );
  assert.equal(n, 5);
});
