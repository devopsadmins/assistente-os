/**
 * SPEC-HR6 (fix): o `WsHub` deixa de fazer broadcast sem escopo — cada
 * cliente conectado carrega uma identidade (admin ou conta), e `broadcast()`
 * só entrega a quem tem permissão. Cobre o vetor que a revisão crítica de
 * 2026-09-04 apontou: `chat.step`/`graph.step`/`chat.done` incluem texto
 * parcial de resposta e iam para qualquer cliente conectado, de qualquer
 * conta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-wsh-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function signup(base: string, email: string): Promise<{ accountId: number; token: string }> {
  const r = await fetchJson(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { accountId: r.body.account.id, token: r.body.token };
}

/** Abre um WS autenticado e resolve quando o handshake completa (ou rejeita em erro/fechamento). */
function connect(base: string, token: string): Promise<WebSocket> {
  return new Promise((resolveWs, reject) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/?token=${encodeURIComponent(token)}`);
    ws.addEventListener("open", () => resolveWs(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
    ws.addEventListener("close", (ev) => reject(new Error(`ws closed antes de abrir: code=${ev.code}`)), { once: true });
  });
}

/** Coleta as próximas mensagens JSON recebidas num socket dentro da janela dada. */
function collectMessages(ws: WebSocket, windowMs: number): Promise<any[]> {
  const received: any[] = [];
  const onMessage = (ev: MessageEvent) => received.push(JSON.parse(String(ev.data)));
  ws.addEventListener("message", onMessage);
  return new Promise((resolveMsgs) => {
    setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      resolveMsgs(received);
    }, windowMs);
  });
}

test("SPEC-HR6: WS conexão inválida é rejeitada (401), não entra na lista de clientes", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    await assert.rejects(() => connect(base, "token-invalido-qualquer"));
    assert.equal(daemon.hub.clientCount, 0);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("SPEC-HR6: broadcast escopado por conta — admin vê tudo, conta só vê a própria, outra conta não vê nada", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-ws@exemplo.com");
    const bob = await signup(base, "bob-ws@exemplo.com");
    createSoul(home, "soul-alice-ws", { name: "soul-alice-ws", ownerAccountId: alice.accountId });

    const adminWs = await connect(base, ADMIN_TOKEN);
    const aliceWs = await connect(base, alice.token);
    const bobWs = await connect(base, bob.token);
    try {
      assert.equal(daemon.hub.clientCount, 3);

      const adminMsgs = collectMessages(adminWs, 300);
      const aliceMsgs = collectMessages(aliceWs, 300);
      const bobMsgs = collectMessages(bobWs, 300);

      // Evento escopado pra conta da Alice — simula o que chat.ts/memory.ts fazem.
      daemon.hub.broadcast(
        { type: "chat.step", soul: "soul-alice-ws", message: "segredo da conversa da Alice" },
        { accountId: alice.accountId },
      );

      const [adminGot, aliceGot, bobGot] = await Promise.all([adminMsgs, aliceMsgs, bobMsgs]);

      assert.ok(adminGot.some((m) => m.type === "chat.step"), "admin deve ver o evento escopado (visão total)");
      assert.ok(aliceGot.some((m) => m.type === "chat.step"), "Alice deve ver o próprio evento");
      assert.ok(!bobGot.some((m) => m.type === "chat.step"), "Bob NUNCA deve ver evento escopado pra conta da Alice");
    } finally {
      adminWs.close();
      aliceWs.close();
      bobWs.close();
    }
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("SPEC-HR6: broadcast sem escopo (eventos sistêmicos) só chega em admin, nunca em sessão de conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-ws2@exemplo.com");

    const adminWs = await connect(base, ADMIN_TOKEN);
    const aliceWs = await connect(base, alice.token);
    try {
      const adminMsgs = collectMessages(adminWs, 300);
      const aliceMsgs = collectMessages(aliceWs, 300);

      daemon.hub.broadcast({ type: "agenda.processed", item: { id: 1 } }); // sem scope — hoje: voice/monitor/agenda/whatsapp/telegram/mission

      const [adminGot, aliceGot] = await Promise.all([adminMsgs, aliceMsgs]);
      assert.ok(adminGot.some((m) => m.type === "agenda.processed"), "admin recebe eventos sistêmicos");
      assert.ok(!aliceGot.some((m) => m.type === "agenda.processed"), "sessão de conta não recebe eventos sistêmicos não-escopados");
    } finally {
      adminWs.close();
      aliceWs.close();
    }
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("SPEC-HR6: reconexão e troca de sessão — nova conexão da mesma conta preserva o escopo, socket antigo some da lista", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-ws3@exemplo.com");
    createSoul(home, "soul-alice-ws3", { name: "soul-alice-ws3", ownerAccountId: alice.accountId });

    const first = await connect(base, alice.token);
    assert.equal(daemon.hub.clientCount, 1);
    first.close();
    await new Promise((r) => setTimeout(r, 100)); // "close" do socket é assíncrono

    const second = await connect(base, alice.token);
    try {
      assert.equal(daemon.hub.clientCount, 1, "socket antigo deve ter saído do hub, só o novo conta");

      const msgs = collectMessages(second, 300);
      daemon.hub.broadcast({ type: "chat.done", soul: "soul-alice-ws3" }, { accountId: alice.accountId });
      const got = await msgs;
      assert.ok(got.some((m) => m.type === "chat.done"), "reconexão continua recebendo eventos escopados pra conta");
    } finally {
      second.close();
    }
  } finally {
    await daemon.close();
    await cleanup();
  }
});
