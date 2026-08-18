import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Binário real do opencode.
 *  - Unix: `opencode` no PATH.
 *  - Windows: o shim `opencode.cmd` do npm encaminha para um .exe; spawnamos o
 *    .exe direto (shell:false) para evitar o mangling de args do cmd.exe.
 */
function resolveOpenCodeBin(): string {
  if (process.platform !== "win32") return "opencode";
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, "npm") : "";
  const candidates = [
    join(npmRoot, "node_modules", "opencode-ai", "bin", "opencode.exe"),
    join(npmRoot, "node_modules", "opencode", "bin", "opencode.exe"),
    join(npmRoot, "node_modules", "@anthropic-ai", "opencode", "bin", "opencode.exe"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "opencode.cmd";
}

export interface OpenCodeRunOptions {
  /** Pasta onde o opencode roda (ex.: dir da soul). */
  cwd: string;
  model?: string;
  /** Segundos máximos de execução. Padrão: 300. */
  timeoutSeconds?: number;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface OpenCodeRunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Executa `opencode run <prompt>` headless com o opencode binário resolvido do PATH.
 * Transmite stdout/stderr em tempo real via callbacks e corta no timeout.
 */
export function runOpenCode(prompt: string, options: OpenCodeRunOptions): Promise<OpenCodeRunResult> {
  const timeoutMs = (options.timeoutSeconds ?? 300) * 1000;
  return new Promise((resolve) => {
    if (!existsSync(options.cwd)) {
      resolve({ code: 1, stdout: "", stderr: `cwd não existe: ${options.cwd}`, timedOut: false });
      return;
    }
    const args = ["run", "--format", "json", "--print-logs"];
    if (options.model) args.push("--model", options.model);
    args.push(prompt);

    let proc: ChildProcess;
    try {
      proc = spawn(resolveOpenCodeBin(), args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err), timedOut: false });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* já morto */
      }
    }, timeoutMs);
    timer.unref?.();

    const done = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    proc.on("error", (err) => {
      stderr += `erro ao iniciar opencode: ${err.message}\n`;
      done(1);
    });

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    proc.on("close", (code) => done(code ?? (timedOut ? 1 : 0)));
  });
}
