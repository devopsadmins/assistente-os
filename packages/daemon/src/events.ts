import { createHash } from "node:crypto";
import { loadConfig, getPool, recordCostCall, selectRoute, getSoul, claimPendingEvents, finishEvent, openSession, bumpSessionPrompt, recordExecution } from "@assistente-os/core";
import { runOpenCode, type OpenCodeRunResult } from "./runner.js";
import { buildPrompt } from "./context.js";
import { relevanceRule } from "./relevance.js";

export interface EventConsumerOptions {
  home: string;
  run?: (prompt: string, options: Parameters<typeof runOpenCode>[1]) => Promise<OpenCodeRunResult>;
  onDone?: (event: { id: number; type: string; soul: string | null; status: string }) => void;
}

/**
 * Consome eventos pendentes em background: monta o buffer da soul de destino,
 * seleciona o degrau do roteador, executa o opencode run headless e registra
 * custo + execution_log. Eventos falhos viram status "failed" (não saem da fila).
 */
export async function processPendingEvents(options: EventConsumerOptions): Promise<number> {
  const { home, onDone } = options;
  const run = options.run ?? runOpenCode;
  const config = loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const pending = await claimPendingEvents(pool, 5);
  let processed = 0;
  for (const ev of pending) {
    try {
      const soulId = ev.soul ?? "main";
      const soul = getSoul(home, soulId);
      if (!soul) throw new Error(`soul ${soulId} não encontrada`);
      let payloadText = "";
      if (ev.payload) {
        try {
          const parsed = JSON.parse(ev.payload);
          payloadText = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        } catch {
          payloadText = ev.payload;
        }
      }
      const prompt = `[evento ${ev.type}]${payloadText ? `\n${payloadText}` : ""}`;
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
        note: `tier=${decision.target.tier}; origem=event:${ev.type}; latency_ms=${Date.now() - startedAt}`,
      });
      await recordExecution(pool, {
        sessionId: session.id,
        soul: soul.id,
        kind: `event:${ev.type}`,
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
      await finishEvent(pool, ev.id, status);
      onDone?.({ id: ev.id, type: ev.type, soul: ev.soul, status });
    } catch (err) {
      await finishEvent(pool, ev.id, "failed", err instanceof Error ? err.message : String(err));
      onDone?.({ id: ev.id, type: ev.type, soul: ev.soul, status: "failed" });
    }
    processed += 1;
  }
  return processed;
}
