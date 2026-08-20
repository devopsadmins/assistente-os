/**
 * Browser Automation Engine via Playwright (Inspired by Flow OS)
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
 *
 * Filosofia Local-First: falhas em Playwright não travam o daemon.
 * Cada tarefa tem sua Page isolada (Map<taskId, Page>).
 */

import { existsSync } from "node:fs";

// ── Tipos ──────────────────────────────────────────────────────────────

export interface BrowserResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface TableData {
  headers: string[];
  rows: Record<string, string>[];
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

// ── DOM → Table Parser ────────────────────────────────────────────────

/**
 * Converte HTML de tabela (via page.$$eval) em TableData estruturado.
 * Exportada para testes unitários.
 */
export function domTableToData(raw: Array<{ headers: string[]; cells: string[][] }>): TableData[] {
  return raw.map((t) => ({
    headers: t.headers,
    rows: t.cells.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < t.headers.length; i++) {
        obj[t.headers[i] ?? `col_${i}`] = row[i] ?? "";
      }
      return obj;
    }),
  }));
}

/**
 * Serializa TableData para Markdown.
 * Exportada para testes unitários.
 */
export function tableDataToMarkdown(tables: TableData[]): string {
  if (tables.length === 0) return "";
  const parts: string[] = [];
  for (const table of tables) {
    const headerLine = `| ${table.headers.join(" | ")} |`;
    const sepLine = `| ${table.headers.map(() => "---").join(" | ")} |`;
    const dataLines = table.rows.map((row) =>
      `| ${table.headers.map((h) => row[h] ?? "").join(" | ")} |`,
    );
    parts.push([headerLine, sepLine, ...dataLines].join("\n"));
  }
  return parts.join("\n\n");
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
