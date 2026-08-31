/**
 * Teto de conhecimento por conta no modo amigável (KB, não chunks — decisão
 * registrada em memória de projeto). Cobre: teto aplicado só a sessão de
 * conta (token admin fica livre), rejeição quando o upload estoura o teto,
 * upload dentro do teto passa e reflete no GET de configurações.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-upload-"));
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

async function signupAndCreateSoul(base: string, email: string): Promise<{ token: string; soulId: string }> {
  const signup = await fetchJson(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  const headers = { authorization: `Bearer ${signup.body.token}`, "content-type": "application/json" };
  const dry = await fetchJson(`${base}/accounts/me/souls`, { method: "POST", headers, body: JSON.stringify({ purpose: "algo" }) });
  const commit = await fetchJson(`${base}/accounts/me/souls`, {
    method: "POST", headers,
    body: JSON.stringify({ purpose: "algo", dry_run: false, plan_hash: dry.body.plan_hash }),
  });
  return { token: signup.body.token, soulId: commit.body.soul_id };
}

function multipartBody(filename: string, content: string): { body: string; contentType: string } {
  const boundary = "----test-boundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
    `Content-Type: text/plain\r\n\r\n${content}\r\n` +
    `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

test("upload: dentro do teto passa e some no GET de configurações (knowledge.usedKb)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "upload-ok@exemplo.com");
    const headers = { authorization: `Bearer ${token}` };

    const before = await fetchJson(`${base}/accounts/me/souls/${soulId}`, { headers: { ...headers, "content-type": "application/json" } });
    assert.equal(before.body.knowledge.usedKb, 0);
    assert.ok(before.body.knowledge.limitKb > 0);

    // >1KB de propósito: usedKb arredonda em KB inteiro, um arquivo de poucas
    // dezenas de bytes viraria 0 KB e a asserção abaixo daria falso negativo.
    const mp = multipartBody("doc.md", "# Conhecimento\n" + "Algum conteúdo. ".repeat(100));
    const res = await fetch(`${base}/souls/${soulId}/upload`, {
      method: "POST",
      headers: { ...headers, "content-type": mp.contentType },
      body: mp.body,
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.saved.length, 1);

    const after = await fetchJson(`${base}/accounts/me/souls/${soulId}`, { headers: { ...headers, "content-type": "application/json" } });
    assert.ok(after.body.knowledge.usedKb > 0, "usedKb deveria refletir o arquivo recém-enviado");
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("upload: estourar o teto por conta é rejeitado com E_ACCOUNT_LIMIT, upload não é salvo", async () => {
  const prevLimit = process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT;
  process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT = "1"; // 1 KB — qualquer coisa razoável já estoura
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "upload-estoura@exemplo.com");
    const headers = { authorization: `Bearer ${token}` };

    const mp = multipartBody("doc.md", "x".repeat(5000)); // ~5KB, bem acima do teto de 1KB
    const res = await fetch(`${base}/souls/${soulId}/upload`, {
      method: "POST",
      headers: { ...headers, "content-type": mp.contentType },
      body: mp.body,
    });
    assert.equal(res.status, 400);
    const data = (await res.json()) as any;
    assert.equal(data.code, "E_ACCOUNT_LIMIT");

    const after = await fetchJson(`${base}/accounts/me/souls/${soulId}`, { headers: { ...headers, "content-type": "application/json" } });
    assert.equal(after.body.knowledge.usedKb, 0, "upload rejeitado não deveria ter sido salvo em disco");
  } finally {
    await daemon.close();
    await cleanup();
    if (prevLimit === undefined) delete process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT;
    else process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT = prevLimit;
  }
});

test("upload: token admin não é limitado pelo teto de conta", async () => {
  const prevLimit = process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT;
  process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT = "1";
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    // soul do operador, sem ownerAccountId — criada só pra ter uma soul pra subir arquivo.
    const { createSoul } = await import("@assistente-os/core");
    createSoul(home, "operador", { name: "operador" });

    const mp = multipartBody("doc.md", "x".repeat(5000));
    const res = await fetch(`${base}/souls/operador/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": mp.contentType },
      body: mp.body,
    });
    assert.equal(res.status, 200, "token admin não deve ser bloqueado pelo teto de conta self-service");
  } finally {
    await daemon.close();
    await cleanup();
    if (prevLimit === undefined) delete process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT;
    else process.env.ASSISTENTE_OS_FRIENDLY_UPLOAD_KB_LIMIT = prevLimit;
  }
});
