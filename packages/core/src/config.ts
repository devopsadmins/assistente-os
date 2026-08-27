import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GlobalGuardrails } from "./types/agent.js";
import { parseZenApiKeys } from "./zen-keys.js";

export interface AssistenteOsConfig {
  /** Raiz de tudo: souls/, config.local.json (padrão: ~/.assistant-os) */
  home: string;
  soulsDir: string;
  /** Diretório dos ZIPs de backup — fora de `home` de propósito, para que a
   * retenção (que apaga arquivos) nunca rode no mesmo diretório dos dados
   * vivos (souls/.env/sessões). Padrão: ~/.assistant-os-backups. */
  backupDir: string;
  /** Connection string do Postgres (env DATABASE_URL). Único banco: agenda/custos/eventos + RAG/grafo. */
  databaseUrl: string;
  ollamaUrl: string;
  ollamaChatModel: string;
  ollamaEmbedModel: string;
  /** OpenCode Zen (https://opencode.ai/zen) — provider cloud OpenAI-compatible,
   * usado como alternativa ao Ollama local quando tool-calling nativo real é
   * necessário (Ollama+modelos pequenos locais não suportam de forma
   * confiável). Sem ZEN_API_KEY configurada, fica undefined e quem consome
   * cai de volta pro Ollama. Alias de `zenApiKeys[0]`. */
  zenApiKey?: string;
  /** Todas as chaves Zen registradas (env ZEN_API_KEYS / ZEN_API_KEY_1..7 /
   * ZEN_API_KEY). Consumidas em round-robin por chamada via `nextZenApiKey()`
   * para espalhar o consumo entre até 7 chaves gratuitas. `[]` quando nenhuma. */
  zenApiKeys: string[];
  zenBaseUrl: string;
  zenChatModel: string;
  /** Modo do reranker de RAG (env RAG_RERANK): "off" | "cross-encoder" | "llm". */
  ragRerankMode: "off" | "cross-encoder" | "llm";
  /** Modo do screening de prompt injection em chunks de RAG (env RAG_INJECTION_MODO
   * → PROMPT_INJECTION_MODO): "aviso" | "recusar". */
  ragInjectionMode: "aviso" | "recusar";
  /** hnsw.ef_search fixado na busca vetorial (env RAG_HNSW_EF_SEARCH, default 40) —
   * reprodutibilidade da recuperação HNSW. */
  ragHnswEfSearch: number;
  /** Ordem do roteador local-first: cada string é um degrau. */
  routerTiers: string[];
  /** Secret compartilhado para verificar webhooks assinados (HMAC-SHA256). */
  webhookSecret?: string;
  /** Limite padrão de turnos por sessão (env ASSISTENTE_OS_MAX_TURNS). */
  defaultMaxTurns: number;
  /** Azure DevOps organization name (e.g., 'sousalimaconsultoria') */
  adoOrg?: string;
  /** Azure DevOps Personal Access Token (PAT) with appropriate scopes */
  adoPat?: string;
  /** Azure DevOps authentication type: 'pat' | 'interactive' | 'azcli' */
  adoAuthType?: 'pat' | 'interactive' | 'azcli';
  /** Habilita o canal WhatsApp via Baileys (env WHATSAPP_ENABLED). */
  whatsappEnabled: boolean;
  /** Soul padrão para mensagens WhatsApp (env WHATSAPP_DEFAULT_SOUL). */
  whatsappDefaultSoul: string;
  /** Mapa JID→soul para WhatsApp (env WHATSAPP_SOUL_MAP, JSON). */
  whatsappSoulMap: Record<string, string>;
  /** Habilita resolução de famílias por telefone no WhatsApp (env WHATSAPP_FAMILIAS_ENABLED). */
  whatsappFamiliasEnabled: boolean;
  /** Guardrails globais (piso de segurança) — nenhuma soul pode ampliá-los. Ver resolveEffectiveGuardrails(). */
  globalGuardrails: GlobalGuardrails;
}

export function resolveHome(): string {
  return process.env.ASSISTENTE_OS_HOME || join(homedir(), ".assistant-os");
}

