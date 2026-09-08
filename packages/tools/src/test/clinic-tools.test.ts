import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "../index.js";
import { createSoul } from "@assistente-os/core";
import { pointDatabaseUrlAtFreshSchema } from "./pgTestHelper.js";

const prevDatabaseUrl = process.env.DATABASE_URL;
const dbCleanups: (() => Promise<void>)[] = [];
after(async () => {
  await Promise.all(dbCleanups.map((fn) => fn()));
  if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevDatabaseUrl;
});

async function tempHome(): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "aos-clinic-"));
  createSoul(home, "clinica_teste", {
    name: "clinica_teste",
    description: "instância de teste da vertical clínicas",
    agent: {
      autonomy: "auto",
      guardrails: {},
      permissions: { tools: ["clinic_triage_lead", "clinic_prevent_noshow"] },
    },
  });
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  dbCleanups.push(cleanup);
  return home;
}

test("clinic_triage_lead: lead com contato + procedimento ICP + urgência alta pontua quente", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: {
        name: "clinic_triage_lead",
        arguments: {
          soul: "clinica_teste",
          leadData: { telefone: "+5511999999999", procedimento: "Implante dentário", urgencia: "alta" },
        },
      },
    });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { score: number; tier: string; reasons: string[] };
    assert.equal(parsed.tier, "quente");
    assert.ok(parsed.score >= 70, `esperava score alto, veio ${parsed.score}`);
    assert.ok(parsed.reasons.length > 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("clinic_triage_lead: lead sem contato e sem procedimento reconhecido pontua frio", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "clinic_triage_lead", arguments: { soul: "clinica_teste", leadData: {} } },
    });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { score: number; tier: string };
    assert.equal(parsed.tier, "frio");
    assert.equal(parsed.score, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("clinic_triage_lead: não vaza dado sensível fora do dossiê declarado (só ecoa procedimento/origem)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: {
        name: "clinic_triage_lead",
        arguments: {
          soul: "clinica_teste",
          leadData: {
            telefone: "+5511988887777",
            procedimento: "avaliação",
            historicoClinico: "diagnóstico confidencial de paciente — não deve aparecer na saída",
          },
        },
      },
    });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const rawText = content[0]?.text ?? "";
    assert.ok(!rawText.includes("diagnóstico confidencial"), "campo fora do schema não deveria vazar pra saída");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("clinic_prevent_noshow: roda em dry-run e nunca despacha mensagem real", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const futureDate = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: {
        name: "clinic_prevent_noshow",
        arguments: { soul: "clinica_teste", patientId: "pac-opaco-123", appointmentDate: futureDate },
      },
    });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as {
      dryRun: boolean; motivo: string; gatilhosPlanejados: { tipo: string; previstoPara: string }[];
    };
    assert.equal(parsed.dryRun, true);
    assert.match(parsed.motivo, /Bloco G|BLOCKED|ADR-PRIV-003/);
    assert.equal(parsed.gatilhosPlanejados.length, 2);
    assert.ok(parsed.gatilhosPlanejados.every((g) => new Date(g.previstoPara).getTime() < new Date(futureDate).getTime()));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("clinic_prevent_noshow: rejeita appointmentDate inválida", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: {
        name: "clinic_prevent_noshow",
        arguments: { soul: "clinica_teste", patientId: "pac-1", appointmentDate: "não-é-uma-data" },
      },
    });
    assert.equal(res?.result, undefined);
    assert.match(JSON.stringify(res?.error), /inválida/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("clinic_prevent_noshow: fora da allowlist da soul é rejeitada (defesa em profundidade, allowlist sempre ativa)", async () => {
  const home = await tempHome();
  createSoul(home, "clinica_sem_permissao", {
    name: "clinica_sem_permissao",
    description: "sem clinic_prevent_noshow na allowlist",
    agent: { autonomy: "auto", guardrails: {}, permissions: { tools: ["clinic_triage_lead"] } },
  });
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 6, method: "tools/call",
      params: {
        name: "clinic_prevent_noshow",
        arguments: { soul: "clinica_sem_permissao", patientId: "pac-1", appointmentDate: new Date().toISOString() },
      },
    });
    assert.equal(res?.result, undefined);
    assert.match(JSON.stringify(res?.error), /permissão|42001/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("clinic_prevent_noshow: MCP_ZERO_TRUST=on + autonomy 'suggest' bloqueia a tool L3 mesmo na allowlist (gate G5)", async () => {
  const home = await tempHome();
  createSoul(home, "clinica_restrita", {
    name: "clinica_restrita",
    description: "autonomy suggest — não pode L3 sem aprovação",
    agent: {
      autonomy: "suggest",
      guardrails: {},
      permissions: { tools: ["clinic_triage_lead", "clinic_prevent_noshow"] },
    },
  });
  const prevFlag = process.env.MCP_ZERO_TRUST;
  const prevSoul = process.env.AGENT_SOUL_ID;
  process.env.MCP_ZERO_TRUST = "on";
  process.env.AGENT_SOUL_ID = "clinica_restrita";
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: {
        name: "clinic_prevent_noshow",
        arguments: { soul: "clinica_restrita", patientId: "pac-1", appointmentDate: new Date(Date.now() + 86_400_000).toISOString() },
      },
    });
    assert.equal(res?.result, undefined);
    assert.match(JSON.stringify(res?.error), /suggest|42001/);
  } finally {
    if (prevFlag === undefined) delete process.env.MCP_ZERO_TRUST; else process.env.MCP_ZERO_TRUST = prevFlag;
    if (prevSoul === undefined) delete process.env.AGENT_SOUL_ID; else process.env.AGENT_SOUL_ID = prevSoul;
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: tools/list inclui clinic_triage_lead e clinic_prevent_noshow", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("clinic_triage_lead"));
    assert.ok(names.includes("clinic_prevent_noshow"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
