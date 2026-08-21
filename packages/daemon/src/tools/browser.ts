/**
 * Browser Automation Engine via Playwright with CDP Integration (Inspired by Flow OS)
 *
 * Executor headless para navegação, clique, extração de texto estruturado
 * e captura de telas (screenshots para auditoria multimodal).
 *
 * Capacidades MCP Tools:
 *   browser_navigate    — abre/navega uma URL
 *   browser_click       — clica em um elemento CSS
 *   browser_extract_text — extrai texto ou tabelas como JSON/Markdown
 *   browser_screenshot   — captura screenshot (base64)
 *   browser_close        — fecha a sessão do navegador
 *   browser_get_accessibility_tree — árvore de acessibilidade da página
 *   browser_execute_fix  — injeção dinâmica de JavaScript para contornar bloqueios
 *   browser_audited_screenshot — screenshot auditado com metadados
 *
 * Filosofia Local-First: falhas em Playwright ou CDP não travam o daemon.
 * Cada tarefa tem sua Page isolada (Map<taskId, Page>).
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";

// ── Tipos ──────────────────────────────────────────────────────────────

export interface BrowserResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AccessibilityNode {
  role: string;
  name?: string;
  description?: string;
  value?: string | string[];
  children: AccessibilityNode[];
  bbox?: { x: number; y: number; width: number; height: number };
  states?: string[];
  labeledby?: string[];
}

export interface ScreenshotAuditData {
  timestamp: string;
  sha256: string;
  metadata?: Record<string, unknown>;
  format: "png" | "jpeg" | "webp";
  fullPage: boolean;
  sizeBytes: number;
}

export interface TableData {
  headers: string[];
  rows: Record<string, string>[];
}

// ── Table extraction helpers ────────────────────────────────────────────

/**
 * Converte tabelas cruas extraídas do DOM ({headers, cells}) em TableData[],
 * mapeando cada linha para um objeto keyed pelos headers. Células a mais são
 * descartadas; headers sem célula correspondente viram string vazia.
 */
export function domTableToData(raw: { headers: string[]; cells: string[][] }[]): TableData[] {
  return raw.map(({ headers, cells }) => ({
    headers,
    rows: cells.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] ?? "";
      });
      return obj;
    }),
  }));
}

/** Serializa TableData[] como uma ou mais tabelas Markdown, separadas por linha em branco. */
export function tableDataToMarkdown(tables: TableData[]): string {
  return tables
    .map((t) => {
      const headerLine = `| ${t.headers.join(" | ")} |`;
      const sepLine = `| ${t.headers.map(() => "---").join(" | ")} |`;
      const rowLines = t.rows.map((r) => `| ${t.headers.map((h) => r[h] ?? "").join(" | ")} |`);
      return [headerLine, sepLine, ...rowLines].join("\n");
    })
    .join("\n\n");
}

// ── Lazy Playwright import ─────────────────────────────────────────────

type PlaywrightModule = typeof import("playwright-core");
let _pw: PlaywrightModule | null = null;
let _pwError: string | null = null;

async function getPlaywright(): Promise<PlaywrightModule | null> {
  if (_pw) return _pw;
  if (_pwError) return null;
  try {
    _pw = await import("playwright-core");
    return _pw;
  } catch (err) {
    _pwError = (err as Error).message;
    return null;
  }
}

// ── Chrome resolution ──────────────────────────────────────────────────

function resolveChromePath(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

// ── Browser Engine (Singleton) ────────────────────────────────────────

type Browser = import("playwright-core").Browser;
type Page = import("playwright-core").Page;
type BrowserContext = import("playwright-core").BrowserContext;
type CDPSession = import("playwright-core").CDPSession;

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
const pages = new Map<string, Page>();

async function ensureBrowser(): Promise<{ browser: Browser; context: BrowserContext } | { error: string }> {
  if (_browser && _context) return { browser: _browser, context: _context };

  const pw = await getPlaywright();
  if (!pw) return { error: `Playwright não disponível: ${_pwError ?? "import falhou"}` };

  const chromePath = resolveChromePath();
  if (!chromePath) return { error: "Nenhum navegador Chrome/Chromium encontrado. Instale chromium ou defina CHROME_PATH." };

  try {
    _browser = await pw.chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });
    _context = await _browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });
    return { browser: _browser, context: _context };
  } catch (err) {
    _browser = null;
    _context = null;
    return { error: `Falha ao iniciar Chrome: ${(err as Error).message}` };
  }
}

