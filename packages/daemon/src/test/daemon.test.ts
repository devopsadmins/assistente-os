import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { encodeTextFrame } from "../server.js";
import { runOpenCode } from "../runner.js";
import { createSoul, recentCalls, signRequest, loadConfig, getPool } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-dmn-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

test("daemon: health, souls e context respondem", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const health = await fetchJson(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((health.body as { souls: string[] }).souls, ["main"]);

    const souls = await fetchJson(`${base}/souls`);
    assert.equal((souls.body as unknown[]).length, 1);

    const ctx = await fetchJson(`${base}/souls/main/context`);
    assert.equal(ctx.status, 200);
    assert.ok((ctx.body as { context: string }).context.includes("assistente principal"));

    const missing = await fetchJson(`${base}/souls/nao-existe`);
    assert.equal(missing.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: rota desconhecida responde 404", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/nada`, { method: "GET" });
    assert.equal(res.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("encodeTextFrame: enquadramento texto sem máscara (servidor)", () => {
  const frame = encodeTextFrame("oi");
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 2); // sem bit de máscara, len 2
  assert.equal(frame.toString("utf8", 2), "oi");
});

test("loadConfig usa home fornecido", () => {
  const cfg = loadConfig({ home: "C:/fake/home" });
  assert.equal(cfg.home, "C:/fake/home");
  assert.ok(cfg.databaseUrl);
});

test("runOpenCode: cwd inexistente falha sem spawnar", async () => {
  const r = await runOpenCode("oi", { cwd: join(tmpdir(), "nao-existe-aos"), timeoutSeconds: 10 });
  assert.equal(r.code, 1);
  assert.ok(r.stderr.includes("cwd não existe"));
  assert.equal(r.timedOut, false);
});

test("daemon: chat executa o prompt uma única vez e registra a chamada", async () => {
  const { home, cleanup } = await tempHome();
  let calls = 0;
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => {
      calls += 1;
      return { code: 0, stdout: "resposta", stderr: "", timedOut: false };
    },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/souls/main/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "faça uma ação", timeoutSeconds: 30 }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    const body = (await res.json()) as { ok: boolean; stdout: string; tier: string };
    assert.equal(body.ok, true);
    assert.equal(body.stdout, "resposta");
    assert.equal(body.tier, "local");

    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const entries = await recentCalls(pool, "main");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.status, "ok");
    assert.equal(entries[0]?.provider, "ollama");
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: token protege todas as rotas quando configurado", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: "segredo-de-teste" });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal(
      (await fetch(`${base}/health`, { headers: { authorization: "Bearer segredo-de-teste" } })).status,
      200,
    );
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: exposição remota exige token", async () => {
  const { home, cleanup } = await tempHome();
  try {
    await assert.rejects(startDaemon({ port: 0, home, host: "0.0.0.0" }), /DAEMON_TOKEN/);
  } finally {
    await cleanup();
  }
});

async function waitFor<T>(fn: () => Promise<T | undefined>, predicate: (v: T) => boolean, ms = 3000, step = 50): Promise<T> {
  const deadline = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== undefined && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error(`timeout aguardando condição (último valor: ${JSON.stringify(last)})`);
}

