/**
 * SPEC-HR2 (fix): `sanitizeUserPrompt`/`sanitizeLLMResponse` guardam segredo
 * detectado no temp-vault sob `taskId=session.id` (packages/core/src/security/
 * temp-vault.ts — "zero-persistência" prometida no próprio docblock do
 * módulo). Nada no sistema lê esse valor de volta (`getCredential`/
 * `getAllCredentials`/`listActiveTasks` não tinham nenhum chamador real fora
 * de testes) — antes deste fix, `purgeCredentials(taskId)` nunca era chamado
 * em produção, e o segredo ficava em memória pelo tempo de vida do processo
 * do daemon inteiro. Cobre `POST /souls/:id/chat` (o caminho mais comum).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul, listActiveTasks, purgeAll } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";
// Casa com o padrão OPENAI_API_KEY (`sk-[A-Za-z0-9]{20,}`) — content-filter
// detecta e sanitizeUserPrompt guarda o valor original no temp-vault.
const FAKE_SECRET = "sk-" + "a1B2c3D4e5F6g7H8i9J0".repeat(2);

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-hr2-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("SPEC-HR2: segredo no prompt do /chat não sobra no temp-vault depois da requisição", async () => {
  purgeAll(); // estado limpo — o vault é global no processo
  const { home, cleanup } = await tempHome();
  createSoul(home, "soul-hr2", { name: "soul-hr2" });
  writeFileSync(join(home, "souls", "soul-hr2", "perfil.md"), "# soul-hr2\n");
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    // A execução real do modelo pode falhar/faltar no ambiente de teste — não
    // importa pro que este teste cobre: o ponto é que preparePromptContext já
    // rodou sanitizeUserPrompt (e guardou o segredo) ANTES de qualquer chance
    // de falha, e o `finally` em handleChat purga independente do resultado.
    await fetch(`${base}/souls/soul-hr2/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: `minha chave é ${FAKE_SECRET}, guarda em segredo`, timeoutSeconds: 5 }),
    }).catch(() => null); // rede/timeout do lado do teste não deve derrubar a asserção abaixo

    const leftover = listActiveTasks();
    assert.deepEqual(leftover, [], `temp-vault deveria estar vazio após a requisição, mas achou: ${JSON.stringify(leftover)}`);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("SPEC-HR2: dois turnos seguidos na mesma sessão — cada um purga o próprio segredo, nenhum acumula", async () => {
  purgeAll();
  const { home, cleanup } = await tempHome();
  createSoul(home, "soul-hr2b", { name: "soul-hr2b" });
  writeFileSync(join(home, "souls", "soul-hr2b", "perfil.md"), "# soul-hr2b\n");
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
    for (let i = 0; i < 2; i++) {
      await fetch(`${base}/souls/soul-hr2b/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: `turno ${i}: chave ${FAKE_SECRET}`, timeoutSeconds: 5 }),
      }).catch(() => null);
    }
    assert.deepEqual(listActiveTasks(), [], "nenhum segredo deve sobrar após múltiplos turnos");
  } finally {
    await daemon.close();
    await cleanup();
  }
});
