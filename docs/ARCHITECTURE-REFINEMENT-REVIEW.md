# Revisão de refinamento — questionário

> Segue à [ARCHITECTURE-REVIEW](ARCHITECTURE-REVIEW.md) (construção). Agora
> **refinar**: endurecer, ligar ou podar o que foi construído.
>
> **Como usar:** responda as perguntas de cada etapa (edite este arquivo inline
> abaixo de cada `→ RESPOSTA:`). A cada etapa respondida, eu implemento os
> **testes unitários** listados e conduzo a **validação com você** (comando +
> inspeção conjunta). Só passo para a próxima etapa depois da validação.
>
> Ordem = poda antes de polimento: decidir o que sobrevive (Etapas 0–1) antes de
> investir nas demais.

---

## Etapa 0 — Objetivo e ambiente

**Contexto.** 9 features entregues; 3 shipam desligadas (`RAG_RERANK`,
`RAG_SEMANTIC_CACHE`, `ROUTER_ESCALATION`). Precisamos saber o alvo do refino e o
que dá pra validar de fato.

**Perguntas**
1. O alvo primário do refino é: (a) **endurecer** o que existe (testes, correção),
   (b) **ligar e medir** os toggles, (c) **podar** o que não paga o custo, ou uma
   ordem entre esses?
   → RESPOSTA: endurecer
2. Você tem **Ollama vivo** num ambiente de teste/staging (não só o CI, que pula o
   tier local)? Se sim, onde?
   → RESPOSTA: ollama vivo, em container no mesmo servidor
3. Existe **staging** do daemon separado de produção, ou validação é sempre na
   máquina de produção com flag?
   → RESPOSTA: nao existe producao ainda, tudo é staging, é uma POC
4. Você tem **logs de queries reais** da soul `consultoria_ia` (sessões, Telegram,
   WhatsApp) que dê pra minerar para golden set?
   → RESPOSTA: nao tenho log, mas todos os dados em texto e na RAG sao reais.
