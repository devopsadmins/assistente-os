import { loadConfig, getPool, claimEntityExtractionJobs, finishEntityExtractionJob } from "@assistente-os/core";
import { processExtractionJob } from "@assistente-os/memory";

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
      await processExtractionJob(pool, { soul: job.soul, body: job.body }, {
        ollamaUrl: config.ollamaUrl,
        chatModel: config.ollamaChatModel,
      });
      await finishEntityExtractionJob(pool, job.id, "completed");
      onDone?.({ id: job.id, soul: job.soul, status: "completed" });
    } catch (err) {
      await finishEntityExtractionJob(pool, job.id, "failed", err instanceof Error ? err.message : String(err));
      onDone?.({ id: job.id, soul: job.soul, status: "failed" });
    }
    processed += 1;
  }
  return processed;
}