test("daemon: GET /souls/:id/buffer inspeciona o contexto montado", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/main/buffer`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      soul: string;
      files: { path: string; chars: number }[];
      contextChars: number;
      tokenEstimate: number;
      systemPrompt: string;
    };
    assert.equal(body.soul, "main");
    assert.ok(body.systemPrompt.includes("assistente principal"));
    assert.ok(body.contextChars > 0);
    assert.equal(body.tokenEstimate, Math.ceil(body.contextChars / 4));
    assert.ok(body.files.some((f) => f.path.endsWith("perfil.md") && f.chars > 0));

    const rag = await fetch(`${base}/souls/main/buffer?prompt=qualquer coisa para disparar o RAG`);
    const ragBody = (await rag.json()) as { ragVerdict: { ok: boolean } };
    assert.equal(rag.status, 200);
    assert.equal(ragBody.ragVerdict.ok, false);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: chat retorna limite e segunda mensagem bate no maxTurns", async () => {
  const { home, cleanup } = await tempHome();
  createSoul(home, "limits", { name: "limits", maxTurns: 1 });
  writeFileSync(join(home, "souls", "limits", "perfil.md"), "# limits\n\nsoul de teste\n");
  let calls = 0;
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => {
      calls += 1;
      return { code: 0, stdout: "ok", stderr: "", timedOut: false };
    },
  });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const first = await fetch(`${base}/souls/limits/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "primeira" }),
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { limit: { dailyLimit: number | null; spentToday: number; maxTurns: number; prompts: number } };
    assert.equal(firstBody.limit.maxTurns, 1);
    assert.equal(firstBody.limit.prompts, 1);
    assert.equal(calls, 1);

    const second = await fetch(`${base}/souls/limits/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "segunda" }),
    });
    assert.equal(second.status, 429);
    const secondBody = (await second.json()) as { maxTurns: number };
    assert.equal(secondBody.maxTurns, 1);
    assert.equal(calls, 1);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: chat cai para o próximo degrau quando o Ollama local não responde", async () => {
  const { home, cleanup } = await tempHome();
  let calls = 0;
  const prevUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://127.0.0.1:1"; // porta sem listener: ECONNREFUSED rápido
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => {
      calls += 1;
      return { code: 0, stdout: "resposta via fallback", stderr: "", timedOut: false };
    },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/souls/main/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; stdout: string; tier: string };
    assert.equal(calls, 1);
    assert.equal(body.ok, true);
    assert.equal(body.stdout, "resposta via fallback");
    assert.equal(body.tier, "zen");
  } finally {
    if (prevUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevUrl;
    await daemon.close();
    await cleanup();
  }
});

test("daemon: dailyLimit 0 bloqueia o chat com 429", async () => {
  const { home, cleanup } = await tempHome();
  createSoul(home, "pobre", { name: "pobre", dailyLimit: 0 });
  writeFileSync(join(home, "souls", "pobre", "perfil.md"), "# pobre\n\nsem verba\n");
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => ({ code: 0, stdout: "ok", stderr: "", timedOut: false }),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/souls/pobre/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 429);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: POST /events exige HMAC e processa em background", async () => {
  const { home, cleanup } = await tempHome();
  let calls = 0;
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => {
      calls += 1;
      return { code: 0, stdout: "evento processado", stderr: "", timedOut: false };
    },
  });
  const secret = "segredo-webhook-teste";
  const prev = process.env.ASSISTENTE_OS_WEBHOOK_SECRET;
  process.env.ASSISTENTE_OS_WEBHOOK_SECRET = secret;
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const noSecretYet = await fetch(`${base}/events`, {
      method: "POST",
      body: JSON.stringify({ type: "x" }),
    });
    assert.equal(noSecretYet.status, 401);

    const body = JSON.stringify({ type: "deploy", payload: { etapa: "api" }, soul: "main" });
    const ts = String(Date.now());
    const signature = signRequest(secret, body, ts);

    const bad = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "x-aos-signature": "sha256=invalida", "x-aos-timestamp": ts, "content-type": "application/json" },
      body,
    });
    assert.equal(bad.status, 401);

    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "x-aos-signature": `sha256=${signature}`, "x-aos-timestamp": ts, "content-type": "application/json" },
      body,
    });
    assert.equal(res.status, 202);
    const created = (await res.json()) as { id: number; status: string };
    assert.equal(created.status, "pending");

    await waitFor(
      async () => {
        const r = await fetch(`${base}/events`);
        const data = (await r.json()) as { recent: { id: number; status: string }[] };
        return data.recent.find((e) => e.id === created.id);
      },
      (e) => e.status === "completed",
    );
    assert.equal(calls, 1);
  } finally {
    process.env.ASSISTENTE_OS_WEBHOOK_SECRET = prev;
    await daemon.close();
    await cleanup();
  }
});

test("daemon: eventos sem secret configurado respondem 503", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  const prev = process.env.ASSISTENTE_OS_WEBHOOK_SECRET;
  delete process.env.ASSISTENTE_OS_WEBHOOK_SECRET;
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "x" }),
    });
    assert.equal(res.status, 503);
  } finally {
    if (prev !== undefined) process.env.ASSISTENTE_OS_WEBHOOK_SECRET = prev;
    await daemon.close();
    await cleanup();
  }
});

test("daemon: monitors CRUD + check up/down contra o próprio /health", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const invalid = await fetch(`${base}/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ruim", url: "ftp://x" }),
    });
    assert.equal(invalid.status, 400);

    const created = await fetch(`${base}/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "daemon", url: `${base}/health`, expectedCode: 200 }),
    });
    assert.equal(created.status, 201);
    const mon = (await created.json()) as { id: number; status: string };
    assert.equal(mon.status, "unknown");

    const checked = await fetch(`${base}/monitors/check`, { method: "POST" });
    assert.equal(checked.status, 200);
    const checkedBody = (await checked.json()) as { checked: number; monitors: { id: number; status: string }[] };
    assert.equal(checkedBody.checked, 1);
    assert.equal(checkedBody.monitors[0]!.status, "up");

    const list = await fetch(`${base}/monitors`);
    assert.equal(((await list.json()) as unknown[]).length, 1);

    const del = await fetch(`${base}/monitors/${mon.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(((await (await fetch(`${base}/monitors`)).json()) as unknown[]).length, 0);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: POST /agenda cria e despacha em background; GET /agenda lista por status", async () => {
  const { home, cleanup } = await tempHome();
  let calls = 0;
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => {
      calls += 1;
      return { code: 0, stdout: "tarefa concluída", stderr: "", timedOut: false };
    },
  });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const badSoul = await fetch(`${base}/agenda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ soul: "nao-existe", title: "x" }),
    });
    assert.equal(badSoul.status, 404);

    const semTitulo = await fetch(`${base}/agenda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ soul: "main" }),
    });
    assert.equal(semTitulo.status, 400);

    const created = await fetch(`${base}/agenda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ soul: "main", title: "gerar relatório", body: "resumo semanal" }),
    });
    assert.equal(created.status, 201);
    const item = (await created.json()) as { id: number; status: string };
    assert.equal(item.status, "pending");

    await waitFor(
      async () => {
        const r = await fetch(`${base}/agenda?status=done`);
        const list = (await r.json()) as { id: number; status: string }[];
        return list.find((i) => i.id === item.id);
      },
      (i) => i.status === "completed",
    );
    assert.equal(calls, 1);

    const pending = await fetch(`${base}/agenda`);
    assert.equal(((await pending.json()) as unknown[]).length, 0);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: GET /infra/status expõe souls, ollama, banco, eventos e executions", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/infra/status`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      service: string;
      souls: { total: number };
      ollama: { ok: boolean };
      database: { bytes: number };
      events: { pending: number };
      monitors: unknown[];
      executions: unknown[];
    };
    assert.equal(body.service, "assistente-os");
    assert.equal(body.souls.total, 1);
    assert.equal(typeof body.ollama.ok, "boolean");
    assert.ok(body.database.bytes > 0);
    assert.ok(Array.isArray(body.monitors));
    assert.ok(Array.isArray(body.executions));
  } finally {
    await daemon.close();
    await cleanup();
  }
});
