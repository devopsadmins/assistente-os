/**
 * Spec Grill — refinamento de requisitos em duas fases, antes de autorizar
 * o "modo build" de uma feature.
 *
 * Fase 1 (sem `answers`): gera 3-5 perguntas de esclarecimento (via Ollama,
 * com fallback heurístico determinístico se offline/resposta inválida —
 * LOCAL_FIRST_RESILIENCE) e persiste em `contexto.md` da soul como bloco
 * `pending`.
 * Fase 2 (com `answers`, >= 3): localiza o bloco `pending` mais recente pra
 * a mesma `featureDraft`, valida as respostas e reescreve o bloco como
 * `authorized`, liberando `buildModeAuthorized: true`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { todayISODate } from "@assistente-os/core";

export interface GrillQuestion {
  id: number;
  categoria: "regra-negocio" | "edge-case" | "dependencia-banco-api";
  pergunta: string;
}

export interface GrillPlanResult {
  ok: boolean;
  soulId: string;
  questions?: GrillQuestion[];
  buildModeAuthorized?: boolean;
  arquivo: string;
}

/** Template determinístico usado quando o Ollama está offline ou devolve JSON inválido. */
const FALLBACK_QUESTIONS: Omit<GrillQuestion, "id">[] = [
  { categoria: "regra-negocio", pergunta: "Qual é a regra de negócio principal que essa feature precisa respeitar?" },
  { categoria: "edge-case", pergunta: "Quais casos extremos (edge cases) essa feature precisa tratar?" },
  { categoria: "dependencia-banco-api", pergunta: "Essa feature depende de alguma tabela/schema de banco ou API externa específica?" },
  { categoria: "regra-negocio", pergunta: "Qual é o critério de aceite pra considerar essa feature pronta?" },
];

const CATEGORIAS_VALIDAS = new Set<GrillQuestion["categoria"]>(["regra-negocio", "edge-case", "dependencia-banco-api"]);

async function gerarPerguntasViaOllama(featureDraft: string): Promise<GrillQuestion[] | null> {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content:
              'Você é um analista de requisitos. Gere de 3 a 5 perguntas de esclarecimento sobre a feature descrita pelo usuário, categorizadas em "regra-negocio", "edge-case" ou "dependencia-banco-api". Responda em JSON estrito no formato {"questions": [{"categoria": "...", "pergunta": "..."}]}.',
          },
          { role: "user", content: featureDraft },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { message?: { content?: string } };
    const raw = data.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { questions?: { categoria?: string; pergunta?: string }[] };
    if (!Array.isArray(parsed.questions)) return null;
    const questions: GrillQuestion[] = [];
    for (const q of parsed.questions.slice(0, 5)) {
      if (typeof q.pergunta !== "string" || !q.pergunta.trim()) continue;
      const categoria = CATEGORIAS_VALIDAS.has(q.categoria as GrillQuestion["categoria"])
        ? (q.categoria as GrillQuestion["categoria"])
        : "regra-negocio";
      questions.push({ id: questions.length + 1, categoria, pergunta: q.pergunta.trim() });
    }
    return questions.length >= 3 ? questions : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fase 1: gera as perguntas de esclarecimento (Ollama com fallback heurístico). */
export async function gerarPerguntasGrill(featureDraft: string): Promise<GrillQuestion[]> {
  const viaOllama = await gerarPerguntasViaOllama(featureDraft);
  if (viaOllama) return viaOllama;
  return FALLBACK_QUESTIONS.map((q, i) => ({ id: i + 1, ...q }));
}

function contextoPath(soulDir: string): string {
  return `${soulDir}/contexto.md`;
}

function formatQuestions(questions: GrillQuestion[]): string {
  return questions.map((q) => `${q.id}. [${q.categoria}] ${q.pergunta}`).join("\n");
}

/** Fase 1: persiste o bloco `pending` (perguntas geradas) em contexto.md da soul. */
export function persistirPerguntasGrill(soulDir: string, featureDraft: string, questions: GrillQuestion[]): string {
  if (!existsSync(soulDir)) mkdirSync(soulDir, { recursive: true });
  const file = contextoPath(soulDir);
  const blockId = randomUUID();
  const block = [
    `<!-- spec-grill:${blockId} -->`,
    `## Spec Grill — ${todayISODate()} (status: pending)`,
    "",
    `**Feature:** ${featureDraft}`,
    "",
    "**Perguntas:**",
    formatQuestions(questions),
    `<!-- /spec-grill:${blockId} -->`,
    "",
  ].join("\n");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, existing.trim() ? `${existing.trimEnd()}\n\n${block}` : block, "utf8");
  return file;
}

/**
 * Fase 2: localiza o bloco `pending` mais recente com a mesma `featureDraft`
 * exata, valida as respostas (mínimo 3) e reescreve pra `authorized`.
 * Lança erro (bloco permanece `pending`) se não achar bloco ou se as
 * respostas forem insuficientes.
 */
export function finalizarPlanoGrill(soulDir: string, featureDraft: string, answers: string[]): { arquivo: string } {
  const file = contextoPath(soulDir);
  if (!existsSync(file)) throw new Error(`nenhum spec grill pendente encontrado para esta soul (${file} não existe)`);
  const validAnswers = answers.filter((a) => typeof a === "string" && a.trim().length > 0);
  if (validAnswers.length < 3) {
    throw new Error(`respostas insuficientes: recebi ${validAnswers.length}, mínimo 3 — o bloco continua pending`);
  }

  const content = readFileSync(file, "utf8");
  const blockRe = /<!-- spec-grill:([0-9a-f-]+) -->[\s\S]*?<!-- \/spec-grill:\1 -->/g;
  const featureLine = `**Feature:** ${featureDraft}`;
  let lastMatch: RegExpExecArray | null = null;
  for (const m of content.matchAll(blockRe)) {
    if (m[0].includes("(status: pending)") && m[0].includes(featureLine)) lastMatch = m as RegExpExecArray;
  }
  if (!lastMatch) {
    throw new Error(`nenhum bloco spec grill pendente encontrado para a feature "${featureDraft}"`);
  }

  const blockId = lastMatch[1];
  const refreshed = lastMatch[0]
    .replace("(status: pending)", "(status: authorized)")
    .replace(
      new RegExp(`(<!-- /spec-grill:${blockId} -->)`),
      [
        "",
        "**Respostas:**",
        validAnswers.map((a, i) => `${i + 1}. ${a.trim()}`).join("\n"),
        "",
        `**Autorizado em:** ${todayISODate()}`,
        "$1",
      ].join("\n"),
    );

  const updated = content.slice(0, lastMatch.index) + refreshed + content.slice(lastMatch.index + lastMatch[0].length);
  writeFileSync(file, updated, "utf8");
  return { arquivo: file };
}
