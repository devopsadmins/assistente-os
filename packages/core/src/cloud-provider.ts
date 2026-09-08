import { nextZenApiKey, type ZenKeySource } from "./zen-keys.js";

export interface CloudProviderSource extends ZenKeySource {
  openRouterApiKey?: string;
  openRouterBaseUrl: string;
  openRouterChatModel: string;
  zenBaseUrl: string;
  zenChatModel: string;
}

export interface CloudProvider {
  name: "openrouter" | "zen";
  baseUrl: string;
  apiKey: string;
  chatModel: string;
}

/**
 * Resolve o provider de LLM cloud para chamadas HTTP diretas (LangGraph
 * `ChatOpenAI` em rag-chain.ts/agent-workflow.ts, guardian/discriminator via
 * fetch em golden-rules.ts). NÃO é usado pelo caminho `opencode run`
 * (runner.ts em packages/daemon), que já satisfaz a exigência de sessão da
 * OpenCode Zen por rodar o binário real do opencode — só as chamadas HTTP
 * diretas (que não passam pelo app opencode) são afetadas pela restrição
 * abaixo.
 *
 * OpenRouter tem precedência sobre Zen quando ambos estão configurados:
 * desde 2026-09-08 a OpenCode Zen passa a rejeitar (HTTP 400
 * MissingSessionID) chamadas de API diretas a modelos "-free" fora do
 * app/CLI opencode. `null` quando nenhum provider cloud está configurado —
 * quem chama cai de volta pro Ollama local.
 */
export function resolveCloudProvider(config: CloudProviderSource): CloudProvider | null {
  if (config.openRouterApiKey) {
    return {
      name: "openrouter",
      baseUrl: config.openRouterBaseUrl,
      apiKey: config.openRouterApiKey,
      chatModel: config.openRouterChatModel,
    };
  }
  const zenKey = nextZenApiKey(config);
  if (zenKey) {
    return { name: "zen", baseUrl: config.zenBaseUrl, apiKey: zenKey, chatModel: config.zenChatModel };
  }
  return null;
}
