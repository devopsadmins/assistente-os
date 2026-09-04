import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FakeDaemonHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>;

export interface FakeDaemon {
  url: string;
  close: () => Promise<void>;
}

export function startFakeDaemon(handler: FakeDaemonHandler): Promise<FakeDaemon> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void handler(req, res, Buffer.concat(chunks).toString("utf8"));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
