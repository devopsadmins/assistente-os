import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { McpServer, SERVER_NAME } from "../index.js";
import { createSoul, todayISODate } from "@assistente-os/core";
import { pointDatabaseUrlAtFreshSchema } from "./pgTestHelper.js";

const prevDatabaseUrl = process.env.DATABASE_URL;
const dbCleanups: (() => Promise<void>)[] = [];
after(async () => {
  await Promise.all(dbCleanups.map((fn) => fn()));
  if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevDatabaseUrl;
});

async function tempHome(): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "aos-mcp-"));
  createSoul(home, "main", { name: "main", description: "soul principal" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  dbCleanups.push(cleanup);
  return home;
}

test("mcp: initialize responde capabilities", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const result = res?.result as { serverInfo?: { name: string }; capabilities?: { tools?: object } };
    assert.equal(result.serverInfo?.name, SERVER_NAME);
    assert.ok(result.capabilities?.tools);
    assert.ok(res?.id === 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: tools/list retorna ferramentas", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const expected of ["souls_list", "soul_context", "soul_chat", "memory_search", "memory_index", "memory_status", "graph_list", "costs_summary", "router_status"]) {
      assert.ok(names.includes(expected), `ferramenta ausente: ${expected}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: souls_list retorna souls", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "souls_list", arguments: {} } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "[]") as { id: string }[];
    assert.deepEqual(parsed.map((s) => s.id), ["main"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_context retorna perfil concatenado", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "soul_context", arguments: { soul: "main" } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { context: string };
    assert.ok(parsed.context.includes("assistente principal"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul desconhecida responde erro", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "soul_context", arguments: { soul: "x" } } });
    assert.ok(res?.error, "esperava erro");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul com path traversal (../) é rejeitada, não escapa souls/", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "soul_context", arguments: { soul: "../../../etc" } },
    });
    assert.ok(res?.error, "esperava erro para soul com path traversal");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: ping responde ok e notificação não tem resposta", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const pong = await server.handleMessage({ jsonrpc: "2.0", id: 6, method: "ping" });
    assert.deepEqual(pong?.result, {});
    const notif = await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notif, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: stdio real responde initialize e tools/list", async () => {
  const home = await tempHome();
  const child = spawn(process.execPath, [join(import.meta.dirname, "..", "..", "dist", "index.js")], {
    env: { ...process.env, ASSISTENTE_OS_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    let out = "";
    const done = new Promise<void>((resolve) => child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
      if (out.split("\n").filter(Boolean).length >= 2) resolve();
    }));
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    child.stdin.end();
    await done;
    const lines = out.split("\n").filter(Boolean);
    const init = JSON.parse(lines[0] ?? "{}") as { result?: { serverInfo?: { name: string } } };
    assert.equal(init.result?.serverInfo?.name, SERVER_NAME);
    const list = JSON.parse(lines[1] ?? "{}") as { result?: { tools?: unknown[] } };
    assert.ok((list.result?.tools?.length ?? 0) > 0);
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: tools/list inclui tools de alma e veredito de busca", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 10, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const expected of ["soul_anotar", "soul_licao", "soul_decidir"]) {
      assert.ok(names.includes(expected), `ferramenta ausente: ${expected}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_anotar grava sessão do dia", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "soul_anotar", arguments: { soul: "main", texto: "teste de anotação" } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
     const parsed = JSON.parse(content[0]?.text ?? "{}") as { ok: boolean; arquivo: string };
     assert.equal(parsed.ok, true);
     const fs = await import("node:fs");
     const { basename, dirname } = await import("node:path");
     assert.equal(basename(parsed.arquivo), `${todayISODate()}.md`);
     assert.equal(basename(dirname(parsed.arquivo)), "sessoes");
     assert.ok(fs.existsSync(parsed.arquivo));
     const fileBody = fs.readFileSync(parsed.arquivo, "utf8");
     assert.ok(fileBody.includes("teste de anotação"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_licao grava licoes.md", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "soul_licao", arguments: { soul: "main", texto: "nunca confiar em defaults não testados" } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { ok: boolean; arquivo: string };
    assert.equal(parsed.ok, true);
    assert.match(parsed.arquivo, /licoes\.md$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_decidir grava ADR e duplicata falha", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const call = (titulo: string) =>
      server.handleMessage({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "soul_decidir", arguments: { soul: "main", titulo, contexto: "ctx", decisao: "dec", alternativas: "a, b", consequencias: "c" } },
      });
    const first = await call("usar gate de relevância");
    const fc = (first?.result as { content?: { text: string }[] }).content ?? [];
     const parsed = JSON.parse(fc[0]?.text ?? "{}") as { ok: boolean; arquivo: string };
     assert.equal(parsed.ok, true);
     const { basename: b, dirname: d } = await import("node:path");
     assert.equal(d(parsed.arquivo).split(/[/\\]/).pop(), "decisoes");
     assert.match(b(parsed.arquivo), new RegExp(`^${todayISODate()}-usar-gate-de-relevancia\\.md$`));
    // segunda chamada com mesmo título no mesmo dia deve falhar (idempotência por slug+data)
    const second = await call("usar gate de relevância");
    const sc = (second?.result as { content?: { text: string }[] }).content ?? [];
    const parsed2 = JSON.parse(sc[0]?.text ?? "{}") as { ok: boolean };
    assert.equal(parsed2.ok, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: memory_search retorna veredito de relevância", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "memory_search", arguments: { soul: "main", query: "qualquer coisa aqui", limit: 1 } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { soul: string; query: string; verdict: { ok: boolean; modo: string; motivo: string } };
    assert.equal(parsed.soul, "main");
    assert.equal(parsed.query, "qualquer coisa aqui");
    assert.ok(["recusar", "aviso", "libre"].includes(parsed.verdict.modo));
    assert.equal(parsed.verdict.motivo, "Nenhum resultado recuperado do acervo.");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: agenda_add agenda uma tarefa e agenda_list lista por status", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const badSoul = await server.handleMessage({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: { name: "agenda_add", arguments: { soul: "nao-existe", title: "x" } },
    });
    assert.ok((badSoul?.error as { message?: string } | undefined)?.message?.includes("soul não encontrada"));

    const added = await server.handleMessage({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: { name: "agenda_add", arguments: { soul: "main", title: "gerar relatório", body: "resumo semanal" } },
    });
    const addedContent = (added?.result as { content?: { text: string }[] }).content ?? [];
    const addedParsed = JSON.parse(addedContent[0]?.text ?? "{}") as { ok: boolean; item: { id: number; status: string; title: string } };
    assert.equal(addedParsed.ok, true);
    assert.equal(addedParsed.item.status, "pending");
    assert.equal(addedParsed.item.title, "gerar relatório");

    const listed = await server.handleMessage({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: { name: "agenda_list", arguments: {} },
    });
    const listedContent = (listed?.result as { content?: { text: string }[] }).content ?? [];
    const listedParsed = JSON.parse(listedContent[0]?.text ?? "{}") as { items: { id: number; title: string }[] };
    assert.equal(listedParsed.items.length, 1);
    assert.equal(listedParsed.items[0]?.id, addedParsed.item.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: tools/list inclui spec_grill_plan", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 20, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    assert.ok(tools.map((t) => t.name).includes("spec_grill_plan"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: spec_grill_plan — fluxo completo de duas fases", async () => {
  const home = await tempHome();
  // "main" (tempHome) usa DEFAULT_ALLOWED_TOOLS, que não inclui spec_grill_plan
  // (lista fixa que não é atualizada a cada tool nova) — soul dedicada com
  // permissão explícita, mesmo padrão de outras tools fora do default.
  createSoul(home, "grillsoul", { name: "grillsoul", agent: { permissions: { tools: ["spec_grill_plan"] }, guardrails: {} } });
  const server = new McpServer({ home });
  const prevUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://127.0.0.1:1"; // sem listener: força o fallback determinístico
  try {
    const featureDraft = "Adicionar exportação de relatórios em PDF";
    const phase1 = await server.handleMessage({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "spec_grill_plan", arguments: { soul: "grillsoul", featureDraft } },
    });
    const p1content = (phase1?.result as { content?: { text: string }[] }).content ?? [];
    const p1parsed = JSON.parse(p1content[0]?.text ?? "{}") as {
      ok: boolean;
      questions?: { pergunta: string }[];
      arquivo: string;
      buildModeAuthorized?: boolean;
    };
    assert.equal(p1parsed.ok, true);
    assert.ok(p1parsed.questions && p1parsed.questions.length >= 3 && p1parsed.questions.length <= 5);
    assert.ok(!p1parsed.buildModeAuthorized);
    assert.match(p1parsed.arquivo, /contexto\.md$/);
    const fs = await import("node:fs");
    const afterPhase1 = fs.readFileSync(p1parsed.arquivo, "utf8");
    assert.ok(afterPhase1.includes("(status: pending)"));
    assert.ok(afterPhase1.includes(featureDraft));

    // Fase 2 com respostas insuficientes: erro, bloco continua pending
    const shortAnswers = await server.handleMessage({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { name: "spec_grill_plan", arguments: { soul: "grillsoul", featureDraft, answers: ["só uma resposta"] } },
    });
    assert.ok((shortAnswers?.error as { message?: string } | undefined)?.message?.includes("insuficientes"));
    assert.ok(fs.readFileSync(p1parsed.arquivo, "utf8").includes("(status: pending)"));

    // Fase 2 completa (>=3 respostas): autoriza
    const phase2 = await server.handleMessage({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "spec_grill_plan",
        arguments: { soul: "grillsoul", featureDraft, answers: ["resposta 1", "resposta 2", "resposta 3"] },
      },
    });
    const p2content = (phase2?.result as { content?: { text: string }[] }).content ?? [];
    const p2parsed = JSON.parse(p2content[0]?.text ?? "{}") as { ok: boolean; buildModeAuthorized?: boolean };
    assert.equal(p2parsed.ok, true);
    assert.equal(p2parsed.buildModeAuthorized, true);
    const afterPhase2 = fs.readFileSync(p1parsed.arquivo, "utf8");
    assert.ok(afterPhase2.includes("(status: authorized)"));
    assert.ok(afterPhase2.includes("resposta 1"));
  } finally {
    if (prevUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevUrl;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: spec_grill_plan com soul inexistente retorna erro JSON-RPC", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: { name: "spec_grill_plan", arguments: { soul: "nao-existe", featureDraft: "x" } },
    });
    assert.ok(res?.error, "esperava erro para soul inexistente");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function extractApprovalCode(text: string | null): string | null {
  if (text === null) return null;
  const m = text.match(/Código de aprovação: (\d{6})/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Stub de `fetch` para capturar o código de aprovação que `notifyGuardianApproval`
 * (chamado internamente por proposeRule/resendApprovalCode) envia por Telegram —
 * o código nunca é devolvido pelas tools MCP ao agente, só chega em claro aqui.
 */
async function withCapturedApprovalCode<T>(fn: () => Promise<T>): Promise<{ result: T; code: string | null }> {
  const originalFetch = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.GUARDIAN_APPROVAL_CHAT_ID = "test-chat";
  let capturedText: string | null = null;
  globalThis.fetch = (async (_url: unknown, opts?: { body?: string }) => {
    try {
      const body = JSON.parse(opts?.body ?? "{}") as { text?: string };
      capturedText = body.text ?? null;
    } catch {
      capturedText = null;
    }
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    const result = await fn();
    const code = extractApprovalCode(capturedText);
    return { result, code };
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.GUARDIAN_APPROVAL_CHAT_ID;
  }
}

test("mcp: guardian_promote_golden_rule -> guardian_pending_rules não expõe hash; approve exige código correto", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  // guardian_approve_rule usa ASSISTENTE_OS_REPO_ROOT || process.cwd() como
  // repoRoot pra gravar .opencode/rules/golden-rules.md e AGENTS.md — sem
  // isolar aqui, o teste escreveria esses arquivos no repo real (cwd de
  // quem roda `npm test`), não num diretório descartável.
  const repoRoot = mkdtempSync(join(tmpdir(), "aos-mcp-reporoot-"));
  const prevRepoRoot = process.env.ASSISTENTE_OS_REPO_ROOT;
  process.env.ASSISTENTE_OS_REPO_ROOT = repoRoot;
  try {
    const { result: proposeRes, code } = await withCapturedApprovalCode(() =>
      server.handleMessage({
        jsonrpc: "2.0",
        id: 25,
        method: "tools/call",
        params: { name: "guardian_promote_golden_rule", arguments: { topic: "topico-mcp", ruleText: "regra mcp", reason: "teste mcp" } },
      }),
    );
    assert.match(code ?? "", /^\d{6}$/, "código de aprovação deveria ter sido capturado da notificação");
    const proposeContent = (proposeRes?.result as { content?: { text: string }[] }).content ?? [];
    const parsedPropose = JSON.parse(proposeContent[0]?.text ?? "{}") as { ok: boolean; rule: { id: string; approvalCodeHash?: string } };
    assert.equal(parsedPropose.ok, true);
    assert.equal(parsedPropose.rule.approvalCodeHash, undefined, "o hash do código não deve ser exposto ao agente");
    const ruleId = parsedPropose.rule.id;

    const pendingRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: { name: "guardian_pending_rules", arguments: {} },
    });
    const pendingContent = (pendingRes?.result as { content?: { text: string }[] }).content ?? [];
    const parsedPending = JSON.parse(pendingContent[0]?.text ?? "{}") as { pending: { id: string; approvalCodeHash?: string }[] };
    assert.equal(parsedPending.pending.length, 1);
    assert.equal(parsedPending.pending[0]!.approvalCodeHash, undefined);

    const resNoCode = await server.handleMessage({
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: { name: "guardian_approve_rule", arguments: { id: ruleId } },
    });
    assert.ok(resNoCode?.error, "esperava erro sem código");

    const wrongCode = code === "111111" ? "222222" : "111111";
    const resWrongCode = await server.handleMessage({
      jsonrpc: "2.0",
      id: 28,
      method: "tools/call",
      params: { name: "guardian_approve_rule", arguments: { id: ruleId, code: wrongCode } },
    });
    assert.ok(resWrongCode?.error, "esperava erro com código errado");

    const resApprove = await server.handleMessage({
      jsonrpc: "2.0",
      id: 29,
      method: "tools/call",
      params: { name: "guardian_approve_rule", arguments: { id: ruleId, code } },
    });
    const approveContent = (resApprove?.result as { content?: { text: string }[] }).content ?? [];
    const parsedApprove = JSON.parse(approveContent[0]?.text ?? "{}") as { ok: boolean; rule: { topic: string } };
    assert.equal(parsedApprove.ok, true);
    assert.equal(parsedApprove.rule.topic, "topico-mcp");
  } finally {
    if (prevRepoRoot === undefined) delete process.env.ASSISTENTE_OS_REPO_ROOT;
    else process.env.ASSISTENTE_OS_REPO_ROOT = prevRepoRoot;
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_generate_aiia grava AIIA.md real da soul", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    // soul_generate_aiia não entra em DEFAULT_ALLOWED_TOOLS (menor privilégio
    // por padrão) — a soul precisa declará-la explicitamente.
    createSoul(home, "main", { name: "main", description: "soul principal", agent: { permissions: { tools: ["soul_generate_aiia"] }, guardrails: {} } });
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: { name: "soul_generate_aiia", arguments: { soul: "main" } },
    });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { ok: boolean; path: string };
    assert.equal(parsed.ok, true);
    assert.match(parsed.path, /AIIA\.md$/);

    const fs = await import("node:fs");
    const written = fs.readFileSync(parsed.path, "utf8");
    assert.match(written, /# AIIA — Avaliação de Impacto Algorítmico/);
    assert.match(written, /\*\*Soul:\*\* main/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: worktree_list está em tools/list e responde (E5)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const list = await server.handleMessage({ jsonrpc: "2.0", id: 40, method: "tools/list" });
    const names = ((list?.result as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    assert.ok(names.includes("worktree_list"), "worktree_list exposta");
    assert.ok(names.includes("soul_create"), "soul_create exposta");

    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 41, method: "tools/call",
      params: { name: "worktree_list", arguments: {} },
    });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { worktrees: unknown[] };
    assert.ok(Array.isArray(parsed.worktrees));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_create dry_run valida sem escrever; commit exige plan_hash (E5)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  const prevAgentSoul = process.env.AGENT_SOUL_ID;
  process.env.AGENT_SOUL_ID = "main";
  try {
    createSoul(home, "main", { name: "main", agent: { permissions: { tools: ["soul_create"] }, guardrails: {}, autonomy: "auto" } });

    const dry = await server.handleMessage({
      jsonrpc: "2.0", id: 50, method: "tools/call",
      params: { name: "soul_create", arguments: { soul_id: "nova-soul", purpose: "teste", capabilities: "memory_search,graph_list" } },
    });
    const dryOut = JSON.parse((dry?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { dry_run: boolean; ok: boolean; plan_hash: string };
    assert.equal(dryOut.dry_run, true);
    assert.equal(dryOut.ok, true);
    assert.ok(dryOut.plan_hash);
    const fs = await import("node:fs");
    assert.ok(!fs.existsSync(join(home, "souls", "nova-soul")), "dry_run não escreve");

    // commit com hash errado → erro
    const bad = await server.handleMessage({
      jsonrpc: "2.0", id: 51, method: "tools/call",
      params: { name: "soul_create", arguments: { soul_id: "nova-soul", purpose: "teste", capabilities: "memory_search,graph_list", dry_run: false, plan_hash: "deadbeef" } },
    });
    assert.match(JSON.stringify(bad?.result ?? bad?.error), /plan_hash divergente/);

    // commit com hash correto → cria
    const ok = await server.handleMessage({
      jsonrpc: "2.0", id: 52, method: "tools/call",
      params: { name: "soul_create", arguments: { soul_id: "nova-soul", purpose: "teste", capabilities: "memory_search,graph_list", dry_run: false, plan_hash: dryOut.plan_hash } },
    });
    const okOut = JSON.parse((ok?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { created: boolean; soul_id: string };
    assert.equal(okOut.created, true);
    assert.ok(fs.existsSync(join(home, "souls", "nova-soul", "config.json")));
  } finally {
    if (prevAgentSoul === undefined) delete process.env.AGENT_SOUL_ID;
    else process.env.AGENT_SOUL_ID = prevAgentSoul;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: mission_list e mission_run expostos; mission_run exige AGENT_SOUL_ID (E3)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const list = await server.handleMessage({ jsonrpc: "2.0", id: 60, method: "tools/list" });
    const names = ((list?.result as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    assert.ok(names.includes("mission_list"));
    assert.ok(names.includes("mission_run"));

    const ml = await server.handleMessage({
      jsonrpc: "2.0", id: 61, method: "tools/call", params: { name: "mission_list", arguments: {} },
    });
    const missions = JSON.parse((ml?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { missions: unknown[] };
    assert.ok(Array.isArray(missions.missions) && missions.missions.length >= 2);

    // mission_run sem AGENT_SOUL_ID → negado (fail-closed)
    const prev = process.env.AGENT_SOUL_ID;
    delete process.env.AGENT_SOUL_ID;
    const denied = await server.handleMessage({
      jsonrpc: "2.0", id: 62, method: "tools/call", params: { name: "mission_run", arguments: { mission_id: "meetingIngestHeadless" } },
    });
    if (prev !== undefined) process.env.AGENT_SOUL_ID = prev;
    assert.match(JSON.stringify(denied?.result ?? denied?.error), /AGENT_SOUL_ID/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: skill_list e skill_create — dry-run/plan_hash/L3 + allowlist (Skills)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  const prevAgentSoul = process.env.AGENT_SOUL_ID;
  process.env.AGENT_SOUL_ID = "main";
  try {
    createSoul(home, "main", { name: "main", agent: { permissions: { tools: ["skill_list", "skill_create"], skills: ["ja-na-allowlist"] }, guardrails: {}, autonomy: "auto" } });
    const fs = await import("node:fs");
    // uma skill que existe e está na allowlist
    fs.mkdirSync(join(home, "souls", "main", "skills", "ja-na-allowlist"), { recursive: true });
    fs.writeFileSync(join(home, "souls", "main", "skills", "ja-na-allowlist", "SKILL.md"), "---\nname: ja-na-allowlist\ndescription: existente\n---\ncorpo");

    const list = await server.handleMessage({ jsonrpc: "2.0", id: 70, method: "tools/list" });
    const names = ((list?.result as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    assert.ok(names.includes("skill_list") && names.includes("skill_create"));

    // skill_create dry-run
    const dry = await server.handleMessage({
      jsonrpc: "2.0", id: 71, method: "tools/call",
      params: { name: "skill_create", arguments: { name: "nova-skill", description: "faz algo útil", body: "instruções aqui", keywords: "gatilho-a" } },
    });
    const dryOut = JSON.parse((dry?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { dry_run: boolean; ok: boolean; plan_hash: string; would_write: string };
    assert.equal(dryOut.dry_run, true);
    assert.equal(dryOut.ok, true);
    assert.match(dryOut.would_write, /souls\/main\/skills\/nova-skill\/SKILL\.md/);
    assert.ok(!fs.existsSync(join(home, "souls", "main", "skills", "nova-skill")), "dry_run não escreve");

    // hash errado → erro
    const bad = await server.handleMessage({
      jsonrpc: "2.0", id: 72, method: "tools/call",
      params: { name: "skill_create", arguments: { name: "nova-skill", description: "faz algo útil", body: "instruções aqui", keywords: "gatilho-a", dry_run: false, plan_hash: "x" } },
    });
    assert.match(JSON.stringify(bad?.result ?? bad?.error), /plan_hash divergente/);

    // commit → cria
    const ok = await server.handleMessage({
      jsonrpc: "2.0", id: 73, method: "tools/call",
      params: { name: "skill_create", arguments: { name: "nova-skill", description: "faz algo útil", body: "instruções aqui", keywords: "gatilho-a", dry_run: false, plan_hash: dryOut.plan_hash } },
    });
    const okOut = JSON.parse((ok?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { created: boolean; path: string };
    assert.equal(okOut.created, true);
    assert.ok(fs.existsSync(join(home, "souls", "main", "skills", "nova-skill", "SKILL.md")));

    // skill_list mostra ambas, com inAllowlist correto
    const sl = await server.handleMessage({ jsonrpc: "2.0", id: 74, method: "tools/call", params: { name: "skill_list", arguments: {} } });
    const slOut = JSON.parse((sl?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { skills: Array<{ name: string; inAllowlist: boolean }> };
    const byName = Object.fromEntries(slOut.skills.map((s) => [s.name, s.inAllowlist]));
    assert.equal(byName["ja-na-allowlist"], true);
    assert.equal(byName["nova-skill"], false);
  } finally {
    if (prevAgentSoul === undefined) delete process.env.AGENT_SOUL_ID;
    else process.env.AGENT_SOUL_ID = prevAgentSoul;
    rmSync(home, { recursive: true, force: true });
  }
});

// ── Zero Trust central (Onda 1) — gate em handleToolCall ────────────────

test("mcp ZeroTrust: MCP_ZERO_TRUST desligado = no-op (comportamento pré-Onda-1)", async () => {
  const home = await tempHome();
  // soul restritiva: só memory_search na allowlist
  createSoul(home, "restrita", {
    name: "restrita",
    description: "x",
    agent: { autonomy: "suggest", guardrails: {}, permissions: { tools: ["memory_search"] } },
  });
  const prevFlag = process.env.MCP_ZERO_TRUST;
  const prevSoul = process.env.AGENT_SOUL_ID;
  delete process.env.MCP_ZERO_TRUST;
  process.env.AGENT_SOUL_ID = "restrita";
  const server = new McpServer({ home });
  try {
    // agenda_list (L1) roda mesmo com autonomy suggest + fora da allowlist,
    // porque o gate central está desligado (os checks por-caso é que valem).
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 200, method: "tools/call",
      params: { name: "agenda_list", arguments: {} },
    });
    assert.ok(res?.result, "sem o flag, o gate central não bloqueia");
    assert.equal(res?.error, undefined);
  } finally {
    if (prevFlag === undefined) delete process.env.MCP_ZERO_TRUST; else process.env.MCP_ZERO_TRUST = prevFlag;
    if (prevSoul === undefined) delete process.env.AGENT_SOUL_ID; else process.env.AGENT_SOUL_ID = prevSoul;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp ZeroTrust: MCP_ZERO_TRUST=on aplica allowlist + autonomy a TODA tool", async () => {
  const home = await tempHome();
  createSoul(home, "restrita", {
    name: "restrita",
    description: "x",
    agent: { autonomy: "suggest", guardrails: {}, permissions: { tools: ["memory_search", "agenda_add"] } },
  });
  const prevFlag = process.env.MCP_ZERO_TRUST;
  const prevSoul = process.env.AGENT_SOUL_ID;
  process.env.MCP_ZERO_TRUST = "on";
  process.env.AGENT_SOUL_ID = "restrita";
  const server = new McpServer({ home });
  try {
    // L1 na allowlist → passa
    const l1 = await server.handleMessage({
      jsonrpc: "2.0", id: 210, method: "tools/call",
      params: { name: "memory_search", arguments: { soul: "restrita", query: "x" } },
    });
    assert.ok(l1?.result, "L1 na allowlist passa");

    // L2 na allowlist mas autonomy 'suggest' bloqueia L2
    const l2 = await server.handleMessage({
      jsonrpc: "2.0", id: 211, method: "tools/call",
      params: { name: "agenda_add", arguments: { soul: "restrita", title: "t" } },
    });
    assert.equal(l2?.result, undefined);
    assert.match(JSON.stringify(l2?.error), /suggest|42001/);

    // fora da allowlist → E_AUTHZ mesmo sendo L2
    const fora = await server.handleMessage({
      jsonrpc: "2.0", id: 212, method: "tools/call",
      params: { name: "observation_add", arguments: { soul: "restrita", entity_name: "e", text: "x" } },
    });
    assert.equal(fora?.result, undefined);
    assert.match(JSON.stringify(fora?.error), /snapshot|42001/);
  } finally {
    if (prevFlag === undefined) delete process.env.MCP_ZERO_TRUST; else process.env.MCP_ZERO_TRUST = prevFlag;
    if (prevSoul === undefined) delete process.env.AGENT_SOUL_ID; else process.env.AGENT_SOUL_ID = prevSoul;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp ZeroTrust: MCP_ZERO_TRUST=on + sem soul identificável nega tool soul-scoped", async () => {
  const home = await tempHome();
  const prevFlag = process.env.MCP_ZERO_TRUST;
  const prevSoul = process.env.AGENT_SOUL_ID;
  process.env.MCP_ZERO_TRUST = "on";
  delete process.env.AGENT_SOUL_ID;
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 220, method: "tools/call",
      params: { name: "memory_search", arguments: { query: "x" } },
    });
    assert.equal(res?.result, undefined);
    assert.match(JSON.stringify(res?.error), /soul identificada|42001/);
  } finally {
    if (prevFlag === undefined) delete process.env.MCP_ZERO_TRUST; else process.env.MCP_ZERO_TRUST = prevFlag;
    if (prevSoul === undefined) delete process.env.AGENT_SOUL_ID; else process.env.AGENT_SOUL_ID = prevSoul;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: skill_list/skill_create/mission_run rejeitam soul id inválido (path traversal)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const sl = await server.handleMessage({
      jsonrpc: "2.0", id: 230, method: "tools/call",
      params: { name: "skill_list", arguments: { soul: "../../etc" } },
    });
    assert.match(JSON.stringify(sl?.error ?? sl?.result), /soul inválida/);

    const mr = await server.handleMessage({
      jsonrpc: "2.0", id: 231, method: "tools/call",
      params: { name: "mission_run", arguments: { mission_id: "m1", soul: "../evil" } },
    });
    assert.match(JSON.stringify(mr?.error ?? mr?.result), /soul inválida|AGENT_SOUL_ID/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("browser_navigate: tools/list inclui a família browser_* (smoke — sem execução real de browser)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 240, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const n of ["browser_navigate", "browser_click", "browser_extract_text", "browser_screenshot", "browser_close", "browser_get_accessibility_tree", "browser_execute_fix", "browser_audited_screenshot"]) {
      assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ado_list_projects: tools/list inclui a família ado_* (smoke — sem execução real de Azure DevOps)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 250, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const n of ["ado_list_projects", "ado_list_repositories", "ado_list_work_items", "ado_create_work_item", "ado_get_work_item", "ado_update_work_item", "ado_list_pipelines", "ado_run_pipeline", "ado_list_pull_requests", "ado_create_pull_request"]) {
      assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("worktree_create: tools/list inclui a ferramenta (smoke — sem execução real de git)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 260, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("worktree_create"), "worktree_create deveria estar em tools/list");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("worktree_merge_locally: tools/list inclui a ferramenta (smoke — sem execução real de git)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 261, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("worktree_merge_locally"), "worktree_merge_locally deveria estar em tools/list");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("worktree_destroy: tools/list inclui a ferramenta (smoke — sem execução real de git)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 262, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("worktree_destroy"), "worktree_destroy deveria estar em tools/list");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mission_list: tools/list inclui a ferramenta e responde (smoke — sem execução real)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 263, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("mission_list"), "mission_list deveria estar em tools/list");

    const ml = await server.handleMessage({
      jsonrpc: "2.0", id: 264, method: "tools/call", params: { name: "mission_list", arguments: {} },
    });
    const missions = JSON.parse((ml?.result as { content?: { text: string }[] }).content?.[0]?.text ?? "{}") as { missions: unknown[] };
    assert.ok(Array.isArray(missions.missions), "mission_list deveria retornar um array de missões");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("sales_ingest_meeting: tools/list inclui a família sales_* (smoke — sem execução real de LLM/Ollama)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 265, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const n of ["sales_ingest_meeting", "sales_get_lead_brief"]) {
      assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("souls_*: tools/list inclui soul_chat e action_execute (smoke — sem execução real de opencode)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 250, method: "tools/list" });
    const names = ((res?.result as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    for (const n of ["souls_list", "soul_context", "soul_chat", "action_execute"]) {
      assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
