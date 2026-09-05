# ADR-HR5-001 — Veredito por dependência da zona backend (STDLIB_FIRST)

**Status:** aceito · 2026-09-05
**Relacionado:** SPEC-HR5 (STDLIB_FIRST), ADR-UI-001 (mesma hard-rule, zona frontend)

## Contexto

A hard-rule STDLIB_FIRST original (`system_prompt`, `hard_rules`) restringe
dependências da zona backend (`packages/{core,daemon,tools,memory,cli,voice}`)
a cinco itens: `node:*`, `playwright-core`, `@langchain/*`, `pg`, `zod`. Na
prática, `.github/scripts/deps-zones.mjs` (`BACKEND_ALLOW`) já permite ~22
outras dependências desde 2026-09-01 — "grandfathered" (o guard foi escrito
depois delas já estarem em uso, pra não quebrar CI numa terça-feira
qualquer), mas sem nenhum registro de *por que* cada uma existe ou se
deveria continuar existindo. O SPEC-HR5 fechou o gate de CI de verdade
(2026-09-05) mas deixou esta lacuna explícita: "ADR formal com veredito por
dependência, fora do escopo desta fatia."

Este ADR fecha essa lacuna: cada dependência fora do conjunto original de 5
ganha um veredito (manter/substituir) com razão, verificado lendo o código
real (`grep` de uso, não suposição) em 2026-09-05.

## Decisão

**Nenhuma das 22 dependências investigadas precisa ser substituída.** Todas
sustentam uma feature real e não têm equivalente stdlib viável — a
"violação" do STDLIB_FIRST é real, mas cada uma é uma escolha deliberada,
não acúmulo por descuido. Vereditos abaixo, agrupados por categoria.

### Dependências de runtime — uma feature real depende de cada uma

| Dependência | Usada em | Propósito | Veredito |
|---|---|---|---|
| `azure-devops-node-api` | `packages/core` | Cliente REST do Azure DevOps — tools `ado_*` (work items, PRs, pipelines) | **Manter.** Sem equivalente stdlib; é o SDK oficial da própria API que a feature integra. |
| `ioredis` | `core`, `daemon`, `tools`, `memory`, `cli`, `voice` | Cliente Redis — cache semântico (`RAG_SEMANTIC_CACHE`) e infraestrutura compartilhada entre pacotes | **Manter.** Reimplementar um cliente Redis em stdlib não faz sentido; é um protocolo binário com semântica própria. |
| `pino` + `pino-pretty` | `packages/core` (logger usado em todo o monorepo) | Logging estruturado (JSON em produção, formatado em dev) | **Manter.** `console.log` não dá JSON estruturado nem níveis; pino é minúsculo (poucas deps transitivas) e é o logger de fato de todo o daemon — trocar agora é um refactor sem ganho de segurança. |
| `say` | `packages/voice` (`tts.ts`) | Text-to-speech via engine nativa do SO | **Manter.** Não existe TTS em stdlib do Node. |
| `telegraf` | `packages/daemon` (canal Telegram) | Framework de bot do Telegram | **Manter.** Reimplementar o protocolo de bot do Telegram em cima de `node:https` cru é retrabalho sem benefício — `telegraf` é a lib de referência do ecossistema. |
| `@xenova/transformers` | `packages/memory` (embedder local) | Roda modelos de embedding localmente (RAG sem depender de API externa) | **Manter.** É o motivo de existir do embedder local — sem ela, RAG local vira uma feature morta. |
| `busboy` | `packages/daemon` (`upload.ts`) | Parser de multipart/form-data (upload de arquivos) | **Manter.** `node:http` não faz parsing de multipart; é um parser pequeno e focado, sem alternativa stdlib razoável. |
| `@sentry/node` | `packages/daemon` | Captura de erro/observabilidade em produção | **Manter.** Substituir por logging próprio perderia agregação, contexto de request e alertas — é infraestrutura de operação, não conveniência. |
| `adm-zip` | `packages/daemon` (`upload.ts` — extrai .zip enviado) | Leitura/extração de arquivos ZIP | **Manter.** `node:zlib` não lê o formato de container ZIP (só compressão bruta); precisa de uma lib que entenda o formato de arquivo. |
| `archiver` | `packages/cli` (`backup.ts` — cria o ZIP de backup) | Criação de ZIP via stream | **Manter.** Mesma razão de `adm-zip` — direção oposta (escrita vs. leitura). **Nota**: ter duas libs de ZIP (uma só lê, uma só escreve) parece redundante à primeira vista, mas resolvem problemas diferentes (extrair upload vs. gerar backup grande via stream sem carregar tudo em memória); não há sobreposição de código, não há necessidade de consolidar. |
| `baileys` | `packages/daemon` (canal WhatsApp) | Cliente WhatsApp Web (protocolo não-oficial, engenharia reversa) | **Manter, com ressalva registrada.** É a única forma prática de falar com WhatsApp sem custar por mensagem (API oficial da Meta); superfície de risco maior que as outras (protocolo não documentado oficialmente, lib grande) — aceitável porque é o backbone de uma feature de produto real, não incidental. Se o canal WhatsApp for descontinuado, esta é a primeira dependência a sair. |
| `prom-client` | `packages/daemon` (`observability/metrics.ts`) | Métricas Prometheus | **Manter.** Formato de métrica Prometheus é um protocolo de texto específico; a lib oficial do ecossistema é a escolha óbvia. |
| `qrcode-terminal` | `packages/daemon` (pareamento do canal WhatsApp via Baileys) | Renderiza QR code no terminal | **Manter.** Acoplado ao fluxo de pareamento do `baileys` — sai junto se `baileys` sair. |

