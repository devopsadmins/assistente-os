/**
 * Escrita de memória persistente da alma (openclaw-style).
 *
 * Espelha os helpers de escrita de `core/acervo.py` do SLC-OS:
 *  - `anotar`        -> append na sessão do dia em `sessoes/YYYY-MM-DD.md`
 *  - `registrar_licao` -> append em `licoes.md`
 *  - `decidir`       -> grava ADR markdown em `decisoes/YYYY-MM-DD-<slug>.md`
 *  - `appendSoulFile` -> append genérico (perfil/pessoas/contexto)
 *
 * Restrição: nenhum uso de shell/child_process — apenas I/O de arquivos via node:fs.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SoulPaths {
  dir: string;
  sessoes: string;
  decisoes: string;
}

/** Caminhos canônicos de uma alma (pastas de sessões/decisões). */
export function soulPaths(dir: string): SoulPaths {
  return { dir, sessoes: join(dir, "sessoes"), decisoes: join(dir, "decisoes") };
}

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

function slugify(text: string): string {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Caminho do arquivo de sessão do dia (cria a pasta se preciso). */
export function sessionFile(soulDir: string, dateISO?: string): string {
  const d = dateISO ?? todayISODate();
  const p = soulPaths(soulDir);
  mkdirSync(p.sessoes, { recursive: true });
  return join(p.sessoes, `${d}.md`);
}

/** Garante a alma tenha arquivos de memória mínimos vazios (idempotente). */
export function ensureAlmaFiles(soulDir: string): void {
  mkdirSync(soulDir, { recursive: true });
  for (const f of ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"]) {
    const p = join(soulDir, f);
    if (!existsSync(p)) writeFileSync(p, "", "utf8");
  }
  mkdirSync(join(soulDir, "sessoes"), { recursive: true });
  mkdirSync(join(soulDir, "decisoes"), { recursive: true });
}

/** Anota um item cronológico na sessão do dia corrente (equivalente a `acervo.anotar`). */
export function anotar(soulDir: string, texto: string, dateISO?: string): string {
  const file = sessionFile(soulDir, dateISO);
  if (!existsSync(file)) {
    writeFileSync(file, `# Sessão ${dateISO ?? todayISODate()} — ${basename(soulDir)}\n\n`, "utf8");
  }
  appendFileSync(file, `- ${nowISO()} — ${texto}\n`, "utf8");
  return file;
}

/** Registra uma lição em `licoes.md` (equivalente a `acervo.registrar_licao`). */
export function registrarLicao(soulDir: string, texto: string): string {
  const file = join(soulDir, "licoes.md");
  if (!existsSync(file)) ensureAlmaFiles(soulDir);
  appendFileSync(file, `- [${todayISODate()}] ${texto}\n`, "utf8");
  return file;
}

/** Registra uma observação genérica (append). Útil para `pessoas.md`/`perfil.md`. */
export function appendSoulFile(soulDir: string, file: "perfil.md" | "contexto.md" | "licoes.md" | "pessoas.md", line: string): string {
  const p = join(soulDir, file);
  if (!existsSync(p)) ensureAlmaFiles(soulDir);
  appendFileSync(p, `${line}\n`, "utf8");
  return p;
}

export interface DecidirInputs {
  titulo: string;
  contexto?: string;
  decisao?: string;
  alternativas?: string;
  consequencias?: string;
  dateISO?: string;
}

/** Grava uma decisão no formato ADR em `decisoes/<data>-<slug>.md` (equivalente a `acervo.decidir`). */
export function decidir(soulDir: string, inputs: DecidirInputs): string {
  const { titulo, contexto = "", decisao = "", alternativas = "", consequencias = "", dateISO = todayISODate() } = inputs;
  const dir = soulPaths(soulDir).decisoes;
  mkdirSync(dir, { recursive: true });
  const slug = slugify(titulo);
  const file = join(dir, `${dateISO}-${slug}.md`);
  if (existsSync(file)) {
    throw new Error(`já existe: ${file}`);
  }
  const content = [
    `# Decisão: ${titulo}`,
    "",
    `- **Data:** ${dateISO}`,
    `- **Alma:** ${basename(soulDir)}`,
    "- **Status:** Aceita",
    "",
    "## Contexto",
    "",
    contexto.trim() || "_não preenchido_",
    "",
    "## Decisão",
    "",
    decisao.trim() || "_não preenchida_",
    "",
    "## Alternativas consideradas",
    "",
    alternativas.trim() || "_não registradas_",
    "",
    "## Consequências",
    "",
    consequencias.trim() || "_não registradas_",
    "",
  ].join("\n");
  writeFileSync(file, content, "utf8");
  return file;
}

function basename(p: string): string {
  return p.replace(/[/\\]+$/, "").replace(/^.*[/\\]/, "");
}

export interface LimparOpts {
  maxAgeDays?: number;
  maxBytes?: number;
}

/**
 * Rotina de retenção da alma — idempotente.
 * Remove sessões mais velhas que `maxAgeDays` e aplica `maxBytes` sliding sobre
 * `sessoes/` (elimina as mais antigas até caber). Mantém sempre a sessão atual.
 * NÃO toca licoes.md/decisoes (append-only; auditoria).
 */
export function limparSoul(soulDir: string, opts: LimparOpts = {}): { removidos: number; bytesAntes: number; bytesDepois: number } {
  const { sessoes } = soulPaths(soulDir);
  let removidos = 0;
  let bytesAntes = 0;
  let bytesDepois = 0;
  if (!existsSync(sessoes)) return { removidos: 0, bytesAntes: 0, bytesDepois: 0 };

  const today = todayISODate();
  const files = readdirSync(sessoes).filter((f) => f.endsWith(".md"));
  const stats = files.map((f) => {
    const p = join(sessoes, f);
    const bytes = statSync(p).size;
    return { name: f, bytes, p };
  });
  bytesAntes = stats.reduce((s, x) => s + x.bytes, 0);

  for (const s of stats) {
    const dateStr = s.name.slice(0, 10);
    const isToday = dateStr === today;
    if (isToday) continue;
    let remove = false;
    if (typeof opts.maxAgeDays === "number" && isFinite(Date.parse(dateStr))) {
      const ageDays = (Date.now() - Date.parse(dateStr)) / 86400000;
      if (ageDays > opts.maxAgeDays) remove = true;
    }
    if (remove) {
      unlinkSync(s.p);
      removidos++;
    }
  }

  if (typeof opts.maxBytes === "number") {
    const remaining = readdirSync(sessoes)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const p = join(sessoes, f);
        return { name: f, bytes: statSync(p).size, p };
      })
      .filter((s) => s.name.slice(0, 10) !== today)
      .sort((a, b) => a.name.localeCompare(b.name)); // mais antigos primeiro
    let total = remaining.reduce((s, x) => s + x.bytes, 0);
    for (const s of remaining) {
      if (total <= opts.maxBytes) break;
      unlinkSync(s.p);
      removidos++;
      total -= s.bytes;
    }
  }

  const after = readdirSync(sessoes).filter((f) => f.endsWith(".md"));
  bytesDepois = after.reduce((s, f) => s + statSync(join(sessoes, f)).size, 0);
  return { removidos, bytesAntes, bytesDepois };
}

