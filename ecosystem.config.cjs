module.exports = {
  apps: [
    {
      name: "assistente-os",
      script: "packages/cli/dist/index.js",
      // __dirname (não um path fixo) — portável entre Windows/Linux/máquinas.
      cwd: __dirname,
      interpreter: "node",
      // Sem overrides aqui de propósito: AOS_HOST/VOICE_ENABLED/etc. vêm do
      // .env de cada máquina (~/.assistant-os/.env), que loadDotEnv() já lê.
      // Um valor fixo aqui sobrescreveria o .env (PM2 injeta env antes do
      // processo rodar) e reverteria silenciosamente a cada `pm2 restart`.
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      args: "daemon",
      out_file: "logs/daemon-out.log",
      error_file: "logs/daemon-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      // Aguarda processo liberar porta antes de reiniciar
      kill_timeout: 5000,
      // Delay antes de reiniciar para evitar EADDRINUSE em cascata
      restart_delay: 3000,
      // Nao reiniciar se crashar mais de 10x em 60s (evita loop infinito)
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
