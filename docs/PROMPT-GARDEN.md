# Prompt Garden

Biblioteca versionada dos prompts de **pipeline/tool** do Assistente OS
(`packages/core/src/prompts/garden/`). T2.1 de `docs/ARCHITECTURE-REVIEW.md`.

## Por quê

Antes, cada prompt de extração/análise/auditoria era um literal solto no meio do
código do pipeline (`email-ingest.ts`, `meeting-ingest.ts`, `spec-grill.ts`,
`entity-extraction.ts`, `golden-rules.ts`, `rerank.ts`): sem versão, sem forma
padrão, sem entrar no manifesto de execução. "Que prompt rodou nesse release?"
não tinha resposta auditável.

## O contrato

Cada prompt é um `PromptSpec` (`garden/types.ts`):

| Campo | Papel |
|---|---|
| `id` | kebab-case único; também a chave no manifesto |
| `papel` | papel que o modelo assume |
| `objetivo` | o que precisa produzir |
| `regras[]` | restrições duras, uma por item |
| `formatoSaida` | forma exata da saída |
| `versao` | sobe a cada mudança semântica |
| `template` | texto com `{placeholder}`; `{{` / `}}` escapam chaves literais |
| `render(vars)` | substitui os placeholders e **valida** que toda variável referida foi passada |

`definePrompt({...})` monta o `render` a partir do `template` — a regra de
interpolação vive num lugar só.

## No manifesto

`buildExecutionManifest` inclui `prompts: [{ id, versao, hash }]` **dentro do
hash** (`gardenManifest()`). `hash` = sha256 da forma canônica do spec
(`promptCanonical`). Mudar um `template` ou um metadado → muda o hash do prompt →
muda o hash do manifesto. Replay: `git checkout <sha>` + re-run.

## Adicionar / mudar um prompt

1. Novo arquivo `garden/<id>.ts` exportando `export const <camelId> = definePrompt<Vars>({...})`.
2. Registrar em `garden/index.ts` (`export` + entrada no array `GARDEN`).
3. Consumir: `import { <camelId> } from "@assistente-os/core"` e chamar `.render(vars)`.
4. Ao **mudar** um prompt existente, incrementar `versao`.
5. `npm test --workspace @assistente-os/core` cobre interpolação, hash e o manifesto.

## Fora de escopo

- Prompts de **soul** (`perfil.md` / `contexto.md` / `soul.md`) — já versionados
  por git e hasheados em `soulSystemPromptHash`.
- Os `ChatPromptTemplate` do LangChain em
  `packages/memory/src/prompt-templates.ts` (estrutura própria).
- Os system prompts do agente ReAct (`agent-workflow.ts` / `agent-state.ts`) —
  não migrados ainda (arquivo com trabalho em sessão paralela).
