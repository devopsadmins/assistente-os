# ADR-UI-001 — Zona de frontend isenta do STDLIB_FIRST

**Status:** aceito · 2026-09-01
**Relacionado:** SPEC-HR5 (STDLIB_FIRST), spec `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md`

## Contexto

A hard-rule STDLIB_FIRST restringe dependências a `node:*`, `playwright-core`,
`@langchain/*`, `pg`, `zod`. Ela foi escrita para o runtime do daemon, do core e
do agente — código servidor de longa vida. O reposicionamento de produto exige uma
superfície de Up real (React + Tailwind + biblioteca de componentes), que não cabe
nessa allowlist e nem deveria: são preocupações e perfis de risco diferentes.

## Decisão

Duas zonas, cada uma com sua allowlist, verificadas em CI:

- **Zona backend** — `packages/{core,daemon,tools,memory,cli,voice}`. Mantém o
  STDLIB_FIRST **inalterado**. A lista efetiva é o snapshot atual das deps
  (grandfathered); apertá-la é trabalho do SPEC-HR5, fora deste ADR.
- **Zona frontend** — `packages/ui` (e futuros `packages/web`, landing). Allowlist
  própria:
  - `react`, `react-dom`, `@types/react`, `@types/react-dom`
  - `@radix-ui/*`
  - `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/*`
  - `class-variance-authority`, `clsx`, `tailwind-merge`
  - `lucide-react`
  - **um** parser de markdown + **um** sanitizador (`marked`, `dompurify`)
  - **um** highlighter (`shiki`)
  - `@ladle/react`
  - `vitest`, `@vitest/*`, `@testing-library/*`, `jsdom`, `axe-core`
  - `typescript`
  Adicionar item a esta lista = uma linha neste ADR + no array do script.

## Guard

`.github/scripts/deps-zones.mjs` roda em CI (`build-and-test`). Falha se uma
workspace tem dep fora da allowlist da sua zona. `node --test` cobre o script.

## Consequências

- Bundle size da zona de frontend passa a ser métrica vigiada (orçamento entra
  junto do SEO da landing — sub-projeto E).
- Supply-chain cresce: versões **pinadas** (sem `^`) nos `package.json` da zona;
  `npm audit --workspace` na zona de frontend entra no CI num follow-up.
- O texto de SPEC-HR5 / `system_prompt` passa a referenciar o modelo de duas
  zonas (edição feita junto com este ADR).
