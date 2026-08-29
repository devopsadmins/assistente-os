import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { encodeTextFrame } from "../server.js";
import { runOpenCode } from "../runner.js";
import { createSoul, recentCalls, signRequest, loadConfig, getPool, getUsageSummary, CONCISE_OUTPUT_DIRECTIVE } from "@assistente-os/core";
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
    assert.equal((health.body as { ok: boolean }).ok, true);
    // /health é público: NÃO deve vazar a lista de souls (ids `familia_<telefone>` = PII).
    assert.equal((health.body as { souls?: unknown }).souls, undefined);

    const souls = await fetchJson(`${base}/souls`);
    assert.equal((souls.body as unknown[]).length, 1);
    assert.deepEqual((souls.body as Array<{ id: string }>).map((s) => s.id), ["main"]);

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

test("daemon: rate limit por cliente → 429 com Retry-After (Onda 1b)", async () => {
  const { home, cleanup } = await tempHome();
  const prev = process.env.AOS_RATE_LIMIT;
  process.env.AOS_RATE_LIMIT = "3";
  const { __resetRateLimiter } = await import("../throttle.js");
  __resetRateLimiter();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/souls`, { headers: { "x-client-id": "flood" } })).status);
    assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
    assert.equal(codes[3], 429);
    assert.equal(codes[4], 429);
    const r = await fetch(`${base}/souls`, { headers: { "x-client-id": "flood" } });
    assert.ok(Number(r.headers.get("retry-after")) >= 1);
    // /health não conta e nunca é barrado
    assert.equal((await fetch(`${base}/health`)).status, 200);
    // outro cliente não é afetado
    assert.equal((await fetch(`${base}/souls`, { headers: { "x-client-id": "outro" } })).status, 200);
  } finally {
    if (prev === undefined) delete process.env.AOS_RATE_LIMIT;
    else process.env.AOS_RATE_LIMIT = prev;
    __resetRateLimiter();
    await daemon.close();
    await cleanup();
  }
});

test("daemon: cap de execuções caras simultâneas → 503; rota barata não é afetada (Onda 1b)", async () => {
  const { home, cleanup } = await tempHome();
  const prev = process.env.AOS_MAX_CONCURRENT_EXEC;
  process.env.AOS_MAX_CONCURRENT_EXEC = "1";
  const { tryAcquireExecSlot, releaseExecSlot, __resetExecSlots } = await import("../throttle.js");
  __resetExecSlots();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    // ocupa o único slot manualmente (simula um chat já em execução)
    assert.equal(tryAcquireExecSlot(), true);

    const chat = await fetch(`${base}/souls/main/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(chat.status, 503);
    assert.equal((await chat.json() as { error: string }).error.includes("ocupado"), true);
    assert.ok(Number(chat.headers.get("retry-after")) >= 1);

    // rota barata (não-cara) passa mesmo com o semáforo cheio
    assert.equal((await fetch(`${base}/souls`)).status, 200);

    releaseExecSlot();
  } finally {
    if (prev === undefined) delete process.env.AOS_MAX_CONCURRENT_EXEC;
    else process.env.AOS_MAX_CONCURRENT_EXEC = prev;
    __resetExecSlots();
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
  process.env.OLLAMA_URL = "http://127.0.0.1:1";
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
    // OLLAMA_URL aponta pra porta sem listener: o roteador sonda, o local
    // falha e cai pro degrau "zen" (que aqui é servido pelo run() injetado).
    assert.equal(body.tier, "zen");

    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const entries = await recentCalls(pool, "main");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.status, "ok");
    assert.equal(entries[0]?.provider, "zen");
  } finally {
    delete process.env.OLLAMA_URL;
    await daemon.close();
    await cleanup();
  }
});

test("daemon: chat emite x-trace-id e persiste spans; GET /trace/:id reconstrói o turno (Onda 2)", async () => {
  const { home, cleanup } = await tempHome();
  process.env.OLLAMA_URL = "http://127.0.0.1:1";
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => ({ code: 0, stdout: "resposta", stderr: "", timedOut: false }),
  });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/main/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi", timeoutSeconds: 30 }),
    });
    assert.equal(res.status, 200);
    const traceId = res.headers.get("x-trace-id");
    assert.ok(traceId && traceId.length >= 8, "header x-trace-id presente");

    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const { rows: exec } = await pool.query("SELECT trace_id, status FROM execution_logs WHERE trace_id = $1", [traceId]);
    assert.equal(exec.length, 1, "execution_logs tem a linha canônica com o trace_id");
    const { rows: spans } = await pool.query("SELECT module FROM execution_spans WHERE trace_id = $1 ORDER BY seq", [traceId]);
    assert.ok(spans.length >= 3, `esperava vários spans, veio ${spans.length}`);
    assert.equal(spans[0]!.module, "chat", "primeiro span é o 'chat: prompt recebido'");

    const trace = await fetchJson(`${base}/trace/${traceId}`);
    assert.equal(trace.status, 200);
    const body = trace.body as { execution: { traceId: string } | null; spans: unknown[] };
    assert.ok(body.execution);
    assert.equal(body.execution!.traceId, traceId);
    assert.equal(body.spans.length, spans.length);

    assert.equal((await fetchJson(`${base}/trace/nao-existe-xxxxxxx`)).status, 404);
  } finally {
    delete process.env.OLLAMA_URL;
    await daemon.close();
    await cleanup();
  }
});

