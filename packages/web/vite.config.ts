import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const daemonUrl = env.VITE_DAEMON_URL || "http://localhost:4310";
  return {
    // Relativo pra funcionar carregado via file:// (shell desktop em
    // packages/desktop); não afeta o dev server, que ignora base para
    // servir os próprios assets.
    base: "./",
    plugins: [react()],
    server: {
      proxy: {
        "/souls": { target: daemonUrl, changeOrigin: true },
      },
    },
  };
});
