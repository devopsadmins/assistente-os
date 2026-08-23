/**
 * Detector leve de Prompt Injection — heurísticas de padrão (regex), sem ML.
 *
 * Complementa content-filter.ts (que só cobre vazamento de segredos, nos dois
 * sentidos) com uma camada de entrada: tenta reconhecer tentativas conhecidas
 * de sobrescrever instruções do sistema, extrair o system prompt, ou
 * jailbreak por roleplay. É defesa em profundidade, não uma solução
 * completa — regex não pega ataques novos/ofuscados o suficiente; a decisão
 * de bloquear/avisar/liberar fica com o chamador (ver PROMPT_INJECTION_MODO).
 */

export interface InjectionPattern {
  name: string;
  regex: RegExp;
  severity: "low" | "medium" | "high";
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    name: "IGNORE_PREVIOUS_INSTRUCTIONS",
    regex: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
    severity: "high",
  },
  {
    name: "IGNORE_PREVIOUS_INSTRUCTIONS_PT",
    regex: /ignor[ea]\s+(todas?\s+as\s+|quaisquer\s+)?(instru[çc][õo]es|regras|comandos)(\s+(anteriores|acima|do\s+sistema))?/gi,
    severity: "high",
  },
  {
    name: "DISREGARD_SYSTEM_PROMPT",
    regex: /disregard\s+(the\s+)?(system\s+)?prompt/gi,
    severity: "high",
  },
  {
    name: "REVEAL_SYSTEM_PROMPT",
    regex: /(reveal|show|print|repeat|output)\s+(me\s+)?(your|the)\s+(system\s+prompt|instructions?)/gi,
    severity: "high",
  },
  {
    name: "REVEAL_SYSTEM_PROMPT_PT",
    regex: /(revele|mostre|repita|imprima)\s+(seu|o)\s+(prompt\s+de\s+sistema|instru[çc][õo]es?\s+(iniciais|do\s+sistema))/gi,
    severity: "high",
  },
  {
    name: "ROLEPLAY_JAILBREAK",
    regex: /you\s+are\s+now\s+(DAN|in\s+developer\s+mode|an?\s+unrestricted)/gi,
    severity: "high",
  },
  {
    name: "PRETEND_NO_RULES",
    regex: /pretend\s+(you\s+have\s+)?no\s+(rules|restrictions|guidelines)/gi,
    severity: "medium",
  },
  {
    name: "ACT_AS_JAILBREAK",
    regex: /act\s+as\s+(if\s+you\s+(have\s+no|are\s+not)|an?\s+AI\s+(without|with\s+no))/gi,
    severity: "medium",
  },
  {
    name: "SYSTEM_TAG_INJECTION",
    regex: /\[\s*(system|SYSTEM)\s*\]|<\s*system\s*>/g,
    severity: "medium",
  },
  {
    name: "OVERRIDE_INSTRUCTIONS",
    regex: /(new|updated)\s+instructions?\s*:\s*(ignore|forget|disregard)/gi,
    severity: "high",
  },
  {
    name: "BASE64_SUSPICIOUS_LENGTH",
    // heurística fraca: bloco longo de base64 pode ser payload ofuscado — severidade baixa de propósito.
    regex: /(?:[A-Za-z0-9+/]{4}){50,}={0,2}/g,
    severity: "low",
  },
];

export interface InjectionMatch {
  name: string;
  severity: InjectionPattern["severity"];
  match: string;
}

export interface InjectionDetectionResult {
  detected: boolean;
  matches: InjectionMatch[];
  maxSeverity: "none" | InjectionPattern["severity"];
}

const SEVERITY_RANK: Record<InjectionDetectionResult["maxSeverity"], number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Detecta tentativas conhecidas de prompt injection num texto (não modifica o texto). */
export function detectPromptInjection(
  text: string,
  patterns: InjectionPattern[] = INJECTION_PATTERNS,
): InjectionDetectionResult {
  const matches: InjectionMatch[] = [];
  let maxSeverity: InjectionDetectionResult["maxSeverity"] = "none";

  for (const pattern of patterns) {
    const found = text.match(pattern.regex);
    if (!found) continue;
    for (const match of found) {
      matches.push({ name: pattern.name, severity: pattern.severity, match });
    }
    if (SEVERITY_RANK[pattern.severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = pattern.severity;
    }
  }

  return { detected: matches.length > 0, matches, maxSeverity };
}
