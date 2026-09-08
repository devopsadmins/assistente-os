import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCloudProvider } from "../cloud-provider.js";
import { __resetZenRotation } from "../zen-keys.js";

const base = { openRouterBaseUrl: "https://openrouter.ai/api/v1", openRouterChatModel: "modelo-or", zenBaseUrl: "https://opencode.ai/zen/v1", zenChatModel: "modelo-zen" };

test("resolveCloudProvider: OpenRouter tem precedência sobre Zen quando ambos configurados", () => {
  const provider = resolveCloudProvider({
    ...base,
    openRouterApiKey: "or-key",
    zenApiKeys: ["zen-key"],
    zenApiKey: "zen-key",
  });
  assert.deepEqual(provider, { name: "openrouter", baseUrl: base.openRouterBaseUrl, apiKey: "or-key", chatModel: base.openRouterChatModel });
});

test("resolveCloudProvider: cai pro Zen quando só Zen está configurado", () => {
  __resetZenRotation();
  const provider = resolveCloudProvider({ ...base, zenApiKeys: ["zen-key"], zenApiKey: "zen-key" });
  assert.deepEqual(provider, { name: "zen", baseUrl: base.zenBaseUrl, apiKey: "zen-key", chatModel: base.zenChatModel });
});

test("resolveCloudProvider: null quando nenhum provider cloud está configurado (caller cai pro Ollama)", () => {
  const provider = resolveCloudProvider({ ...base, zenApiKeys: [], zenApiKey: undefined });
  assert.equal(provider, null);
});

test("resolveCloudProvider: sem OpenRouter, respeita o rodízio round-robin do Zen", () => {
  __resetZenRotation();
  const cfg = { ...base, zenApiKeys: ["a", "b"], zenApiKey: "a" };
  const first = resolveCloudProvider(cfg);
  const second = resolveCloudProvider(cfg);
  assert.equal(first?.apiKey, "a");
  assert.equal(second?.apiKey, "b");
});
