import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Spike: casca Electron pura em cima do SPA existente em packages/web.
// Nenhuma lógica nova aqui — só decide se abre o dev server do Vite ou o
// build estático, conforme app.isPackaged. Ver plano em
// name-assistente-os-lioncorp-inspiracao-gentle-milner.md.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NODE_ENV nunca é setado por quem dá duplo-clique no .exe empacotado —
// checar isso fazia o app empacotado sempre cair no ramo de dev (por isso
// a tela branca: tentava carregar http://localhost:5173, que não existe
// na máquina de quem instalou). app.isPackaged é o sinal correto: o
// electron-packager renomeia o binário, e é essa renomeação que o
// Electron usa internamente pra saber que não é mais um "electron" cru.
const isDev = !app.isPackaged;
const devServerUrl = process.env.DESKTOP_DEV_SERVER_URL || "http://localhost:5173";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

// O build do Vite usa <script type="module">, e o Chromium recusa
// executar módulos ES carregados via file:// (bloqueio de CORS em imports
// de módulo) — a janela abria com o menu mas ficava em branco. Por isso
// servimos ./app por um servidor HTTP local em vez de win.loadFile().
function serveStaticDir(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const resolved = path.normalize(path.join(rootDir, urlPath));
      const filePath = resolved.startsWith(rootDir) && urlPath !== "/"
        ? resolved
        : path.join(rootDir, "index.html");

      fs.readFile(filePath, (err, data) => {
        const finalPath = err ? path.join(rootDir, "index.html") : filePath;
        fs.readFile(finalPath, (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            res.end();
            return;
          }
          const ext = path.extname(finalPath);
          res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
          res.end(data2);
        });
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let staticServer;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "terrasIA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Uso pessoal, LAN só do Everton: o build empacotado fala direto
      // (fetch) com o daemon num IP fixo da rede local, e o daemon não
      // manda cabeçalho CORS nenhum. Desligar webSecurity aqui evita
      // mexer no daemon compartilhado (que também atende WhatsApp/
      // Telegram) só por causa dessa casca desktop. Não fazer isso se
      // algum dia isso deixar de ser uso pessoal.
      webSecurity: isDev,
    },
  });

  if (isDev) {
    win.loadURL(devServerUrl);
  } else {
    // App empacotado (npm run package:win): index.html + assets vêm de
    // ./app, uma cópia local de packages/web/dist-desktop feita pelo
    // script scripts/copy-web-dist.mjs — não referenciamos o monorepo
    // (../web/dist) porque o packager só empacota esta pasta.
    staticServer = await serveStaticDir(path.join(__dirname, "app"));
    const { port } = staticServer.address();
    win.loadURL(`http://127.0.0.1:${port}/`);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  staticServer?.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
