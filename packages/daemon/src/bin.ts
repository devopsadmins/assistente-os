#!/usr/bin/env node
import { startDaemon } from "./index.js";
import { loadConfig, initLogger, logger } from "@assistente-os/core";

const config = loadConfig();
initLogger(config.home);

const port = Number(process.env.AOS_PORT ?? 4310);
const host = process.env.AOS_HOST ?? "127.0.0.1";
const daemon = await startDaemon({ 
  port, 
  host, 
  home: config.home, 
  token: process.env.ASSISTENTE_OS_DAEMON_TOKEN,
  voiceEnabled: process.env.VOICE_ENABLED === "true",
  whatsappEnabled: process.env.WHATSAPP_ENABLED === "true",
});

logger.info(`[assistente-os] daemon ouvindo em http://${host}:${daemon.port} (home: ${config.home})`);
logger.info(`[assistente-os] degraus: ${config.routerTiers.join(" -> ")}`);
