# Prompt Garden

Biblioteca versionada dos prompts de **pipeline/tool** do Assistente OS
(`packages/core/src/prompts/garden/`). T2.1 de `docs/ARCHITECTURE-REVIEW.md`;
buracos fechados na Etapa 5 do refino (`docs/ARCHITECTURE-REFINEMENT-REVIEW.md`).

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
| `formatoSaida` | descrição curta da forma da saída (prosa) |
| `outputSchema` | forma **exata** da saída (ex.: o JSON literal). Opcional. Fica fora do `template` p/ não poluir com `{{ }}`; o template referencia `{outputSchema}` e o `render` injeta |
| `versao` | sobe a cada mudança semântica |
| `template` | texto com `{placeholder}` (+ `{outputSchema}`); `{{` / `}}` escapam chaves literais |
| `render(vars)` | substitui os placeholders e **valida** que toda variável referida foi passada |

`definePrompt({...})` monta o `render` a partir do `template` — a regra de
interpolação vive num lugar só.

## Inspeção

`os prompt list` — tabela id / versão / hash (12 chars) de todos os prompts.
`os prompt show <id>` — papel/objetivo/regras/formatoSaida/outputSchema + o
`template` completo + o hash sha256.

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

## Prompts no jardim (9)

`concise-output`, `email-ingest-extraction`, `meeting-ingest-extraction`,
`spec-grill-analyst`, `entity-extraction`, `guardian-audit`, `rag-rerank-scorer`,
`agent-react-system` (system do agente ReAct — `agent-workflow.ts`/`agent-state.ts`),
`rag-answer` (resposta da chain RAG — `prompt-templates.ts` monta o
`ChatPromptTemplate` a partir dele + `RAG_ANSWER_SUFFIXES`).

## Fora de escopo

- Prompts de **soul** (`perfil.md` / `contexto.md` / `soul.md`) — já versionados
  por git e hasheados em `soulSystemPromptHash`.
- A forma-string legada `applyTemplate` / `*Template` em `prompt-templates.ts` —
  compat, já divergente do `ChatPromptTemplate`; as palavras vêm do garden
  (`ragAnswer.papel` + `RAG_ANSWER_SUFFIXES`), só a montagem inline fica local.