### Dependências de tipo (`@types/*`) — zero footprint de runtime

`@types/node`, `@types/pg`, `@types/busboy`, `@types/adm-zip`,
`@types/archiver` — **Manter, sem análise individual.** São declarações de
tipo puras, compiladas fora e nunca embarcadas no bundle/execução; o
STDLIB_FIRST é sobre superfície de ataque em produção, e isso é zero. Tratar
cada uma como se fosse uma dependência de runtime seria burocracia sem
sinal de risco.

### Ferramental de build/lint/dev — nunca roda em produção

`typescript`, `eslint`, `typescript-eslint` (compilação e lint, todo o
monorepo) e `graphviz`, `http-server` (scripts `graphify:*` na raiz, geram e
servem um grafo de dependências localmente) — **Manter, sem análise
individual.** Mesma lógica das `@types/*`: nunca rodam no processo do
daemon/agente em produção. `eslint`/`typescript-eslint` foram adicionados
pelo próprio SPEC-EP2 Frente 1 nesta mesma leva de trabalho.

## Ação sobre a hard-rule original

O `hard_rules`/`system_prompt` que define STDLIB_FIRST como "apenas 5 itens"
está desatualizado desde 2026-09-01 (quando o "grandfathering" aconteceu) e
segue assim — **decisão deliberada, não descuido**: manter o texto original
da hard-rule como o *objetivo* (novo código deveria preferir estas 5 opções
antes de trazer algo novo), e este ADR como o *registro do estado real*
aceito. Duplicar a lista de 22 itens dentro do `system_prompt` criaria uma
segunda fonte de verdade que divergiria de `deps-zones.mjs` de novo na
próxima dependência nova — o guard de CI (`.github/scripts/deps-zones.mjs`,
já rodando desde o SPEC-HR5) é a fonte de verdade executável; este ADR é a
justificativa de por que ela tem o formato que tem.

## Critério pra próxima dependência nova

Antes de adicionar qualquer dependência nova à zona backend: (1) existe em
`node:*`, `@langchain/*`, `pg` ou `zod`? Use isso. (2) Não existe — a feature
é real e vale o custo? Documente o veredito aqui, no mesmo padrão da tabela
acima, no mesmo PR que adiciona a linha em `BACKEND_ALLOW`. Sem as duas
coisas juntas, o gate de CI barra a dependência de qualquer forma.
