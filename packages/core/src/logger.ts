import pino from "pino";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Logger global padrão, exibindo no console de forma bonita até ser configurado para gravar em arquivo.
 */
export let logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  },
});

/**
 * Inicializa o logger para também salvar em arquivos locais no diretório home.
 * Re-exporta a instância para que todo o sistema a utilize.
 */
export function initLogger(homeDir: string): void {
  const logDir = join(homeDir, "logs");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const transport = pino.transport({
    targets: [
      {
        level: "info",
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
      {
        level: "info",
        target: "pino/file",
        options: { destination: join(logDir, "daemon.log"), append: true },
      },
      {
        level: "error",
        target: "pino/file",
        options: { destination: join(logDir, "error.log"), append: true },
      },
    ],
  });

  logger = pino({ level: process.env.LOG_LEVEL || "info" }, transport);
}
