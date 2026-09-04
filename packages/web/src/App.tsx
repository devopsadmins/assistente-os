import { ThreadScreen } from "./screens/ThreadScreen";
import type { ApiClientConfig } from "./api/client";

const config: ApiClientConfig = {
  baseUrl: "",
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
