import { LocalXenovaEmbedder } from "./embedder-local.js";
import { getEmbedder } from "./embedder-provider.js";

export type HealthStatus = "healthy" | "degraded" | "critical";

export interface HealthCheck {
  status: HealthStatus;
  xenova?: {
    initialized: boolean;
    available: boolean;
  };
  ollama?: {
    reachable: boolean;
  };
  message: string;
}

export async function healthCheck(): Promise<HealthCheck> {
  const xenova = new LocalXenovaEmbedder();
  let xenovaInit = false;
  let xenovaAvailable = false;
  let ollamaReachable = false;
  
  try {
    await xenova.init();
    xenovaInit = true;
    xenovaAvailable = true;
  } catch (err) {
    xenovaInit = false;
    xenovaAvailable = false;
  }
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: ctrl.signal });
    clearTimeout(timer);
    ollamaReachable = res.ok;
  } catch {
    ollamaReachable = false;
  }
  
  const fallback = getEmbedder();
  let fallbackStatus: HealthStatus = "critical";
  
  try {
    await fallback.embed("test");
    if (xenovaAvailable) {
      fallbackStatus = "healthy";
    } else {
      fallbackStatus = "degraded";
    }
  } catch {
    fallbackStatus = xenovaAvailable ? "degraded" : "critical";
  }
  
  let message = "";
  switch (fallbackStatus) {
    case "healthy":
      message = "Xenova embedder operational";
      break;
    case "degraded":
      message = "Xenova unavailable, using Ollama fallback";
      break;
    case "critical":
      message = "Both Xenova and Ollama unavailable";
      break;
  }
  
  return {
    status: fallbackStatus,
    xenova: xenovaInit ? { initialized: true, available: xenovaAvailable } : { initialized: false, available: false },
    ollama: { reachable: ollamaReachable },
    message,
  };
}