// SPEC-EP2 Frente 1 (2026-09-05): política de lint contra `any`. Escopo
// deliberadamente mínimo — só `no-explicit-any` como erro, sem puxar o
// ruleset "recommended" do typescript-eslint inteiro (que dispararia
// centenas de achados não relacionados a este item de backlog). Regras
// type-aware (`no-unsafe-*`, que exigem parserOptions.project) ficam para
// uma iteração futura, se decidido — aqui é só a política sintática.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/worktrees/**",
      ".claude/**",
      "graphify-out/**",
    ],
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    // Testes ficam de fora: mocks/fixtures usam `any` com frequência
    // legítima (ex: espiar retorno de fetch, montar objeto parcial de
    // request) e o alvo real do item de backlog é código de produção.
    ignores: ["**/test/**", "**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
