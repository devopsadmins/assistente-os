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
  }, [config, soulId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createNewThread = useCallback(async () => {
    const thread = await createThread(config, soulId);
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
  }, [config, soulId]);

  return { threads, loading, error, activeThreadId, setActiveThreadId, createNewThread };
}