export interface SoulHealth {
  soul: string;
  exists: boolean;
  sessoesFiles: number;
  sessoesBytes: number;
  ultimaSessao: string | null;
  licoesLines: number;
  decisoesFiles: number;
}

/** Health check estruturado (O(1) por soul; apenas stat, sem DB). */
export function soulHealth(soulDir: string): SoulHealth {
  const p = (f: string) => join(soulDir, f);
  const { sessoes, decisoes } = soulPaths(soulDir);
  const exists = existsSync(p("soul.md"));
  let sessoesFiles = 0;
  let sessoesBytes = 0;
  let ultima: string | null = null;
  if (existsSync(sessoes)) {
    const fs = readdirSync(sessoes).filter((f) => f.endsWith(".md"));
    sessoesFiles = fs.length;
    let latest = "";
    for (const f of fs) {
      sessoesBytes += statSync(join(sessoes, f)).size;
      if (f > latest) latest = f;
    }
    if (latest) ultima = latest.slice(0, 10);
  }
  let licoesLines = 0;
  const licoesPath = p("licoes.md");
  if (existsSync(licoesPath)) licoesLines = readFileSync(licoesPath, "utf8").split("\n").filter(Boolean).length;
  const decisoesFiles = existsSync(decisoes) ? readdirSync(decisoes).filter((f) => f.endsWith(".md")).length : 0;
  return { soul: basename(soulDir), exists, sessoesFiles, sessoesBytes, ultimaSessao: ultima, licoesLines, decisoesFiles };
}