/** Carrega variáveis de <dir>/.env (formato KEY=value, linhas, # comentários). */
export function loadDotEnv(dir: string): void {
  const p = join(dir, ".env");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Normaliza RAG_RERANK — qualquer valor fora de cross-encoder/llm cai para "off". */
function parseRagRerankMode(raw: string | undefined): "off" | "cross-encoder" | "llm" {
  const v = (raw ?? "off").toLowerCase();
  return v === "cross-encoder" || v === "llm" ? v : "off";
}

export function loadConfig(overrides: Partial<AssistenteOsConfig> = {}): AssistenteOsConfig {
  const home = overrides.home || resolveHome();
  loadDotEnv(home);
  const zenApiKeys = overrides.zenApiKeys ?? parseZenApiKeys(process.env);
  return {
    home,
    soulsDir: overrides.soulsDir || join(home, "souls"),
    backupDir: overrides.backupDir || process.env.ASSISTENTE_OS_BACKUP_DIR || join(homedir(), ".assistant-os-backups"),
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgres://assistente_os:assistente_os@localhost:5432/assistente_os",
    ollamaUrl: overrides.ollamaUrl || process.env.OLLAMA_URL || "http://localhost:11434",
    ollamaChatModel: overrides.ollamaChatModel || process.env.OLLAMA_CHAT_MODEL || "qwen2.5-coder:3b",
    ollamaEmbedModel: overrides.ollamaEmbedModel || process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
    zenApiKeys,
    zenApiKey: overrides.zenApiKey ?? zenApiKeys[0],
    zenBaseUrl: overrides.zenBaseUrl || process.env.ZEN_BASE_URL || "https://opencode.ai/zen/v1",
    zenChatModel: overrides.zenChatModel || process.env.ZEN_CHAT_MODEL || "nemotron-3-ultra-free",
    ragRerankMode: overrides.ragRerankMode ?? parseRagRerankMode(process.env.RAG_RERANK),
    ragInjectionMode:
      overrides.ragInjectionMode ??
      ((process.env.RAG_INJECTION_MODO || process.env.PROMPT_INJECTION_MODO || "aviso").toLowerCase() === "recusar"
        ? "recusar"
        : "aviso"),
    ragHnswEfSearch: overrides.ragHnswEfSearch ?? (Number(process.env.RAG_HNSW_EF_SEARCH) || 40),
    routerTiers: overrides.routerTiers || ["local", "zen", "soul"],
    webhookSecret: overrides.webhookSecret ?? process.env.ASSISTENTE_OS_WEBHOOK_SECRET,
    defaultMaxTurns: overrides.defaultMaxTurns ?? (Number(process.env.ASSISTENTE_OS_MAX_TURNS) || 10),
    adoOrg: overrides.adoOrg ?? process.env.AZURE_DEVOPS_ORG ?? process.env.ADO_ORG,
    adoPat: overrides.adoPat ?? process.env.AZURE_DEVOPS_PAT ?? process.env.ADO_PAT,
    adoAuthType: (overrides.adoAuthType ?? process.env.AZURE_DEVOPS_AUTH_TYPE ?? process.env.ADO_AUTH_TYPE) as 'pat' | 'interactive' | 'azcli' | undefined,
    whatsappEnabled: overrides.whatsappEnabled ?? process.env.WHATSAPP_ENABLED === "true",
    whatsappDefaultSoul: overrides.whatsappDefaultSoul || process.env.WHATSAPP_DEFAULT_SOUL || "main",
    whatsappSoulMap: overrides.whatsappSoulMap ?? (() => {
      try {
        return process.env.WHATSAPP_SOUL_MAP ? JSON.parse(process.env.WHATSAPP_SOUL_MAP) : {};
      } catch {
        return {};
      }
    })(),
    whatsappFamiliasEnabled: overrides.whatsappFamiliasEnabled ?? process.env.WHATSAPP_FAMILIAS_ENABLED === "true",
    globalGuardrails: overrides.globalGuardrails ?? {
      maxTurns: overrides.defaultMaxTurns ?? (Number(process.env.ASSISTENTE_OS_MAX_TURNS) || 10),
      maxIterations: Number(process.env.ASSISTENTE_OS_MAX_ITERATIONS) || 5,
      ragRelevanceThreshold: Number(process.env.ASSISTENTE_OS_RAG_THRESHOLD) || 0.70,
      dailyLimitTokens: process.env.ASSISTENTE_OS_DAILY_LIMIT_TOKENS
        ? Number(process.env.ASSISTENTE_OS_DAILY_LIMIT_TOKENS)
        : undefined,
    },
  };
}
