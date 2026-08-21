/**
 * Filtro de Conteúdo — Sanitização de Secrets em prompts e respostas
 *
 * Detecta e mascara padrões sensíveis (API keys, tokens, passwords, etc.)
 * antes de enviá-los ao LLM ou retorná-los ao usuário.
 *
 * Segue o princípio de defesa em profundidade: mesmo que o MCP server
 * autorize a tool, o conteúdo é sanitizado antes de chegar ao modelo.
 */

import { storeCredential } from "./temp-vault.js";

// ── Padrões de detecção ──────────────────────────────────────────────

export interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

export const DEFAULT_PATTERNS: SecretPattern[] = [
  {
    name: "OPENAI_API_KEY",
    regex: /sk-[A-Za-z0-9]{20,}/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  {
    name: "ANTHROPIC_API_KEY",
    regex: /sk-ant-[A-Za-z0-9\-]{20,}/g,
    replacement: "[REDACTED_ANTHROPIC_KEY]",
  },
  {
    name: "AZURE_DEVOPS_PAT",
    // Exclui sequências puramente hexadecimais de 52 chars (hashes/IDs comuns) —
    // PATs reais têm alfabeto misto (maiúsculas+minúsculas+dígitos).
    regex: /(?![A-Fa-f0-9]{52}(?:[^A-Za-z0-9]|$))[A-Za-z0-9]{52}(?=[^A-Za-z0-9]|$)/g,
    replacement: "[REDACTED_AZURE_PAT]",
  },
  {
    name: "GITHUB_TOKEN",
    regex: /ghp_[A-Za-z0-9]{36}/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    name: "GITHUB_OAUTH",
    regex: /gho_[A-Za-z0-9]{36}/g,
    replacement: "[REDACTED_GITHUB_OAUTH]",
  },
  {
    name: "AWS_ACCESS_KEY",
    regex: /AKIA[A-Z0-9]{16}/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  {
    name: "AWS_SECRET_KEY",
    regex: /(?:aws_secret_access_key|secret_key)['":\s]*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
    replacement: "[REDACTED_AWS_SECRET]",
  },
  {
    name: "PRIVATE_KEY",
    regex: /-----BEGIN(?:\s+RSA)?\s+PRIVATE\s+KEY-----[\s\S]*?-----END(?:\s+RSA)?\s+PRIVATE\s+KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    name: "GENERIC_PASSWORD",
    regex: /(?:password|passwd|pwd|senha|secret)['":\s]*['"]?([^\s'"]{8,})['"]?/gi,
    replacement: "[REDACTED_PASSWORD]",
  },
  {
    name: "GENERIC_TOKEN",
    regex: /(?:token|bearer|authorization)['":\s]*['"]?(Bearer\s+)?(?!ghp_|gho_|sk-|sk-ant-|AKIA)([A-Za-z0-9\-._~+/]+=*)['"]?/gi,
    replacement: "[REDACTED_TOKEN]",
  },
  {
    name: "DATABASE_URL",
    regex: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]+/gi,
    replacement: "[REDACTED_DB_URL]",
  },
  {
    name: "ENV_VAR",
    regex: /(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)['":\s]*['"]?([^\s'"]{16,})['"]?/gi,
    replacement: "[REDACTED_ENV_VAR]",
  },
];

// ── Resultado da sanitização ─────────────────────────────────────────

export interface SanitizeResult {
  sanitized: string;
  detected: Array<{ name: string; original: string; taskId?: string }>;
  count: number;
}

// ── Funções principais ───────────────────────────────────────────────

/**
 * Sanitiza um texto, mascarando padrões sensíveis.
 * Se taskId for fornecido, armazena os valores originais no temp-vault.
 */
export function sanitizeText(
  text: string,
  options?: {
    patterns?: SecretPattern[];
    taskId?: string;
    soulId?: string;
  },
): SanitizeResult {
  const patterns = options?.patterns ?? DEFAULT_PATTERNS;
  const detected: SanitizeResult["detected"] = [];
  let sanitized = text;

  for (const pattern of patterns) {
    const matches = sanitized.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        detected.push({
          name: pattern.name,
          original: match,
          taskId: options?.taskId,
        });
        // Armazena no vault se taskId fornecido
        if (options?.taskId && options?.soulId) {
          try {
            storeCredential(options.taskId, `${pattern.name}:${detected.length}`, match);
          } catch {
            // Vault cheio ou erro — ignora silenciosamente
          }
        }
      }
      sanitized = sanitized.replace(pattern.regex, pattern.replacement);
    }
  }

  return { sanitized, detected, count: detected.length };
}

/**
 * Detecta secrets num texto sem mascarar (apenas detecção).
 */
export function detectSecrets(
  text: string,
  patterns?: SecretPattern[],
): Array<{ name: string; match: string }> {
  const allPatterns = patterns ?? DEFAULT_PATTERNS;
  const results: Array<{ name: string; match: string }> = [];

  for (const pattern of allPatterns) {
    const matches = text.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        results.push({ name: pattern.name, match });
      }
    }
  }

  return results;
}

/**
 * Sanitiza o prompt do usuário antes de enviar ao LLM.
 * Remove headers de autenticação, tokens de API, etc.
 */
export function sanitizeUserPrompt(
  prompt: string,
  options?: { taskId?: string; soulId?: string },
): SanitizeResult {
  return sanitizeText(prompt, options);
}

/**
 * Sanitiza a resposta do LLM antes de retornar ao usuário.
 * Remove qualquer secret que o modelo possa ter "reproduzido" do contexto.
 */
export function sanitizeLLMResponse(
  response: string,
  options?: { taskId?: string; soulId?: string },
): SanitizeResult {
  return sanitizeText(response, options);
}

/**
 * Sanitiza o contexto completo (prompt + system message + response)
 * em uma única passagem.
 */
export function sanitizeFullContext(
  systemMessage: string,
  userPrompt: string,
  response: string,
  options?: { taskId?: string; soulId?: string },
): {
  systemMessage: SanitizeResult;
  userPrompt: SanitizeResult;
  response: SanitizeResult;
  totalDetected: number;
} {
  const sysResult = sanitizeUserPrompt(systemMessage, options);
  const promptResult = sanitizeUserPrompt(userPrompt, options);
  const respResult = sanitizeLLMResponse(response, options);

  return {
    systemMessage: sysResult,
    userPrompt: promptResult,
    response: respResult,
    totalDetected: sysResult.count + promptResult.count + respResult.count,
  };
}
