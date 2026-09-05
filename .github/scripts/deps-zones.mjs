import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BACKEND_ZONE = ["core", "daemon", "tools", "memory", "cli", "voice"].map((p) => `packages/${p}`);
const FRONTEND_ZONE = ["packages/ui", "packages/web"];

/** Each rule: (depName) => boolean */
export const FRONTEND_ALLOW = [
  (d) => ["react", "react-dom", "@types/react", "@types/react-dom"].includes(d),
  (d) => d.startsWith("@radix-ui/"),
  (d) => ["tailwindcss", "postcss", "autoprefixer"].includes(d) || d.startsWith("@tailwindcss/"),
  (d) => ["class-variance-authority", "clsx", "tailwind-merge"].includes(d),
  (d) => d === "lucide-react",
  (d) => ["marked", "dompurify", "shiki"].includes(d),
  (d) => d === "@ladle/react",
  (d) => d === "vitest" || d.startsWith("@vitest/") || d.startsWith("@testing-library/") || ["jsdom", "axe-core"].includes(d),
  (d) => d === "typescript",
  (d) => d.startsWith("@assistente-os/"), // workspace-internal packages (packages/web depends on @assistente-os/ui)
  // grandfathered 2026-09-05 (packages/web joined the frontend zone — Vite tooling it already used):
  (d) => d === "vite" || d === "@vitejs/plugin-react" || d === "undici",
];

/** Backend: the grandfathered snapshot (2026-09-01). SPEC-HR5 owns tightening this. */
export const BACKEND_ALLOW = [
  (d) => d.startsWith("node:"),
  (d) => d.startsWith("@langchain/"),
  (d) => d.startsWith("@assistente-os/"), // workspace-internal packages
  (d) =>
    [
      "pg", "playwright-core", "@types/node", "@types/pg", "typescript",
      "azure-devops-node-api", "ioredis", "pino", "pino-pretty", "say", "telegraf",
      "@xenova/transformers", "busboy", "@types/busboy",
      // grandfathered 2026-09-01 (present in the tree when the guard landed):
      "@sentry/node", "adm-zip", "@types/adm-zip", "baileys", "prom-client",
      "qrcode-terminal", "archiver", "@types/archiver",
      // grandfathered 2026-09-01 (root package.json, brought into the backend zone
      // by zone discovery below): graphviz/http-server power the graphify:* scripts.
      "graphviz", "http-server",
      // grandfathered 2026-09-05 (SPEC-EP2 Frente 1 — lint tooling na raiz, mesma
      // categoria de "typescript" acima, não é dependência de runtime):
      "eslint", "typescript-eslint",
      // SPEC-EP2 Frente 2 (2026-09-05): zod pra validação de fronteira (rotas
      // HTTP). Já era dependência transitiva de @langchain/* (langgraph-tools.ts
      // a importava sem declarar) — agora declarada de verdade em vez de contar
      // com hoisting do npm.
      "zod",
    ].includes(d),
];

export function checkPackage(pkgPath, pkgJson, zone) {
  const allow = zone === "frontend" ? FRONTEND_ALLOW : BACKEND_ALLOW;
  const deps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {}),
    ...(pkgJson.peerDependencies ?? {}),
    ...(pkgJson.optionalDependencies ?? {}),
  };
  const violations = [];
  for (const dep of Object.keys(deps)) {
    if (!allow.some((rule) => rule(dep))) violations.push(`${pkgPath} :: ${dep}`);
  }
  return violations;
}

/** Every `packages/*` directory with a package.json must be assigned to a zone. */
export function findUnassignedPackages(root) {
  const assigned = new Set([...BACKEND_ZONE, ...FRONTEND_ZONE]);
  let entries;
  try {
    entries = readdirSync(join(root, "packages"), { withFileTypes: true });
  } catch {
    return []; // no packages/ dir
  }
  const unassigned = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = `packages/${entry.name}`;
    try {
      readFileSync(join(root, pkgPath, "package.json"), "utf8");
    } catch {
      continue; // not a real package (no package.json)
    }
    if (!assigned.has(pkgPath)) {
      unassigned.push(`${pkgPath} :: (unassigned to a dependency zone)`);
    }
  }
  return unassigned;
}

function main() {
  const root = process.cwd();
  const all = [];
  for (const [zone, paths] of [["backend", BACKEND_ZONE], ["frontend", FRONTEND_ZONE]]) {
    for (const p of paths) {
      let json;
      try {
        json = JSON.parse(readFileSync(join(root, p, "package.json"), "utf8"));
      } catch {
        continue; // package not present yet (e.g. packages/web)
      }
      all.push(...checkPackage(p, json, zone));
    }
  }
  // The root package.json (graphify:*, workspace tooling) is assigned to the backend zone.
  try {
    const rootJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    all.push(...checkPackage(".", rootJson, "backend"));
  } catch {
    // no root package.json — shouldn't happen, nothing to check
  }
  all.push(...findUnassignedPackages(root));
  if (all.length) {
    console.error("Dependency zone violations:\n" + all.map((v) => "  " + v).join("\n"));
    console.error("\nFix: move the dep to the right zone, or amend docs/adr/ADR-UI-001.md + FRONTEND_ALLOW.");
    process.exit(1);
  }
  console.log("dependency zones: OK");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
