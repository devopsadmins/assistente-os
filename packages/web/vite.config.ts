import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const daemonUrl = env.VITE_DAEMON_URL || "http://localhost:4310";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/souls": { target: daemonUrl, changeOrigin: true },
      },
    },
  };
});
