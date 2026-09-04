import type { Thread, ThreadMessage } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientConfig {
  /** "" em produção (mesma origem do Vite, que faz proxy pro daemon real); uma URL absoluta nos testes. */
  baseUrl: string;
  token: string;
}

async function request<T>(config: ApiClientConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `requisição falhou (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corpo não é JSON — mantém a mensagem genérica
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listThreads(config: ApiClientConfig, soulId: string): Promise<Thread[]> {
  return request<Thread[]>(config, `/souls/${encodeURIComponent(soulId)}/threads`);
}

export function createThread(config: ApiClientConfig, soulId: string, title?: string): Promise<Thread> {
  return request<Thread>(config, `/souls/${encodeURIComponent(soulId)}/threads`, {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function getThreadMessages(config: ApiClientConfig, soulId: string, threadId: number): Promise<ThreadMessage[]> {
  return request<ThreadMessage[]>(config, `/souls/${encodeURIComponent(soulId)}/threads/${threadId}/messages`);
}
