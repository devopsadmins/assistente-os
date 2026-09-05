/**
 * SPEC-GR2: toda sessão de `POST /souls/:id/chat` anexa um rodapé estruturado
 * (```yaml usage_metadata```) na sessão do dia (`sessoes/YYYY-MM-DD.md`) —
 * telemetria auditável em arquivo, complementar aos registros em Postgres
 * (que rotacionam/expiram). Cobre com uma requisição HTTP real, não mock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul, todayISODate } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-gr2-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("SPEC-GR2: POST /chat anexa bloco usage_metadata na sessão do dia", async () => {
  const { home, cleanup } = await tempHome();
  const created = createSoul(home, "soul-gr2", { name: "soul-gr2" });
  writeFileSync(join(created.dir, "perfil.md"), "# soul-gr2\n");
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    // A execução real do modelo pode falhar/faltar no ambiente de teste —
    // não importa pro que este teste cobre: o rodapé é gravado a partir do
    // finalUsage já resolvido (real ou estimado/zerado), depois que
    // recordExecution já rodou, independente de sucesso.
    await fetch(`${base}/souls/soul-gr2/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "diga oi", timeoutSeconds: 5 }),
    }).catch(() => null);

    const sessionFile = join(created.dir, "sessoes", `${todayISODate()}.md`);
    assert.equal(existsSync(sessionFile), true, "sessão do dia deveria existir após a requisição");
    const content = readFileSync(sessionFile, "utf8");
    assert.match(content, /```yaml usage_metadata/);
    assert.match(content, /session_id: "\d+"/);
    assert.match(content, /prompt_tokens: \d+/);
    assert.match(content, /completion_tokens: \d+/);
    assert.match(content, /latency_ms: \d+/);
    assert.match(content, /model_used: ".+"/);
    assert.match(content, /execution_mode: ".+"/);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("SPEC-GR2: múltiplos turnos seguidos nunca produzem session_id repetido no rodapé", async () => {
  const { home, cleanup } = await tempHome();
  const created = createSoul(home, "soul-gr2b", { name: "soul-gr2b" });
  writeFileSync(join(created.dir, "perfil.md"), "# soul-gr2b\n");
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
    for (let i = 0; i < 2; i++) {
      await fetch(`${base}/souls/soul-gr2b/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: `turno ${i}`, timeoutSeconds: 5 }),
      }).catch(() => null);
    }

    const sessionFile = join(created.dir, "sessoes", `${todayISODate()}.md`);
    const content = existsSync(sessionFile) ? readFileSync(sessionFile, "utf8") : "";
    const ids = [...content.matchAll(/session_id: "(\d+)"/g)].map((m) => m[1]);
    // Duas requisições completadas dentro da janela de idle da mesma soul
    // normalmente reusam a mesma sessão — o que importa aqui é que, seja qual
    // for o número real de sessões, cada session_id aparece só uma vez
    // (a garantia de idempotência é exercida em detalhe em alma.test.ts).
    assert.deepEqual(ids, [...new Set(ids)], `session_id não deveria se repetir, achou: ${JSON.stringify(ids)}`);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
