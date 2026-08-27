/**
 * Terminal Sanitizer & Minimizer — Camada intermediária para interceptar
 * saídas de comandos shell e reduzir desperdício de tokens no contexto.
 *
 * Trunca saídas longas de comandos conhecidos (npm test, git status, ls -la),
 * mantendo apenas erros, resumo de asserções e contagem de arquivos.
 */

export interface SanitizerRule {
  commandPattern: RegExp;
  maxLines?: number;
  keepPatterns: RegExp[];
  discardPatterns: RegExp[];
  summaryExtractor?: (output: string) => string;
}

export interface SanitizedOutput {
  original: string;
  sanitized: string;
  truncated: boolean;
  keptLines: number;
  discardedLines: number;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

const DEFAULT_RULES: SanitizerRule[] = [
  {
    commandPattern: /^npm\s+(test|run\s+test)/,
    maxLines: 30,
    keepPatterns: [
      /✓|✕|pass|fail|assertion/i,
      /Test Suites:/i,
      /Tests:/i,
      /passed|failed|skipped/i,
      /coverage/i,
      /PASS|FAIL/i,
      /error|Error|FAILURE/i,
      /^\s*at\s+\S+\.\w+:/, // stack traces: "    at file.js:10"
    ],
    discardPatterns: [
      /^>/,
      /^\s*$/,
      /^PASS\s+/,
      /^FAIL\s+/,
      /^\s*●\s/,
      /^npm\s+(WARN|notice)/i,
    ],
    summaryExtractor: (output) => {
      const lines = output.split("\n");
      const summary = lines.filter((l) =>
        /Test Suites:|Tests:|passed|failed|skipped|coverage/i.test(l),
      ).join("\n");
      return summary || "Testes executados (sem resumo detectado)";
    },
  },
  {
    commandPattern: /^git\s+status/,
    maxLines: 10,
    keepPatterns: [
      /modified:/i,
      /new file:/i,
      /deleted:/i,
      /renamed:/i,
      /Untracked files:/i,
      /Changes to be committed:/i,
      /Changes not staged for commit:/i,
    ],
    discardPatterns: [
      /^#/,
      /^$/,
      /^On branch /i,
      /^Your branch is /i,
      /^nothing to commit/i,
    ],
  },
  {
    commandPattern: /^ls\s+(-la|-l)/,
    maxLines: 10,
    keepPatterns: [
      /^total\s+\d+/i,
      /\.(md|ts|js|json|yml|yaml)$/i,
      /^\..*rc$/,
      /^\..*ignore$/,
    ],
    discardPatterns: [/\s\.\.?$/, /\.\.$/, /\s\.$/],
  },
  {
    commandPattern: /^git\s+log\s+--oneline/,
    maxLines: 20,
    keepPatterns: [/^[a-f0-9]{7,}/],
    discardPatterns: [],
  },
  {
    commandPattern: /^npm\s+(install|ci)/,
    maxLines: 20,
    keepPatterns: [
      /added|removed|changed|fund|audit|vulnerab/i,
      /npm\s+(ERR|WARN)/i,
    ],
    discardPatterns: [/^>/, /^npm\s+notice/i],
  },
];

export class TerminalSanitizer {
  private rules: SanitizerRule[];

  constructor(customRules?: SanitizerRule[]) {
    this.rules = [...(customRules ?? []), ...DEFAULT_RULES];
  }

  addRule(rule: SanitizerRule): void {
    this.rules.unshift(rule);
  }

  sanitize(command: string, stdout: string, stderr: string = ""): SanitizedOutput {
    // Strip ANSI first on both stdout and stderr separately
    const cleanStdout = stripAnsi(stdout);
    const cleanStderr = stripAnsi(stderr);
    const fullOutput = cleanStdout + (cleanStderr ? "\n" + cleanStderr : "");

    // Encontra regra correspondente
    const rule = this.rules.find((r) => r.commandPattern.test(command.trim()));
    if (!rule) {
      return {
        original: stdout + (stderr ? "\n" + stderr : ""),
        sanitized: fullOutput,
        truncated: false,
        keptLines: fullOutput.split("\n").length,
        discardedLines: 0,
      };
    }

    const lines = fullOutput.split("\n");
    const maxLines = rule.maxLines ?? 50;
    const kept: string[] = [];
    let discarded = 0;

    for (const line of lines) {
      // Ignora linhas completamente vazias
      if (line.trim().length === 0) {
        discarded++;
        continue;
      }
      const isKeep = rule.keepPatterns.some((p) => p.test(line));
      const isDiscard = rule.discardPatterns.some((p) => p.test(line));

      if (isKeep) {
        kept.push(line);
      } else if (isDiscard) {
        discarded++;
      } else if (kept.length < maxLines) {
        kept.push(line);
      } else {
        discarded++;
      }
    }

    let sanitized = kept.join("\n");
    if (discarded > 0 && kept.length > 0) {
      sanitized += `\n... [${discarded} linhas omitidas]`;
    } else if (kept.length === 0) {
      sanitized = "";
    }

    // Adiciona resumo customizado se houver E se houver conteúdo real
    if (rule.summaryExtractor && fullOutput.trim().length > 0 && kept.length > 0) {
      const summary = rule.summaryExtractor(fullOutput);
      if (summary && !sanitized.includes(summary)) {
        sanitized = `${summary}\n${sanitized}`;
      }
    }

    return {
      original: stdout + (stderr ? "\n" + stderr : ""),
      sanitized,
      truncated: discarded > 0 && kept.length > 0,
      keptLines: kept.length,
      discardedLines: discarded,
    };
  }
}

export const defaultSanitizer = new TerminalSanitizer();

/**
 * Wrapper conveniente para sanitizar saída de comando executado.
 * Uso: const sanitized = sanitizeCommandOutput("npm test", result.stdout, result.stderr);
 */
export function sanitizeCommandOutput(command: string, stdout: string, stderr?: string): SanitizedOutput {
  return defaultSanitizer.sanitize(command, stdout, stderr ?? "");
}