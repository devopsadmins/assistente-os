import { createHash } from "node:crypto";
import {
  loadConfig,
  getPool,
  recordCostCall,
  selectRoute,
  getSoul,
  claimDueAgenda,
  finishAgendaItem,
  openSession,
  bumpSessionPrompt,
  recordExecution,
} from "@assistente-os/core";
import { runOpenCode, type OpenCodeRunResult } from "./runner.js";
import { buildPrompt } from "./context.js";
import { relevanceRule } from "./relevance.js";

export interface AgendaConsumerOptions {
  home: string;
  run?: (prompt: string, options: Parameters<typeof runOpenCode>[1]) => Promise<OpenCodeRunResult>;
  onDone?: (item: { id: number; title: string; soul: string | null; status: string }) => void;
}

/**
 * Despacha itens da agenda vencidos (due_at <= agora ou sem due_at): monta o
 * buffer da soul de destino, seleciona o degrau do roteador, executa o
 * opencode run headless e registra custo + execution_log. Espelha o mesmo
 * padrão de processPendingEvents (events.ts) para a tabela `agenda`.
 */
export async function processDueAgenda(options: AgendaConsumerOptions): Promise<number> {
  const { home, onDone } = options;
  const run = options.run ?? runOpenCode;
  const config = loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const due = await claimDueAgenda(pool, 5);
  let processed = 0;
  for (const item of due) {
    try {
      const soulId = item.soul ?? "main";
      const soul = getSoul(home, soulId);
      if (!soul) throw new Error(`soul ${soulId} não encontrada`);
      const prompt = `[agenda] ${item.title}${item.body ? `\n\n${item.body}` : ""}`;
      const built = await buildPrompt({ home, soul, prompt, config, relevance: relevanceRule() });
      const decision = await selectRoute(pool, config, soul, config.routerTiers);
      const session = await openSession(pool, soul.id, config.defaultMaxTurns);
      await bumpSessionPrompt(pool, session.id);
      const startedAt = Date.now();
      const result = await run(built.fullPrompt, {
        cwd: soul.dir,
        model: decision.target.model,
        timeoutSeconds: 120,
        agent: soul.config.agent ? soul.id : undefined,
        soulId: soul.id,
      });
      await recordCostCall(pool, {
        soul: soul.id,
        provider: decision.target.provider,
        model: decision.target.model,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `tier=${decision.target.tier}; origem=agenda:${item.id}; latency_ms=${Date.now() - startedAt}`,
      });
      await recordExecution(pool, {
        sessionId: session.id,
        soul: soul.id,
        kind: "agenda",
        promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
        model: decision.target.model,
        tier: decision.target.tier,
        filesLoaded: built.files.filter((f) => f.chars > 0).length,
        contextChars: built.contextChars,
        verdict: built.verdict == null ? undefined : JSON.stringify(built.verdict),
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `latency_ms=${Date.now() - startedAt}`,
      });
      const status = result.code === 0 && !result.timedOut ? "completed" : "failed";
      await finishAgendaItem(pool, item.id, status, status === "failed" ? "opencode retornou código != 0 ou expirou" : undefined);
      onDone?.({ id: item.id, title: item.title, soul: item.soul, status });
    } catch (err) {
      await finishAgendaItem(pool, item.id, "failed", err instanceof Error ? err.message : String(err));
      onDone?.({ id: item.id, title: item.title, soul: item.soul, status: "failed" });
    }
    processed += 1;
  }
  return processed;
}
