// Copia packages/web/dist-desktop pra packages/desktop/app, autocontido
// pra o electron-packager empacotar (ele só enxerga esta pasta, não o
// monorepo inteiro). Rodado por "npm run package:win".
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "..", "..", "web", "dist-desktop");
const dest = path.join(__dirname, "..", "app");

if (!existsSync(src)) {
  console.error(`Não achei ${src} — rode "npm run build:web" antes.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`Copiado ${src} -> ${dest}`);
