import { useCallback, useEffect, useState } from "react";
import { createThread, listThreads, type ApiClientConfig } from "../api/client";
import type { Thread } from "../api/types";

export interface UseThreadsResult {
  threads: Thread[];
  loading: boolean;
  error: string | null;
  activeThreadId: number | null;
  setActiveThreadId: (id: number) => void;
  createNewThread: () => Promise<void>;
}

export function useThreads(config: ApiClientConfig, soulId: string): UseThreadsResult {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listThreads(config, soulId);
      setThreads(result);
      setActiveThreadId((current) => current ?? result[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar threads");
    } finally {
      setLoading(false);
    }
  }, [config.baseUrl, config.token, soulId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createNewThread = useCallback(async () => {
    // Sem try/catch, um daemon fora do ar fazia o clique em "+ Nova thread"
    // não dar nenhum feedback — a promise rejeitada morria em `void
    // createNewThread()` (ThreadScreen) sem nunca tocar `error`. Mesmo
    // tratamento que `reload` já dá pra listThreads.
    try {
      const thread = await createThread(config, soulId);
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao criar thread");
    }
  }, [config.baseUrl, config.token, soulId]);

  return { threads, loading, error, activeThreadId, setActiveThreadId, createNewThread };
}
