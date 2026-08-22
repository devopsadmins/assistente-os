import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { todayISODate, getPool, listActiveGoldenRules, type AssistenteOsConfig, type Soul } from "@assistente-os/core";
import { retrieveContext } from "@assistente-os/memory";

export interface BuiltPromptFile {
  path: string;
  chars: number;
}

export interface BuiltPrompt {
  almaCtx: string;
  ragCtx: string;
  fullPrompt: string;
  files: BuiltPromptFile[];
  verdict: unknown;
  contextChars: number;
}

/**
 * Monta o buffer da soul: contexto persistente (perfil/licoes/pessoas/sessão)
 * + RAG com gate de relevância. Reutilizado pelo chat, pelo consumidor de
 * eventos e pelo inspector de buffer (GET /souls/:id/buffer).
 */
export async function buildPrompt(options: {
  home: string;
  soul: Soul;
  prompt: string;
  config: AssistenteOsConfig;
  withRag?: boolean;
}): Promise<BuiltPrompt> {
  const { home, soul, prompt, config, withRag = true } = options;
  const today = todayISODate();
  const sessionPath = join(soul.dir, "sessoes", `${today}.md`);
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").trim() : "");
  const perfil = read(join(soul.dir, "perfil.md"));
  const licoes = read(join(soul.dir, "licoes.md"));
  const pessoas = read(join(soul.dir, "pessoas.md"));
  const sessao = read(sessionPath);
  const files: BuiltPromptFile[] = [
    { path: join(soul.dir, "perfil.md"), chars: perfil.length },
    { path: join(soul.dir, "licoes.md"), chars: licoes.length },
    { path: join(soul.dir, "pessoas.md"), chars: pessoas.length },
    { path: sessionPath, chars: sessao.length },
  ];

  let almaCtx = "";
  if (perfil || licoes || sessao) {
    almaCtx = `## Identidade da alma (persistente — leia antes de responder)
${perfil ? `--- Perfil ---\n${perfil}\n` : ""}
${licoes ? `--- Lições aprendidas ---\n${licoes}\n` : ""}
${sessao ? `--- Sessão atual (${today}) ---\n${sessao}\n` : ""}`.trim();
  }

  let ragCtx = "";
  let verdict: unknown = null;
  if (withRag && prompt.trim()) {
    try {
      const pool = getPool(config.databaseUrl);
      const res = await retrieveContext(pool, soul.id, prompt, 5);
      if (res.hasRelevantDocs) {
        ragCtx = `## Contexto de conhecimento relevante (RAG)
${res.sources.map((r) => `- [${r.score.toFixed(3)}] ${r.snippet}`).join("\n")}`;
        verdict = { ok: true, sources: res.sources };
      } else {
        verdict = { ok: false, motivo: "nenhum documento relevante encontrado" };
      }
    } catch {
      ragCtx = "";
    }
  }

  let rulesCtx = "";
  const activeRules = listActiveGoldenRules(home);
  if (activeRules.length > 0) {
    rulesCtx = `## Regras de Ouro (obrigatórias — aprendidas de incidentes anteriores e aprovadas pelo usuário)
${activeRules.map((r) => `- **${r.topic}:** ${r.ruleText}`).join("\n")}`;
  }

  const prefixParts = [rulesCtx, almaCtx, ragCtx].filter(Boolean);
  const fullPrompt = prefixParts.length
    ? `${prefixParts.join("\n\n")}\n\n--- Instrução do usuário ---\n${prompt}`
    : prompt;

  return { almaCtx, ragCtx, fullPrompt, files, verdict, contextChars: fullPrompt.length };
}
