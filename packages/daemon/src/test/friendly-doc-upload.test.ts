/**
 * FM1 — upload self-service de PDF/DOCX/XLSX: o texto é extraído para um
 * sidecar `.md` e entra na indexação; documentos ilegíveis são reportados,
 * não indexados, e não derrubam o upload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-doc-upload-"));
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
  return { status: res.status, body: await res.json().catch(() => null) };
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
    method: "POST",
    headers,
    body: JSON.stringify({ purpose: "algo", dry_run: false, plan_hash: dry.body.plan_hash }),
  });
  return { token: signup.body.token, soulId: commit.body.soul_id };
}

function multipart(files: { filename: string; buf: Buffer; mime: string }[]): { body: Buffer; contentType: string } {
  const boundary = "----aos-" + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.mime}\r\n\r\n`,
      ),
    );
    chunks.push(f.buf);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function makeDocx(paragraphs: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
  );
  zip.addFile(
    "word/document.xml",
    Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("") +
        `</w:body></w:document>`,
    ),
  );
  return zip.toBuffer();
}

test("upload DOCX → gera sidecar .md e entra na indexação", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "docx@exemplo.com");

    const mp = multipart([
      {
        filename: "ata.docx",
        buf: makeDocx(["Reunião de kickoff.", "Decisão: seguir com o piloto em outubro."]),
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);
    const res = await fetch(`${base}/souls/${soulId}/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": mp.contentType },
      body: mp.body,
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;

    assert.equal(data.saved.length, 1);
    assert.equal(data.documents.indexed.length, 1);
    assert.equal(data.documents.indexed[0].from, "ata.docx");
    assert.equal(data.documents.skipped.length, 0);
    assert.ok(data.indexing >= 1, "o sidecar deveria estar na fila de indexação");

    const sidecar = join(home, "souls", soulId, "sources", "uploads", "ata.docx.md");
    assert.ok(existsSync(sidecar), "sidecar ata.docx.md não foi gravado");
    const md = readFileSync(sidecar, "utf8");
    assert.match(md, /Decisão: seguir com o piloto/);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("upload PDF ilegível → reportado em documents.skipped, upload segue 200", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "pdfbad@exemplo.com");

    const mp = multipart([
      { filename: "scan.pdf", buf: Buffer.from("%PDF-1.4 conteudo que nao e um pdf de verdade"), mime: "application/pdf" },
      { filename: "notas.txt", buf: Buffer.from("# Notas\nconteúdo de texto simples"), mime: "text/plain" },
    ]);
    const res = await fetch(`${base}/souls/${soulId}/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": mp.contentType },
      body: mp.body,
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;

    assert.equal(data.saved.length, 2);
    assert.equal(data.documents.indexed.length, 0);
    assert.equal(data.documents.skipped.length, 1);
    assert.equal(data.documents.skipped[0].name, "scan.pdf");
    assert.ok(typeof data.documents.skipped[0].reason === "string" && data.documents.skipped[0].reason.length > 0);
    assert.equal(data.indexing, 1, "só o .txt entra na fila");

    assert.ok(existsSync(join(home, "souls", soulId, "sources", "uploads", "scan.pdf")), "binário mantido para proveniência");
  } finally {
    await daemon.close();
    await cleanup();
  }
});