test("daemon: token protege as rotas, exceto /health (público de propósito p/ monitoramento)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: "segredo-de-teste" });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/souls`)).status, 401);
    assert.equal(
      (await fetch(`${base}/souls`, { headers: { authorization: "Bearer segredo-de-teste" } })).status,
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
    assert.ok(body.systemPrompt.startsWith(CONCISE_OUTPUT_DIRECTIVE), "diretriz FinOps deve ser sempre o prefixo do prompt montado");
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
  // Sem isso, o roteador (com sonda ativa) escolhe "local" de verdade quando
  // há um Ollama real acessível no ambiente — o run() injetado (que simula o
  // degrau "zen") nunca seria chamado, e o teste ficaria dependente de o
  // Ollama do ambiente estar fora do ar ou não.
  process.env.OLLAMA_URL = "http://127.0.0.1:1";
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
    delete process.env.OLLAMA_URL;
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

test("daemon: chat registra tokens em router_history (E1/FinOps) e getUsageSummary reflete", async () => {
  const { home, cleanup } = await tempHome();
  const prevUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://127.0.0.1:1"; // força fallback pro tier 'zen' (opencode) — caminho de estimativa
  const daemon = await startDaemon({
    port: 0,
    home,
    run: async () => ({ code: 0, stdout: "resposta com algumas palavras para estimar tokens", stderr: "", timedOut: false }),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/souls/main/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "explique o projeto em detalhes" }),
    });
    assert.equal(res.status, 200);

    const config = await loadConfig({ home });
    const pool = getPool(config.databaseUrl);

    const executed = await pool.query(
      "SELECT prompt_tokens, completion_tokens, total_tokens, execution_mode, model_used FROM router_history WHERE soul = 'main' AND status = 'executed'",
    );
    assert.equal(executed.rowCount, 1, "exatamente uma linha 'executed' por turno de chat");
    const row = executed.rows[0];
    assert.ok(Number(row.total_tokens) > 0, "total_tokens > 0");
    assert.equal(Number(row.total_tokens), Number(row.prompt_tokens) + Number(row.completion_tokens));
    assert.ok(row.execution_mode, "execution_mode preenchido");
    assert.ok(row.model_used, "model_used preenchido");

    const [summary] = await getUsageSummary(pool, { soul: "main" });
    assert.ok(summary, "getUsageSummary retorna linha para 'main'");
    assert.ok(Number(summary.total_tokens) > 0, "getUsageSummary.total_tokens > 0");
  } finally {
    if (prevUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevUrl;
    await daemon.close();
    await cleanup();
  }
});

test("daemon: GET /metrics expõe exposição Prometheus (E6)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
    const body = await res.text();
    assert.match(body, /# HELP aos_chat_requests_total/);
    assert.match(body, /# TYPE aos_agenda_queue_depth gauge/);
    assert.match(body, /aos_process_cpu_user_seconds_total|aos_nodejs_/); // default metrics com prefixo aos_
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: GET /api/manifest retorna o execution manifest (E8.2)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/manifest`);
    assert.equal(res.status, 200);
    const m = (await res.json()) as { schemaVersion: number; hash: string; souls: unknown[]; capabilityCatalog: { version: string } };
    assert.equal(m.schemaVersion, 1);
    assert.match(m.hash, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(m.souls) && m.souls.length === 1);
    assert.ok(m.capabilityCatalog.version);
  } finally {
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

    // ?soul= escopa a lista; soul inexistente → 404 (não vaza agenda de outras souls).
    assert.equal((await fetch(`${base}/agenda?soul=nao-existe`)).status, 404);
    const scoped = await fetch(`${base}/agenda?soul=main&status=all`);
    assert.equal(scoped.status, 200);
    assert.ok(((await scoped.json()) as { id: number }[]).some((i) => i.id === item.id));
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
      databases: { kernelBytes: number; memoryBytes: number };
      postgres: { version: string; tables: number; connections: number };
      system: { platform: string; arch: string; cpuCount: number; ramTotal: number; ramUsed: number };
      rag: { chunks: number };
      events: { pending: number };
      monitors: unknown[];
      executions: unknown[];
    };
    assert.equal(body.service, "assistente-os");
    assert.equal(body.souls.total, 1);
    assert.equal(typeof body.ollama.ok, "boolean");
    assert.ok(body.databases.kernelBytes >= 0);
    assert.ok(typeof body.databases.memoryBytes === "number");
    assert.ok(body.postgres.version.length > 0);
    assert.ok(body.postgres.tables >= 0);
    assert.ok(typeof body.postgres.connections === "number");
    assert.ok(body.system.cpuCount > 0);
    assert.ok(body.system.ramTotal > 0);
    assert.ok(typeof body.rag.chunks === "number");
    assert.ok(Array.isArray(body.monitors));
    assert.ok(Array.isArray(body.executions));
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("daemon: GET /llms.txt expõe rotas, tools MCP e souls (loopback, sem token)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home });
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/llms.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
    const body = await res.text();
    assert.match(body, /^# Assistente OS/);
    assert.ok(body.includes("## Rotas ativas"));
    assert.ok(body.includes("## Catálogo de MCP Tools"));
    assert.ok(body.includes("spec_grill_plan"));
    assert.ok(body.includes("## Souls registradas"));
    assert.ok(body.includes("`main`"));
  } finally {
    await daemon.close();
    await cleanup();
  }
});
