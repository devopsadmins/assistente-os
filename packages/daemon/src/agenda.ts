import { createHash } from "node:crypto";
import {
  loadConfig,
  getPool,
  recordCostCall,
  calcCost,
  selectRoute,
  getSoul,
  claimDueAgenda,
  reapStaleAgenda,
  finishAgendaItem,
  isDbHealthy,
  openSession,
  bumpSessionPrompt,
  recordExecution,
  recordSessionMessage,
  logger,
} from "@assistente-os/core";
import { runOpenCode, type OpenCodeRunResult } from "./runner.js";
import { buildPrompt } from "./context.js";

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
  // SPEC-HR1 (fatia 3, 2026-09-05): sem a sonda, cada tick do timer (30s) com
  // Postgres fora do ar esperaria o connectionTimeoutMillis cheio do pool (5s)
  // em duas queries (reap + claim) antes de cair no onJobError — pula rápido
  // em vez disso, já logado como aviso (não é uma falha nova, é o BD fora).
  if (!(await isDbHealthy(pool))) {
    logger.warn({ job: "agenda" }, "Postgres indisponível — pulando este ciclo da agenda");
    return 0;
  }
  const reaped = await reapStaleAgenda(pool, {
    staleMinutes: Number(process.env.AOS_AGENDA_STALE_MINUTES) || 15,
    maxAttempts: Number(process.env.AOS_AGENDA_MAX_ATTEMPTS) || 3,
  });
  if (reaped.retried || reaped.failed) {
    logger.warn({ ...reaped }, "agenda reaper: itens presos em 'processing' recuperados");
  }
  const due = await claimDueAgenda(pool, 5);
  let processed = 0;
  for (const item of due) {
    try {
      const soulId = item.soul ?? "main";
      const soul = getSoul(home, soulId);
      if (!soul) throw new Error(`soul ${soulId} não encontrada`);
      const prompt = `[agenda] ${item.title}${item.body ? `\n\n${item.body}` : ""}`;
      const built = await buildPrompt({ home, soul, prompt, config });
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
        cost: calcCost(decision.target.provider, decision.target.model, 0, 0),
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
      if (result.code === 0 && !result.timedOut) {
        try {
          await recordSessionMessage(pool, session.id, soul.id, "user", prompt);
          await recordSessionMessage(pool, session.id, soul.id, "assistant", result.stdout ?? "");
        } catch {
          /* non-fatal */
        }
      }
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
