# Contribuindo

## Fluxo de trabalho (Pull Request)

A partir de 2026-08-28 (Etapa 2 do refino), **toda mudança entra via Pull
Request** — sem FF-merge direto em `main`.

**A partir de 2026-09-06, `dev` é o branch de integração.** `main` só recebe
promoções vindas de `dev` (um PR `dev`→`main`), depois de CI verde e uma
passada de homologação. Isso não é bloqueado tecnicamente pelo GitHub neste
repositório (ver "Configuração do repositório" abaixo) — é convenção, siga
mesmo assim.

1. Ramifique de `dev`: `git checkout -b <tipo>/<slug>` (`feat/…`, `fix/…`, `docs/…`, `refactor/…`, `ci/…`).
2. Commits pequenos. Mensagem termina com `Co-Authored-By:` quando aplicável.
3. Abra o PR contra `dev` (nunca direto contra `main`). O template (`.github/pull_request_template.md`) tem 3 seções obrigatórias.
4. O CI roda dois jobs (em push pra `dev`/`main` e em todo PR):
   - **`compliance`** — valida descrição mínima, referência de rastreabilidade
     (`ADR-XXX` / `roadmap` / `Exx` / `Tn.n` / `#issue`), linha `Rollback:` com
     plano real, e — se o PR toca caminho sensível — uma entrada em `CHANGELOG.md`
     ou `docs/adr/` no mesmo PR.
   - **`build-and-test`** — `npm run build` → `typecheck` → `test` + manifesto de execução.

   > O job **`Discriminator`** (SPEC-GR4 — Guardian/LLM pontuando o diff do PR e
   > reprovando abaixo de 95/100) foi **removido do CI em 2026-09-06**: nenhum PR
   > depende mais de chamada de IA. O gate segue disponível sob demanda,
   > localmente — ver "Rodando o gate Discriminator localmente" abaixo.
5. Todos verdes → merge em `dev` (squash ou merge commit; não force-push).
6. Promoção pra produção: PR `dev`→`main`, depois que o conjunto acumulado em
   `dev` passou por testes + homologação manual.

### Caminhos sensíveis

Exigem paper trail (`CHANGELOG.md` ou `docs/adr/`) no mesmo PR:
`packages/core/src/{config,policy,migrations,manifest}.ts`,
`packages/core/src/{prompts,governance}/`, `.github/`, `docs/adr/`.
Editar um ADR já é o próprio registro.

## Configuração do repositório (uma vez, pelo owner)

**Este repositório é privado no plano GitHub Free** (`devopsadmins`) —
branch protection clássica e rulesets retornam 403 ("Upgrade to GitHub Pro")
nesse plano, tanto pela UI quanto pela API. Ou seja: hoje **não tem como
bloquear tecnicamente** um push direto em `main` ou exigir status check
antes do merge — os gates de CI rodam e reportam, mas não impedem nada por
conta própria. O fluxo `dev`→`main` (acima) é mantido só por convenção
enquanto isso não muda.

Se/quando fizer sentido pagar pelo GitHub Pro (ou tornar o repo público),
em **Settings → Branches → Branch protection rules** para `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass — selecione `compliance` e `build-and-test`
- ✅ Require branches to be up to date before merging
- (opcional) ✅ Require conversation resolution before merging

### Rodando o gate Discriminator localmente

Opcional — não é mais exigido em nenhum PR; use quando quiser um parecer da IA
sobre um diff antes de abrir/mergear.

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
