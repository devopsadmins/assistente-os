import { loadConfig, getPool, claimEntityExtractionJobs, finishEntityExtractionJob } from "@assistente-os/core";
import { processExtractionJob } from "@assistente-os/memory";
import { recordLlmCall } from "./observability/record-llm-call.js";

export interface EntityExtractionConsumerOptions {
  home: string;
  onDone?: (job: { id: number; soul: string; status: string }) => void;
}

/**
 * Despacha jobs pendentes de extração de entidades/relações via LLM. Espelha
 * o formato de processDueAgenda/processPendingEvents, mas mais simples — não
 * é um turno de agente (sem buildPrompt/selectRoute/sessão/custo), só uma
 * chamada de extração + persistência no grafo.
 */
export async function processEntityExtractionJobs(options: EntityExtractionConsumerOptions): Promise<number> {
  const { home, onDone } = options;
  const config = loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const jobs = await claimEntityExtractionJobs(pool, 5);
  let processed = 0;
  for (const job of jobs) {
    try {
      const { usage } = await processExtractionJob(pool, { soul: job.soul, body: job.body }, {
        ollamaUrl: config.ollamaUrl,
        chatModel: config.ollamaChatModel,
      });
      await finishEntityExtractionJob(pool, job.id, "completed");
      if (usage) {
        try {
          await recordLlmCall({
            pool,
            soul: { id: job.soul },
            route: "entity-extraction",
            provider: "ollama",
            model: config.ollamaChatModel,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            latencyMs: usage.latencyMs,
            source: "provider",
          });
        } catch {
          /* telemetria best-effort */
        }
      }
      onDone?.({ id: job.id, soul: job.soul, status: "completed" });
    } catch (err) {
      await finishEntityExtractionJob(pool, job.id, "failed", err instanceof Error ? err.message : String(err));
      onDone?.({ id: job.id, soul: job.soul, status: "failed" });
    }
    processed += 1;
  }
  return processed;
}