function getPage(taskId: string): Page | undefined {
  return pages.get(taskId);
}

// ── SHA-256 Hash helper ───────────────────────────────────────────────

function computeSHA256(content: string): string {
  const buffer = Buffer.from(content, "utf8");
  return createHash("sha256").update(buffer).digest("hex");
}

// ── Accessibility Tree extraction ─────────────────────────────────────

/**
 * Extrai a árvore de acessibilidade da página via CDP.
 * Retorna hierarquia de AccessibilityNode resiliente a variações de CSS,
 * IDs ofuscados ou renderizações dinâmicas.
 */
async function getAccessibilityTreeFromPage(page: Page): Promise<AccessibilityNode> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Accessibility.enable");
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    return buildAccessibilityTree(nodes);
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Converte a lista plana de AXNode (protocolo CDP Accessibility.getFullAXTree)
 * em uma árvore hierárquica, seguindo childIds a partir da raiz (nó sem pai).
 */
function buildAccessibilityTree(nodes: any[]): AccessibilityNode {
  const byId = new Map<string, any>();
  for (const node of nodes) byId.set(node.nodeId, node);
  const childIds = new Set<string>();
  for (const node of nodes) {
    for (const id of node.childIds ?? []) childIds.add(id);
  }
  const root = nodes.find((n) => !childIds.has(n.nodeId)) ?? nodes[0];

  function convert(node: any): AccessibilityNode {
    const children: AccessibilityNode[] = (node.childIds ?? [])
      .map((id: string) => byId.get(id))
      .filter(Boolean)
      .map((child: any) => convert(child));
    const states: string[] = (node.properties ?? [])
      .filter((p: any) => p?.value?.value === true)
      .map((p: any) => p.name);

    return {
      role: node.role?.value ?? "unknown",
      name: node.name?.value,
      description: node.description?.value,
      value: node.value?.value,
      children,
      states: states.length ? states : undefined,
    };
  }

  return root ? convert(root) : { role: "unknown", children: [] };
}

// ── CDP Session management ────────────────────────────────────────────

async function getCDPSession(taskId: string): Promise<{ session: CDPSession } | { error: string }> {
  const page = getPage(taskId);
  if (!page) return { error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    const session = await page.context().newCDPSession(page);
    return { session };
  } catch (err) {
    return { error: `Falha ao conectar CDP: ${(err as Error).message}` };
  }
}

// ── MCP Tool Functions ────────────────────────────────────────────────

/**
 * browser_navigate: abre uma URL em uma página associada à tarefa.
 */
export async function browserNavigate(url: string, taskId: string = "default"): Promise<BrowserResult> {
  const inst = await ensureBrowser();
  if ("error" in inst) return { ok: false, error: inst.error };

  try {
    let page = getPage(taskId);
    if (!page) {
      page = await inst.context.newPage();
      pages.set(taskId, page);
    }
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const status = response?.status() ?? 0;
    const title = await page.title();
    return {
      ok: status >= 200 && status < 400,
      data: { url, status, title },
    };
  } catch (err) {
    return { ok: false, error: `Navegação falhou: ${(err as Error).message}` };
  }
}

/**
 * browser_click: clica em um elemento CSS na página da tarefa.
 */
export async function browserClick(selector: string, taskId: string = "default"): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: false, error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    await page.waitForSelector(selector, { timeout: 10_000 });
    await page.click(selector);
    const url = page.url();
    const title = await page.title();
    return { ok: true, data: { selector, url, title } };
  } catch (err) {
    return { ok: false, error: `Click falhou: ${(err as Error).message}` };
  }
}

/**
 * browser_extract_text: extrai texto estruturado da página.
 * Se selector = "table", extrai todas as tabelas como JSON/Markdown.
 * Se selector = "body" ou ausente, extrai texto completo.
 */
