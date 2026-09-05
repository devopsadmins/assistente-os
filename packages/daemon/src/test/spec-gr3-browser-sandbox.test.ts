/**
 * SPEC-GR3: `browser_execute_fix` rodava via `page.evaluate` — mesmo realm
 * JS da página, sem isolamento real (o "sandbox" do docblock antigo era só
 * uma lista de substrings bloqueadas, contornável). `getCDPSession` já
 * existia (usado pela árvore de acessibilidade) mas nunca tinha sido ligado
 * a `executeDynamicFix`. Agora roda num isolated world CDP
 * (`evaluateInIsolatedWorld`) — DOM compartilhado, realm de JS separado.
 *
 * Testa com um browser real (headless), não mock — a garantia que importa
 * (não enxergar globals que a página definiu) só é real se verificada
 * contra o CDP de verdade.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { browserNavigate, browserShutdown, executeDynamicFix } from "../tools/browser.js";

function hasChrome(): boolean {
  return (
    Boolean(process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) ||
    existsSync("/usr/bin/google-chrome") ||
    existsSync("/usr/bin/chromium-browser") ||
    existsSync("/usr/bin/chromium")
  );
}

const PAGE_HTML = `
<!doctype html><html><body>
<div id="overlay" style="position:fixed">bloqueando a página</div>
<script>window.__pageSecret = "não deveria vazar pro isolated world";</script>
</body></html>`;

function startTestServer(): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/`, server });
    });
  });
}

test(
  "SPEC-GR3: executeDynamicFix roda em isolated world — não enxerga globals da página, mas manipula o DOM real",
  { skip: !hasChrome() && "sem Chrome/Chromium instalado neste ambiente" },
  async () => {
    const taskId = "spec-gr3-sandbox";
    const { url, server } = await startTestServer();
    try {
      const nav = await browserNavigate(url, taskId);
      assert.ok(nav.ok, JSON.stringify(nav));

      // 1) Isolamento: window.__pageSecret existe no realm da página, não no
      // isolated world — a mesma classe de proteção que evita que um script
      // de "fix" leia estado/segredos que o site definiu em memória.
      const leakAttempt = await executeDynamicFix(
        taskId,
        "return typeof window.__pageSecret;",
        "teste: tenta ler global da página",
      );
      assert.ok(leakAttempt.ok, JSON.stringify(leakAttempt));
      assert.equal(
        (leakAttempt.data as { result?: unknown } | undefined)?.result,
        "undefined",
        "isolated world não deveria enxergar window.__pageSecret da página",
      );

      // 2) DOM continua acessível — o isolated world compartilha o document,
      // então remover um overlay (o caso de uso real da tool) ainda funciona.
      const domFix = await executeDynamicFix(
        taskId,
        "var el = document.getElementById('overlay'); if (el) el.remove(); return document.getElementById('overlay') === null;",
        "teste: remove overlay via DOM compartilhado",
      );
      assert.ok(domFix.ok, JSON.stringify(domFix));
      assert.equal(
        (domFix.data as { result?: unknown } | undefined)?.result,
        true,
        "isolated world deveria conseguir manipular o DOM real da página",
      );

      // 3) Defesa em profundidade — bloqueio por substring continua valendo
      // mesmo com isolamento de realm (isolated world não bloqueia Web APIs).
      const blocked = await executeDynamicFix(taskId, "fetch('https://example.com');", "teste: rede bloqueada");
      assert.equal(blocked.ok, false);
      assert.match(blocked.error ?? "", /não permitidas/);
    } finally {
      await browserShutdown();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
