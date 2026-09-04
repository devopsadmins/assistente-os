# Contribuindo

## Fluxo de trabalho (Pull Request)

A partir de 2026-08-28 (Etapa 2 do refino), **toda mudança entra via Pull
Request** — sem FF-merge direto em `main`.

1. Ramifique de `main`: `git checkout -b <tipo>/<slug>` (`feat/…`, `fix/…`, `docs/…`, `refactor/…`, `ci/…`).
2. Commits pequenos. Mensagem termina com `Co-Authored-By:` quando aplicável.
3. Abra o PR contra `main`. O template (`.github/pull_request_template.md`) tem 3 seções obrigatórias.
4. O CI roda três jobs:
   - **`compliance`** — valida descrição mínima, referência de rastreabilidade
     (`ADR-XXX` / `roadmap` / `Exx` / `Tn.n` / `#issue`), linha `Rollback:` com
     plano real, e — se o PR toca caminho sensível — uma entrada em `CHANGELOG.md`
     ou `docs/adr/` no mesmo PR.
   - **`build-and-test`** — `npm run build` → `typecheck` → `test` + manifesto de execução.
   - **`Discriminator`** (SPEC-GR4) — depois de `build-and-test` passar, julga o
     diff do PR via Guardian (`auditExecution`, score 0-100 ISO/IEC 42001) e
     falha se vier abaixo de 95/100. O parecer (JSON com `score`/`feedback`) sai
     no log do step e como artefato `discriminator-<sha>` — sempre, mesmo
     reprovado. Ver "Rodando o gate Discriminator localmente" abaixo.
5. Todos verdes → merge (squash ou merge commit; não force-push sobre `main`).

### Caminhos sensíveis

Exigem paper trail (`CHANGELOG.md` ou `docs/adr/`) no mesmo PR:
`packages/core/src/{config,policy,migrations,manifest}.ts`,
`packages/core/src/{prompts,governance}/`, `.github/`, `docs/adr/`.
Editar um ADR já é o próprio registro.

## Configuração do repositório (uma vez, pelo owner)

Em **Settings → Branches → Branch protection rules** para `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass — selecione `compliance`, `build-and-test` e `Discriminator`
- ✅ Require branches to be up to date before merging
- (opcional) ✅ Require conversation resolution before merging

Sem isso, os gates rodam mas não **bloqueiam** o merge.

Em **Settings → Secrets and variables → Actions → Repository secrets**, adicione
`ZEN_API_KEY` (chave do OpenCode Zen — o job `Discriminator` roda num runner
sem Ollama local). Sem o secret, o step falha com "Guardian indisponível".

### Rodando o gate Discriminator localmente

```bash
npm run build --workspace=packages/cli
node packages/cli/dist/index.js discriminator --base origin/main
```

- Sem `ZEN_API_KEY` no ambiente, usa o Ollama local (`OLLAMA_URL`, default
  `http://localhost:11434`) — mesma lógica de `rag-chain.ts`/`agent-workflow.ts`.
- `--base <ref>` (default: `origin/main`, ou `origin/$GITHUB_BASE_REF` em PR)
  define contra o que comparar; `--out <path>` grava o JSON do parecer em
  arquivo; `--task-id`/`--target-agent`/`--test-results` sobrescrevem os
  valores inferidos de `git`/env do CI.
- Sai `0` se `score >= 95`, `1` caso contrário — mesmo contrato do job de CI.

## Testes

- `npm test` roda as suítes de todos os workspaces (`node --test`).
- Testes com Postgres usam `createTestSchema()` — schema isolado por teste;
  precisa de `DATABASE_URL` apontando para um Postgres com pgvector.
- Ordem de build: `npm run build` (tsc -b) **antes** de `typecheck`/`test`.
- Os scripts de CI em `.github/scripts/` têm testes próprios (`node --test .github/scripts/*.test.mjs`).

## Convenções

- Toda string visível ao usuário em **PT-BR**.
- `@assistente-os/core` **não** importa de `@assistente-os/memory`.
- Recursos novos que mudam comportamento shipam **desligados por env** até serem medidos (ver `RAG_RERANK`, `RAG_SEMANTIC_CACHE`, `ROUTER_ESCALATION`).