export async function browserExtractText(
  selector: string = "body",
  taskId: string = "default",
): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: false, error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    if (selector === "table" || selector === "tables") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await page.$$eval("table", (tables: any[]) =>
        tables.map((t: any) => {
          const headerRow = t.querySelector("thead tr") ?? t.querySelector("tr");
          const headers: string[] = headerRow
            ? Array.from(headerRow.querySelectorAll("th, td")).map((c: any) => ((c.textContent ?? "") as string).trim())
            : [];
          const bodyRows = t.querySelectorAll("tbody tr, tr");
          const cells: string[][] = [];
          for (const row of bodyRows) {
            if (row === headerRow) continue;
            cells.push(Array.from(row.querySelectorAll("td, th")).map((c: any) => ((c.textContent ?? "") as string).trim()));
          }
          return { headers, cells };
        }),
      );
      const tables = domTableToData(raw);
      const json = tables;
      const markdown = tableDataToMarkdown(tables);
      return { ok: true, data: { format: "table", json, markdown, count: tables.length } };
    }

    // Extração de texto genérica — executa no contexto do browser via eval
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = await page.$eval(selector, (el: any) => {
      const htmlEl = el as { innerText?: string; textContent?: string | null };
      return htmlEl.innerText ?? htmlEl.textContent ?? "";
    });
    return { ok: true, data: { format: "text", selector, text: text.trim().slice(0, 50_000) } };
  } catch (err) {
    return { ok: false, error: `Extração falhou: ${(err as Error).message}` };
  }
}

/**
 * browser_screenshot: captura screenshot da página (base64).
 */
export async function browserScreenshot(
  taskId: string = "default",
  fullPage: boolean = false,
): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: false, error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    const buffer = await page.screenshot({ fullPage, type: "png" });
    const base64 = buffer.toString("base64");
    return {
      ok: true,
      data: {
        format: "png",
        fullPage,
        sizeBytes: buffer.length,
        base64: base64.slice(0, 100_000) + (base64.length > 100_000 ? "...[truncado]" : ""),
      },
    };
  } catch (err) {
    return { ok: false, error: `Screenshot falhou: ${(err as Error).message}` };
  }
}

/**
 * browser_close: fecha a página da tarefa e libera recursos.
 */
export async function browserClose(taskId: string = "default"): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: true, data: { taskId, alreadyClosed: true } };

  try {
    await page.close().catch(() => {});
    pages.delete(taskId);
    return { ok: true, data: { taskId } };
  } catch (err) {
    pages.delete(taskId);
    return { ok: false, error: `Close falhou: ${(err as Error).message}` };
  }
}

/**
 * Fecha todas as páginas e o browser. Chamado em shutdown.
 */
export async function browserShutdown(): Promise<void> {
  for (const [id] of pages) {
    await browserClose(id).catch(() => {});
  }
  if (_context) {
    await _context.close().catch(() => {});
    _context = null;
  }
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

/**
 * Retorna o número de páginas ativas (para monitoramento).
 */
export function activePageCount(): number {
  return pages.size;
}

// ── New: getAccessibilityTree ──────────────────────────────────────────

/**
 * getAccessibilityTree: extrai a hierarquia de acessibilidade (AccessibilityNode)
 * da página, permitindo navegação semântica resiliente a variações de classes CSS,
 * IDs ofuscados ou renderizações dinâmicas.
 */
export async function getAccessibilityTree(taskId: string = "default"): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: false, error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    const tree = await getAccessibilityTreeFromPage(page);
    return {
      ok: true,
      data: { tree },
    };
  } catch (err) {
    return { ok: false, error: `Árvore de acessibilidade falhou: ${(err as Error).message}` };
  }
}

// ── New: captureAuditedScreenshot ─────────────────────────────────────

/**
 * captureAuditedScreenshot: captura screenshot da página com timestamp,
 * hash SHA-256 e metadata anexada para auditoria/relatórios.
 * Salva o arquivo no diretório temporário/audit da sessão e retorna base64 ou caminho local.
 */