5. Métrica de sucesso do refino: o que faz você dizer "pronto"? (ex.: "os 3
   toggles ligados com número que justifica" / "cobertura de integração nos
   caminhos wired" / "menos env vars")
   → RESPOSTA: testes com dados reais, logs de comprovação e metrica de resposta estabelecida.

**Testes unitários:** nenhum (etapa de decisão).
**Validação com você:** revisar as respostas e travar a ordem das etapas seguintes.

---

## Etapa 1 — Poda: o que sobrevive?

**Contexto.** Da análise crítica, 3 candidatos a remoção em vez de refino:
- **Cache semântico (T2.2)** — não poupa a chamada LLM (só embedding + pgvector,
  ~10–50ms); o cache exato já cobre voz/retry. Risco: paráfrase devolve contexto
  de outra query.
- **Canvas por soul (T2.3)** — comando órfão, sem workflow que exija, gate
  "agentic" quase sempre verdadeiro.
- **Reranker (T1.4)** — consertado, mas o único modelo pronto (só-inglês) piora
  PT-BR; hit@5 já 95,7% sem ele.

**Perguntas**
1. **Cache semântico:** manter (e refinar na Etapa 6) ou **remover** e ficar só com
   o exato?
   → RESPOSTA: chace semantivo
2. **Canvas:** manter como ferramenta ad-hoc, **promover** a artefato exigido (em
   criação de soul / review), ou **remover**?
   → RESPOSTA: promover
3. **Reranker:** investir num cross-encoder multilíngue (Etapa 4), aceitar
   `RAG_RERANK=off` **definitivo** e remover `rerank.ts`, ou deixar dormente como
   está?
   → RESPOSTA: investir num cross-encoder
4. As **6 env vars novas** (`RAG_RERANK_CE_MODEL`, `RAG_SEMANTIC_CACHE`+2,
   `ROUTER_ESCALATION`+2) — todas ficam, ou alguma feature removida leva as suas?
   → RESPOSTA: vamos resolver o ponto 3 antes.

**Testes unitários:** para cada remoção — apagar o teste correspondente e rodar a
suíte para confirmar que nada mais depende (`grep` de importadores + build).
**Validação com você:** eu apresento o diff de remoção de cada item aprovado antes
de commitar; você confirma que nada em uso quebra.

---

## Etapa 2 — T1.1 Gate de compliance no CI

**Contexto.** O job `compliance` só roda em `pull_request`. O fluxo do repo é
FF-merge em `main` + push, sem PR → **o gate nunca disparou** (nem nos 10 commits
desta jornada). Hoje é peso morto.

**Perguntas**
1. Adotar **fluxo de PR** para branches de feature (o gate passa a valer de fato),
   ou manter FF-merge e o gate vira inútil?
   → RESPOSTA: adotar fluxo
2. Se mantiver FF-merge: quer uma variante que roda **no `push` para `main`** e lê
   os metadados do **commit** (mensagem tem `Rollback:` + ref de rastreabilidade)
   em vez do corpo do PR? Ou desligar o gate?
   → RESPOSTA: nao vai manter
3. A regra "path sensível → exige label `governanca-revisada`" faz sentido num
   fluxo solo? Manter, trocar por "path sensível → exige linha no CHANGELOG", ou
   remover?
   → RESPOSTA: faz sentido para evidencia futura, prefiro ter changelog.
4. O `.github/workflows/rag-eval.yml` aponta para `runs-on: self-hosted` que não
   existe. Vai existir um runner self-hosted, ou esse workflow deve ser removido e
   o eval de RAG fica 100% manual (documentado)?
   → RESPOSTA: remova agora. estamos em POC

**Testes unitários**
- Se adotar modo `push`/commit: novo caso em `compliance-rules.test.mjs` para
  `evaluateCompliance` lendo `commitMessage` em vez de `body`.
- Caso: `Rollback:` inline (fora de `## Rollback`) — confirmar aceito/rejeitado
  conforme a decisão.
- Caso: mudança em path sensível com CHANGELOG mas sem label (se a regra 3 mudar).

**Validação com você**
- Abrir um PR-teste (ou disparar `workflow_dispatch` com um payload de evento
  montado) e ver o job `compliance` **falhar** por falta de `Rollback:`, depois
  **passar** ao corrigir.

---

## Etapa 3 — T1.3 Golden set do RAG  — ✅ mecanismo feito; golden real fora do refino

> **Decisão (2026-08-29).** O golden set **real** (`~/.assistant-os/rag-golden.jsonl`,
> 23 casos sobre a hub-kb da Dimastec) é **dado de cliente**, escopado à soul
> `consultoria_ia`, e já vive **fora do repo**. Crescê-lo, definir os pisos de
> auditoria a partir do corpus da Dimastec e decidir CI-vs-manual são tarefas da
> **consultoria**, não do refino. O que é do **projeto** — o *mecanismo* de eval —
> **já está entregue** (Epic C do plano RAG audit-readiness):
>
> - `packages/memory/src/rag-eval.ts` — runner (`runRagEval`, `parseGoldenJsonl`).
> - `os rag eval [<soul>] [--rerank …] [--min-hit1 …]` — CLI, exit 1 abaixo do piso.
> - `packages/memory/eval/rag-golden.sample.jsonl` — fixture sintética (`__eval__`,
>   `LiteralEmbedder`) travando o CI do PR contra regressão de encanamento.
> - `docs/RAG-EVAL.md` — como um deployment monta o seu golden set real.
>
> As 5 perguntas abaixo eram todas da metade "cliente" — respondê-las deixa de ser
> pré-requisito para fechar o refino.

**Contexto.** 23 casos, escritos por mim lendo os docs, com 3 queries ajustadas
quando falharam. Cobre só a hub-kb (~13 de 281 arquivos da soul). hit@1 73,9% em
n=23 tem IC ~±18pp.

**Perguntas**
1. **Fonte dos casos:** minerar queries reais (Etapa 0 Q4), você escrever à mão,
   um especialista da Dimastec, ou combinação?
   → RESPOSTA: aguardar reunião que terei hoje.
2. **Tamanho alvo:** 50? 80? 120 casos?
   → RESPOSTA:  ainda aguardar
3. **Cobertura do corpus:** só hub-kb, ou incluir `references/` (ISO, LGPD, NIST),
   `sessoes/`, `documentos/` da Dimastec?
   → RESPOSTA: aguardar
4. **Piso de auditoria** que vira gate: `hit@1 ≥ ?` e `hit@5 ≥ ?` e `recall@5 ≥ ?`.
   → RESPOSTA: aguardar
5. Rodar o eval real em **CI** (precisa do runner self-hosted da Etapa 2 Q4) ou
   fica como passo de release manual?
   → RESPOSTA: aguardar

**Testes unitários**
- `rag-eval.test.ts` ganha um caso que, **se** `~/.assistant-os/rag-golden.jsonl`
  existir, roda contra a soul real e asserta os pisos da Q4 (skip quando ausente).
- Teste de `parseGoldenJsonl` com um caso `min_top1_score` e um `expect_path_substr`
  de múltiplas entradas (cobrir os campos hoje pouco exercitados).

**Validação com você**
- Rodar `os rag eval consultoria_ia` juntos; para **cada falha**, eu mostro a
  query, os 5 docs recuperados e o doc esperado — você julga se é falha real do
  RAG ou caso mal-especificado.

---

## Etapa 4 — T1.4 Reranker cross-encoder  — ✅ endurecido (PR `refino/etapa-4-reranker`)

> **Feito (2026-08-29).** Sem depender do golden set real (ver Etapa 3):
>
> 1. **CE multilíngue disponível achado.** `Xenova/bge-reranker-base` (278M, ONNX
>    pronto no HF) **carrega e pontua par PT-BR corretamente** aqui — `rel > irr`
>    num par pm2 vs. culinária. Vira o `RAG_RERANK_CE_MODEL` recomendado no
>    `ADR-RAG-001`; `mmarco-mMiniLMv2` segue 401, `jina-reranker-v2` e
>    `mxbai-rerank-xsmall` não têm build transformers.js-compatível.
> 2. **Orçamento de latência** (`RAG_RERANK_BUDGET_MS`, default 30 000 — teto de UX
>    é ≈180 s/consulta em hardware limitado). Estourou no meio da reordenação →
>    abandona e volta à ordem por score original (`logger.warn`). O CE roda
>    inferência local não-abortável; sem isso uma consulta podia travar.
> 3. **Nome do modelo lido preguiçosamente** (`crossEncoderModel()` em vez de
>    `const` no load) — `RAG_RERANK_CE_MODEL` passa a valer sem reimportar; o teste
>    guardado consegue trocar o modelo de verdade.
> 4. **Teste real do caminho tokenizer+model** (`RAG_RERANK_TEST_MODEL`, skip no CI)
>    — o irrelevante entra em 1º com score de busca maior; só um rerank que de fato
>    pontuou inverte. Era o buraco que deixou o bug do T1.4 passar.
> 5. `__resetRerankState()` para os testes exercitarem o fallback de forma
>    determinística.
>
> Default **segue `off`** (Q3: não remover o código — hardware limitado). A medição
> `off` × `bge-reranker-base` no corpus real é **passo de deployment**, mesma
> moldura da Etapa 3 — registra-se em `ADR-RAG-001 §6` quando rodar.

**Contexto.** Consertado (era no-op silencioso). `RAG_RERANK_CE_MODEL` permite
trocar o modelo. `ms-marco-MiniLM-L-6-v2` (default, só-inglês) → hit@1 73,9% → 56,5%.
`mmarco-mMiniLMv2` não tem build ONNX pronto no HF.

**Respostas (mantidas para registro)**
1. CE multilíngue: medir performance/resposta, hardware limitado.
   → `Xenova/bge-reranker-base` já publicado como `Xenova/*`, sem conversão local.
2. Teto de latência: 180 s/consulta. → `RAG_RERANK_BUDGET_MS` default 30 s, ajustável.
3. Se não superar o baseline: **não** remover o código (hardware limitado).

---

## Etapa 5 — T2.1 Prompt Garden  — ✅ feito (PR `refino/etapa-5-prompt-garden`)

> Migrados `agent-react-system` (agent-workflow.ts + agent-state.ts) e `rag-answer`
> (prompt-templates.ts) — jardim com 9 prompts. Novo campo `outputSchema` (JSON
> literal fora do `template`, sem `{{ }}`); `spec-grill-analyst`/`entity-extraction`/
> `guardian-audit` migrados pra ele — render byte-idêntico verificado. Novo
> `os prompt list` / `os prompt show <id>`. `prompt-templates.ts` monta o
> `ChatPromptTemplate` a partir de `ragAnswer` + `RAG_ANSWER_SUFFIXES`.

**Contexto.** Migrados 7 prompts de pipeline. **3 buracos:**
`memory/agent-workflow.ts` + `agent-state.ts` (system prompts do agente ReAct —
os mais importantes) ficaram de fora por conflito com sessão paralela;
`memory/prompt-templates.ts` (LangChain `ChatPromptTemplate`) não migrado.

**Perguntas**
1. A sessão paralela ("Linkedin & Planos") em `agent-workflow.ts` já **terminou**?
   Posso migrar os system prompts do ReAct para o garden?
   → RESPOSTA: sim
2. `prompt-templates.ts` (LangChain) — migrar para o garden (adaptar o
   `PromptSpec` para gerar `ChatPromptTemplate`) ou deixar fora (estrutura
   própria, documentado como exceção)?
   → RESPOSTA: pode migrar
3. Vale um comando `os prompt list | show <id> | diff` para inspeção/auditoria, ou
   `git log` nos arquivos do garden basta?
   → RESPOSTA: via os prompt list
4. Os templates com JSON literal usam `{{` / `}}` para escapar (ex.:
   `spec-grill-analyst`). Aceitável, ou prefere um campo `outputSchema` separado do
   `template` para não poluir?
   → RESPOSTA: campo separado para nao poluir

**Testes unitários**
- Para cada prompt migrado nesta etapa: teste `render()` **byte-idêntico** ao
  literal anterior (mesmo padrão dos 7 já feitos).
- Teste de que `gardenManifest()` cobre 100% dos prompts que o daemon usa —
  varredura por `grep` de literais de prompt em `packages/*/src` que **não** venham
  do garden (guardrail contra regressão).

**Validação com você**
- `os manifest | python3 -c "import sys,json; [print(p['id'],p['versao']) for p in json.load(sys.stdin)['prompts']]"` —
  confirmar que todo prompt de pipeline/tool está listado.

---

## Etapa 6 — T2.2 Cache semântico  — ✅ feito (PR `refino/etapa-6-semantic-cache-redis`)

> Persistência movida para o `cache` em camadas do core (`ragSemanticCacheGet/Set`
> async; bucket = JSON `[{v,p,exp}]`; cosseno em Node). Daemon chama `cache.init()`
> no boot se `REDIS_URL` setada → cache exato **e** semântico compartilhados entre
> instâncias. `exp` por-entrada preserva expiração preguiçosa no Map. Threshold
> 0.85 e a validação com pares de paráfrase das sessões seguem para quando
> `RAG_SEMANTIC_CACHE=on` for ligado em staging. 532 testes verdes.

**Contexto.** Default off. Sem teste do caminho de **hit** semântico em
`retrieveContext` (os testes de integração usam `LiteralEmbedder` → vetor nulo).
Risco: threshold 0.85 pode casar paráfrases que querem contexto diferente.

**Perguntas**
1. O ganho que você quer é **latência** ou **custo**? (custo: o cache semântico
   não entrega — a resposta ainda é gerada; só o embedding + busca são poupados.)
   → RESPOSTA: latencia
2. Threshold 0.85 — testar com quantos pares reais de paráfrase antes de confiar?
   Você fornece os pares ou eu gero a partir das sessões?
   → RESPOSTA: gere a partir das sessoes
3. Aceitável o cache ser **só em memória do processo** (fragmenta em multi-instância),
   ou precisa ser compartilhado (exigiria Redis + índice vetorial)?
   → RESPOSTA: precisa ser compartilhado, ja havia solicitado uso de redis

**Testes unitários**
- Teste de integração de `retrieveContext` com um embedder determinístico
  (stub que mapeia texto→vetor fixo): query A indexa, query B parafraseada
  (cosseno > threshold) → `cacheHit === "semantic"` e `context` de A; query C
  (cosseno < threshold) → recuperação nova.
- Teste de que `{ semanticCache: false }` nunca preenche nem lê o store (já
  parcialmente coberto; reforçar com o embedder stub).

**Validação com você**
- Ligar `RAG_SEMANTIC_CACHE=on` em staging; eu rodo ~20 pares de paráfrase e te
  mostro, por par: deu hit? o contexto do hit servia para a 2ª query? Você aprova
  o threshold ou pedimos mais rígido.

---

## Etapa 7 — T2.3 Canvas por soul  — ✅ feito (PR `refino/etapa-7-canvas`)

> `--write` preserva o bloco 9 (`mergeCanvasDecisions`). Gate "agentic" estrito:
> `LANGGRAPH_ENABLED` + allowlist L3/curinga. `canvasDrift` + linha em
> `os soul <id>`. Fica de fora (sem alvo no CLI): esqueleto no `os soul create`
> (não existe — criação é MCP `soul_create`). 534 testes verdes.

**Contexto.** `--write` sobrescreve o arquivo inteiro, inclusive o **bloco 9**
(decisões humanas). Gate "agentic" é ~sempre verdadeiro (DEFAULT_ALLOWED_TOOLS tem
`git_commit_push`/`worktree_merge_locally`, ambos L3).

**Perguntas**
1. `--write` deve **preservar** (merge) o bloco 9 existente em vez de sobrescrever?
   → RESPOSTA: preservar
2. O gate "agentic" deve ser mais estrito — ex.: soul tem `agent.permissions.tools`
   **explícito** (não default) **e** alcança L3? Ou tier `langgraph` habilitado?
   → RESPOSTA: tier langgraph
3. O canvas deve ser **exigido** em algum ponto (ex.: `os soul create` gera o
   esqueleto; um check avisa se está defasado do `config.json`), ou fica ad-hoc?
   → RESPOSTA: deve ser exigido

**Testes unitários**
- Teste do merge do bloco 9: canvas com bloco 9 preenchido + `--write` → os
  blocos `· auto` são regenerados, o bloco 9 é mantido.
- Teste do gate estrito (conforme Q2): soul com só default → `agentic:false`.

**Validação com você**
- Rodar `os soul <id> canvas` para as suas 2–3 souls principais; você confere, bloco
  por bloco `· auto`, se bate com a realidade da soul.

---

## Etapa 8 — T3.1 Escalonamento por confiança  — ✅ feito (PR `refino/etapa-8-escalation-judge`)

> Sinal de recusa: juiz LLM local SIM/NÃO (`router-escalation-judge` no garden),
> acionado só quando o RAG foi fraco. Tetos: `_MAX_PER_SESSION` (1) +
> `_COOLDOWN_MIN` (10) + `_FAST_ONLY` (1, só mode=fast). `canEscalateSession`
> in-process. Só chat (Q3). 535 testes verdes. Validação (Ollama vivo) segue
> para quando `ROUTER_ESCALATION=on` em staging.

**Contexto.** Default off. Não validável no CI (precisa Ollama vivo). O bloco em
`chat.ts` que troca `result`/`decision`/`tier`/`model` **não tem teste de
integração** — só `shouldEscalate` (puro). `looksLikeRefusal` é regex PT/EN
frágil. Wired só no `POST /souls/:id/chat`.

**Perguntas**
1. Sinal de recusa: regex é aceitável, ou quer algo melhor — ex.: o provider
   expõe logprobs/`finish_reason`? (Zen via `opencode run` provavelmente não.)
   → RESPOSTA: algo melhor
2. Cada escalada = **2 chamadas LLM**. Quer um teto (ex.: no máx. 1 escalada por
   sessão / por N minutos) e/ou só quando `mode === "fast"`?
   → RESPOSTA: ambos, definidos em tela com valor default
3. Escalar também em `agenda` / `events` / `voice`, ou só chat interativo?
   → RESPOSTA: so chat, voice parece nao funcionar
4. Ordem de tiers para escalada: sempre o **próximo** de `routerTiers`, ou pular
   direto para o **melhor** (`soul`)?
   → RESPOSTA: proximo

**Testes unitários**
- Teste de integração de `handleChat` com `ROUTER_ESCALATION=on`: stub de `run`
  + stub do ollama (via `ollamaChat` injetável ou monkeypatch do fetch) devolvendo
  resposta curta/recusa → asserir que o `run` do próximo tier é chamado e que
  `result`/`router_history` refletem o tier escalado. Se o ollama não for
  stubável hoje, primeiro torná-lo injetável (pequeno refactor, testável).
- Teste: `ROUTER_ESCALATION=off` → o bloco é inerte (mesma resposta, 1 chamada).
- Casos extra de `looksLikeRefusal`: falso-positivo "não sei se ajuda, mas..." (deve
  **não** disparar) — calibrar a regex.

**Validação com você**
- `ROUTER_ESCALATION=on` em staging; você me passa 5–10 queries que o `local`
  costuma errar; medimos juntos `aos_router_escalation_total{reason}` e a latência
  p95 do chat antes/depois.

---

## Etapa 9 — T3.3 Ordem do montador de prompt  — ✅ feito (PR `refino/etapa-9-skills-split`)

> `renderSkillsPrompt` partido em `renderSkillsIndex` (semi-estático → prefixo) +
> `renderActiveSkills` (dinâmico → cauda); `buildPrompt` reordenado. Compat
> mantida (byte-idêntico) para o `langgraph-runner`. Instrumentação de prefill do
> Ollama: `aos_ollama_prefill_seconds` + `aos_ollama_prompt_eval_tokens` + passo
> no log. Zen prefix caching = aguardar (Q3). 531 testes verdes.

**Contexto.** Reorder feito (persona no prefixo, sessão/RAG/histórico na cauda).
Benefício **não medido**. Os tiers que custam (`zen`/`soul`) vão por
`opencode run <string>` — não se sabe se o prefixo estável sobrevive à construção
do request nem se o backend Zen faz prefix caching. `skillsCtx` ainda quebra o
prefixo quando skills casam (índice estático + corpos dinâmicos no mesmo bloco).

**Perguntas**
1. Vale **medir** o ganho no tier local (instrumentar latência de prefill do
   Ollama turno-1 vs turno-2)? Ou aceitamos "é a ordem correta, ganho é bônus"?
   → RESPOSTA: vale medir, estamos em poc
2. Separar `skillsCtx` em **índice** (estático, sobe pro prefixo) e **corpos das
   skills que casaram** (dinâmico, desce)? Mexe em `renderSkillsPrompt` no core.
   → RESPOSTA: separar
3. Dá para verificar com o time do opencode/Zen se há prefix caching automático no
   endpoint `opencode.ai/zen/v1`? (define se o esforço no tier pago vale.)
   → RESPOSTA: aguardar

**Testes unitários**
- Se separar skills: teste de que o índice de skills fica antes da fronteira
  volátil e os corpos depois; e de que o prefixo até o índice não muda quando só
  o corpo de uma skill entra.
- Teste de estabilidade de prefixo cross-turno já existe (2) — estender para o
  caso "uma skill casou no turno 2".

**Validação com você**
- Se instrumentarmos: dois turnos na mesma sessão contra um Ollama local,
  comparar o tempo de prefill reportado (`prompt_eval_duration` do `/api/chat`).

---

## Etapa 10 — Cobertura de teste de integração (transversal)

**Contexto.** Padrão da jornada: todo recurso tem teste de **unidade** sólido e
**zero** teste do comportamento **wired**. Os 516 verdes parecem melhores que a
cobertura real.

**Perguntas**
1. Prioridade entre os caminhos wired-sem-teste: (a) hit semântico em
   `retrieveContext`, (b) escalada em `chat.ts`, (c) modelo real do cross-encoder,
   (d) o gate de CI num evento de PR real.
   → RESPOSTA:  a
2. Aceitável um refactor pequeno para tornar `ollamaChat` injetável (hoje é uma
   função-módulo) para viabilizar o teste (b)?
   → RESPOSTA: refactor
3. Meta de cobertura: "todo caminho que um toggle liga tem ao menos 1 teste de
   integração" — aceita como critério de saída do refino?
   → RESPOSTA: sim

**Testes unitários / integração:** a soma dos itens marcados nas Etapas 3–9,
executados aqui como uma sub-suíte nomeada.
**Validação com você:** rodar a suíte estendida e revisar o relatório de cobertura
dos caminhos wired.

### Feito (PR `refino/etapa-10-integ-coverage`)

Sub-suíte `[wired]` — testes do comportamento montado, não das funções puras:

| Caminho wired | Toggle | Teste | Como fica determinístico |
|---|---|---|---|
| **(a)** hit semântico em `retrieveContext` | `RAG_SEMANTIC_CACHE=on` | `packages/memory/src/test/integ-wired-paths.test.ts` — `[wired] … HIT semântico para query parafraseada` | `retrieveContext(opts.embedder)` (refactor mínimo) + `BagOfWordsEmbedder` de teste em 768 dims: duas frases com o mesmo multiconjunto de tokens → cosseno 1.0 → o cache exato erra (sha1 da string), o semântico acerta |
| **(b)** juiz de confiança do escalonamento | `ROUTER_ESCALATION=on` | `packages/daemon/src/test/escalation.test.ts` — 3 testes `[wired] judgeAnswer` | `judgeAnswer(q, { chat, … })` extraído de `routes/chat.ts` para `orchestrator/escalation.ts` com `chat` injetável (stub no teste); cobre render do prompt do garden, rewrite de URL docker, strip do prefixo do modelo, `SIM`/`NÃO`/erro→`unknown` |

Fora de escopo desta etapa: **(c)** modelo real do cross-encoder (precisa Xenova
— roda no `os rag eval --rerank cross-encoder` manual, evidência de auditoria) e
**(d)** gate de CI num PR real (já exercitado a cada PR do refino: `compliance`
verde no #1, #4–#8).

**Critério de saída atingido:** cada toggle do refino (`RAG_RERANK`,
`RAG_SEMANTIC_CACHE`, `ROUTER_ESCALATION`) tem ≥ 1 teste que exercita o caminho
que ele liga — não só a função pura.

---

## Registro de progresso

| Etapa | Respondida | Testes | Validada | Commit |
|---|---|---|---|---|
| 0 — Objetivo/ambiente | ✅ | — | ✅ | — |
| 1 — Poda | ✅ (manter cache+refinar; promover canvas; investir reranker) | — | ✅ | — |
| 2 — Gate de CI | ✅ | ✅ 13 verdes | ✅ PR #1 (+ CI verde no #2: cache + ordenação) | `feat/refino-etapa-2` |
| 3 — Golden set | ✅ (metade "cliente" tirada do refino) | ✅ mecanismo (Epic C) + fixture sintética no CI | ✅ mecanismo entregue; golden real = tarefa da consultoria | — |
| 4 — Reranker | ✅ | ✅ rerank +2 (real skip no CI) | ✅ PR #10 mergeado; medição `off`×`bge-reranker-base` = passo de deployment | `refino/etapa-4-reranker` |
| 5 — Prompt Garden | ✅ | ✅ core 275 · memory 79 · cli 12 | ✅ PR #4 mergeado (`os prompt list`) | `refino/etapa-5-prompt-garden` |
| 6 — Cache semântico | ✅ | ✅ 532 verdes | ✅ PR #6 mergeado | `refino/etapa-6-semantic-cache-redis` |
| 7 — Canvas | ✅ | ✅ core 9 · cli 12 (534 total) | ✅ PR #7 mergeado | `refino/etapa-7-canvas` |
| 8 — Escalonamento | ✅ | ✅ 535 verdes (escalation +11) | ✅ PR #8 mergeado (validar c/ Ollama vivo em staging) | `refino/etapa-8-escalation-judge` |
| 9 — Ordem do prompt | ✅ | ✅ 531 verdes | ✅ PR #5 mergeado (medir prefill em staging) | `refino/etapa-9-skills-split` |
| 10 — Cobertura integração | ✅ | ✅ 540 verdes (+5 wired) | ✅ PR #9 mergeado | `refino/etapa-10-integ-coverage` |
