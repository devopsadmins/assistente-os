import { ThreadScreen } from "./screens/ThreadScreen";
import type { ApiClientConfig } from "./api/client";

const config: ApiClientConfig = {
  // Vazio (relativo) no dev normal, onde o proxy do Vite cuida do daemon.
  // O build do shell desktop (packages/desktop) passa VITE_API_BASE_URL
  // explicitamente porque ali não existe proxy — é o Electron falando
  // direto com o daemon pela LAN.
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "",
  token: import.meta.env.VITE_DEV_TOKEN as string,
};

const soulId = import.meta.env.VITE_DEV_SOUL_ID as string;

export function App() {
  if (!config.token || !soulId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-sm text-destructive">
        Configure VITE_DEV_TOKEN e VITE_DEV_SOUL_ID em packages/web/.env.local (veja .env.example).
      </div>
    );
  }
  return <ThreadScreen config={config} soulId={soulId} />;
}
