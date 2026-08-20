import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AssistenteOsConfig {
  /** Raiz de tudo: souls/, config.local.json (padrão: ~/.assistant-os) */
  home: string;
  soulsDir: string;
  /** Connection string do Postgres (env DATABASE_URL). Único banco: agenda/custos/eventos + RAG/grafo. */
  databaseUrl: string;
  ollamaUrl: string;
  ollamaChatModel: string;
  ollamaEmbedModel: string;
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

export function loadConfig(overrides: Partial<AssistenteOsConfig> = {}): AssistenteOsConfig {
  const home = overrides.home || resolveHome();
  loadDotEnv(home);
  return {
    home,
    soulsDir: overrides.soulsDir || join(home, "souls"),
    databaseUrl:
      overrides.databaseUrl ||
      process.env.DATABASE_URL ||
      "postgres://assistente_os:assistente_os@localhost:5432/assistente_os",
    ollamaUrl: overrides.ollamaUrl || process.env.OLLAMA_URL || "http://localhost:11434",
    ollamaChatModel: overrides.ollamaChatModel || process.env.OLLAMA_CHAT_MODEL || "qwen2.5-coder:3b",
    ollamaEmbedModel: overrides.ollamaEmbedModel || process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
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
  };
}
