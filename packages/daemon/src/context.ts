import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  todayISODate,
  getPool,
  listActiveGoldenRules,
  CONCISE_OUTPUT_DIRECTIVE,
  listSkills,
  matchSkills,
  renderSkillsIndex,
  renderActiveSkills,
  skillsEnabled,
  resolveAllowedTools,
  isToolAllowed,
  type AssistenteOsConfig,
  type Soul,
} from "@assistente-os/core";
import { retrieveContext, getEmbedder, computeRagConfidence, ragMinConfidence } from "@assistente-os/memory";

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
  /** Skills da allowlist e as que casaram o prompt (undefined quando SKILLS_ENABLED=0 ou allowlist vazia). */
  skills?: { available: string[]; active: Array<{ name: string; score: number; usedEmbedding: boolean }> };
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
  /** Turnos recentes da conversa (mesma sessão) — dá memória multi-turno ao chat. */
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<BuiltPrompt> {
  const { home, soul, prompt, config, withRag = true, history } = options;
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

  // T3.3: persona (perfil + licoes) é semi-estática por soul → fica no prefixo
  // estável, apto a prompt caching / reuso de KV cache do Ollama. O log da
  // sessão do dia cresce a cada turno → sai daqui e vai pra cauda dinâmica
  // (`sessaoCtx`, junto de RAG e histórico).
  let personaCtx = "";
  if (perfil || licoes) {
    personaCtx = `## Identidade da alma (persistente — leia antes de responder)
${perfil ? `--- Perfil ---\n${perfil}\n` : ""}
${licoes ? `--- Lições aprendidas ---\n${licoes}\n` : ""}`.trim();
  }
  let sessaoCtx = "";
  if (sessao) {
    sessaoCtx = `## Sessão atual (${today})\n${sessao}`.trim();
  }
  // Compat: `almaCtx` no retorno segue sendo persona + sessão (o inspector de
  // buffer e o consumidor de eventos leem esse campo).
  const almaCtx = [personaCtx, sessaoCtx].filter(Boolean).join("\n\n");

  // ── Skills por soul (Etapa 9): índice (semi-estático → prefixo) separado do
  //    corpo das que casaram (dinâmico → cauda volátil). ──
  let skillsIndexCtx = "";
  let skillsActiveCtx = "";
  let skillsMeta: BuiltPrompt["skills"];
  if (skillsEnabled()) {
    const all = listSkills(home, soul);
    if (all.length > 0) {
      const embedder = getEmbedder();
      const embed = async (texts: string[]): Promise<number[][]> => {
        const vs = await Promise.all(texts.map((t) => embedder.embed(t)));
        return vs.map((v) => v ?? []);
      };
      const active = await matchSkills(prompt, all, { embed }).catch(() => []);
      const allowed = resolveAllowedTools(soul.config.agent);
      skillsIndexCtx = renderSkillsIndex(all);
      skillsActiveCtx = renderActiveSkills(active, (t) => isToolAllowed(allowed, t));
      skillsMeta = {
        available: all.map((s) => s.name),
        active: active.map((m) => ({ name: m.skill.name, score: m.score, usedEmbedding: m.usedEmbedding })),
      };
    }
  }

  let ragCtx = "";
  let verdict: unknown = null;
  if (withRag && prompt.trim()) {
    try {
      const pool = getPool(config.databaseUrl);
      const res = await retrieveContext(pool, soul.id, prompt, 5);
      // Screening de prompt injection nos chunks já rodou dentro de retrieveContext;
      // aqui só propagamos os findings pelo verdict para o chat.ts logar/alertar.
      const injection = res.injectionFindings ?? [];
      const rerank = { mode: res.rerankMode, ms: res.rerankMs };
      const cacheHit = res.cacheHit ?? "miss";
      // E11: confiança multi-sinal (top-score × concordância × freshness) + modo
      // "evidência insuficiente" quando abaixo do piso `AOS_RAG_MIN_CONFIDENCE`.
      const confidence = computeRagConfidence(res.sources);
      const minConf = ragMinConfidence();
      if (res.hasRelevantDocs && confidence.score >= minConf) {
        // Cada linha do contexto cita a fonte: [score · arquivo]. A diretriz de
        // constrained generation vem antes (o chat monta este bloco no fim, mais
        // volátil, então ela mora aqui e não nas regras).
        ragCtx = `## Contexto de conhecimento relevante (RAG)
Responda usando SÓ o que está abaixo. Cite a fonte entre colchetes (ex.: [${res.sources[0]?.doc ?? "arquivo.md"}]). Se o contexto não cobrir a pergunta, diga que não há evidência suficiente — não complete com conhecimento próprio.

${res.sources
  .map((r) => `- [${r.doc} · sim ${r.score.toFixed(3)}${r.indexedAt ? ` · ${r.indexedAt.slice(0, 10)}` : ""}] ${r.snippet}`)
  .join("\n")}`;
        verdict = { ok: true, sources: res.sources, confidence, injection, rerank, cacheHit };
      } else if (res.hasRelevantDocs) {
        // Achou docs, mas a confiança não alcança o piso → não injeta o contexto;
        // instrui o modelo a admitir a falta de evidência.
        ragCtx = `## Evidência insuficiente
A base de conhecimento da soul não cobre esta pergunta com confiança suficiente (confidence ${confidence.score.toFixed(2)} < ${minConf}). Responda dizendo objetivamente que não há evidência suficiente na base; não complete com conhecimento próprio.`;
        verdict = { ok: false, motivo: "confidence_below_floor", confidence, sources: res.sources, injection, rerank, cacheHit };
      } else {
        verdict = { ok: false, motivo: "nenhum documento relevante encontrado", confidence, injection, rerank, cacheHit };
      }
    } catch {
      ragCtx = "";
    }
  }

  let historyCtx = "";
  if (history && history.length > 0) {
    historyCtx = `## Histórico da conversa (turnos recentes — mais recente por último)
${history.map((m) => `**${m.role === "user" ? "Usuário" : "Assistente"}:** ${m.content}`).join("\n")}`;
  }

  let rulesCtx = "";
  const activeRules = listActiveGoldenRules(home);
  if (activeRules.length > 0) {
    rulesCtx = `## Regras de Ouro (obrigatórias — aprendidas de incidentes anteriores e aprovadas pelo usuário)
${activeRules.map((r) => `- **${r.topic}:** ${r.ruleText}`).join("\n")}`;
  }

  // Ordem do mais estático para o mais volátil (T3.3 + Etapa 9): maximiza o
  // prefixo de bytes idêntico entre turnos → prompt caching e reuso de KV cache.
  //   estático  : CONCISE_OUTPUT_DIRECTIVE (const global)
  //   semi-estát: rulesCtx (golden rules globais), personaCtx (perfil+licoes),
  //               skillsIndexCtx (lista de skills da soul)
  //   ── fronteira volátil ──
  //   dinâmico  : skillsActiveCtx (corpo das skills que casaram), sessaoCtx
  //               (log do dia), ragCtx (recuperação), historyCtx (turnos)
  // CONCISE_OUTPUT_DIRECTIVE fica sempre em 1º (há teste que exige startsWith).
  const prefixParts = [
    CONCISE_OUTPUT_DIRECTIVE,
    rulesCtx,
    personaCtx,
    skillsIndexCtx,
    skillsActiveCtx,
    sessaoCtx,
    ragCtx,
    historyCtx,
  ].filter(Boolean);
  const fullPrompt = prefixParts.length > 1
    ? `${prefixParts.join("\n\n")}\n\n--- Instrução do usuário ---\n${prompt}`
    : `${prefixParts.join("\n\n")}\n\n${prompt}`;

  return { almaCtx, ragCtx, fullPrompt, files, verdict, contextChars: fullPrompt.length, skills: skillsMeta };
}