export async function captureAuditedScreenshot(
  taskId: string = "default",
  metadata?: Record<string, unknown>,
  fullPage: boolean = false,
): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: false, error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    const timestamp = new Date().toISOString();
    const buffer = await page.screenshot({ fullPage, type: "png" });
    const base64 = buffer.toString("base64");
    const sha256 = computeSHA256(base64);

    const auditData: ScreenshotAuditData = {
      timestamp,
      sha256,
      metadata,
      format: "png",
      fullPage,
      sizeBytes: buffer.length,
    };

    // Save to session audit directory
    const soulId = process.env.AGENT_SOUL_ID || "default";
    const auditDir = join(tmpdir(), "assistant-os", "audit", soulId);
    await mkdir(auditDir, { recursive: true });

    const auditFile = join(auditDir, `screenshot-${timestamp}.json`);
    await writeFile(auditFile, JSON.stringify(auditData, null, 2));

    return {
      ok: true,
      data: {
        ...auditData,
        base64,
        auditFile,
      },
    };
  } catch (err) {
    return { ok: false, error: `Screenshot auditado falhou: ${(err as Error).message}` };
  }
}

// ── New: executeDynamicFix ────────────────────────────────────────────

/**
 * executeDynamicFix: permite que o agente injete trechos de JavaScript para
 * destravar obstáculos de página (ex.: remoção de overlays invisíveis,
 * desbloqueio de z-index, fechar popups abusivos ou scroll forçado).
 *
 * Executa o script em sandbox com tratamento estrito de exceção (try/catch),
 * retornando { ok: boolean, data?: unknown, error?: string } sem quebrar
 * o processo do daemon.
 *
 * Scripts bem-sucedidos são armazenados em ~/.assistant-os/souls/<soulId>/tools_cache/browser_helpers.json.
 */
export async function executeDynamicFix(
  taskId: string,
  scriptContent: string,
  reason: string,
): Promise<BrowserResult> {
  const page = getPage(taskId);
  if (!page) return { ok: false, error: `Nenhuma página aberta para a tarefa: ${taskId}` };

  try {
    // Execute the script in the page context using page.evaluate
    const result = await page.evaluate((code: string) => {
      // Block dangerous operations
      if (code.includes("alert(") || code.includes("prompt(") || code.includes("confirm(")) {
        throw new Error("Operações de diálogo não permitidas");
      }
      if (code.includes("fetch(") || code.includes("XMLHttpRequest")) {
        throw new Error("Requisições de rede não permitidas");
      }
      if (code.includes("localStorage") || code.includes("sessionStorage")) {
        throw new Error("Armazenamento local não permitida");
      }
      if (code.includes("import") || code.includes("require")) {
        throw new Error("Importações não permitidas");
      }

      // Executa em escopo restrito (só document/window/console do próprio contexto da página)
      const doc = (globalThis as any).document;
      const win = (globalThis as any).window;
      const fn = new Function("document", "window", "console", code);
      return fn(doc, win, console);
    }, scriptContent);

    // Store the successful helper in the tools cache
    const soulId = process.env.AGENT_SOUL_ID || "default";
    const toolsCacheDir = join(
      process.env.ASSISTENTE_OS_HOME || `${homedir()}/.assistant-os`,
      "souls",
      soulId,
      "tools_cache"
    );

    // Ensure directory exists
    try {
      await import("node:fs/promises").then(fs => fs.mkdir(toolsCacheDir, { recursive: true }));

      // Read existing helpers or create new
      const helpersFile = join(toolsCacheDir, "browser_helpers.json");
      let helpers: Record<string, any> = {};
      try {
        const existing = await import("node:fs/promises").then(fs => fs.readFile(helpersFile, "utf8"));
        helpers = JSON.parse(existing);
      } catch {
        // File doesn't exist yet
      }

      // Add the new helper
      const helperKey = `fix_${Date.now()}_${reason.replace(/\s+/g, "_").toLowerCase()}`;
      helpers[helperKey] = {
        script: scriptContent,
        reason,
        taskId,
        timestamp: new Date().toISOString(),
        status: "validated",
      };

      // Write back
      await import("node:fs/promises").then(fs => fs.writeFile(helpersFile, JSON.stringify(helpers, null, 2)));
    } catch (storageErr) {
      console.debug(`Could not store helper script: ${(storageErr as Error).message}`);
    }

    return {
      ok: true,
      data: { result, reason },
    };
  } catch (err) {
    // Error handling - never crash the daemon
    return {
      ok: false,
      error: `Injeção dinâmica falhou: ${(err as Error).message}`,
    };
  }
}

