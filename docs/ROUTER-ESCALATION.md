# Escalonamento por confiança (T3.1 · endurecido na Etapa 8)

O roteador escolhe o tier **antes** de ver a resposta. Este mecanismo, **depois**
da execução no tier `local`, decide se a resposta é fraca o suficiente para valer
uma segunda tentativa num tier melhor (`zen`/`soul`).

**Desligado por default** — mesma política do reranker (T1.4) e do cache semântico
(T2.2): mecanismo pronto, ativação por env após medir.

| Env | Default | Efeito |
|---|---|---|
| `ROUTER_ESCALATION` | `off` | `on` / `1` / `true` liga |
| `ROUTER_ESCALATION_MIN_SCORE` | `0.55` | score do 1º chunk de RAG abaixo do qual vale **acionar o juiz LLM** (clamp 0–1) |
| `ROUTER_ESCALATION_MIN_CHARS` | `40` | respostas mais curtas que isto (trim) escalam sem juiz (clamp 0–10000) |
| `ROUTER_ESCALATION_MAX_PER_SESSION` | `1` | máx. de escalonamentos por sessão (clamp 0–100) |
| `ROUTER_ESCALATION_COOLDOWN_MIN` | `10` | minutos de cooldown entre escalonamentos da mesma sessão (clamp 0–1440) |
| `ROUTER_ESCALATION_FAST_ONLY` | `1` | `0` desliga — por default só escala quando `mode === "fast"` |

## Sinal de confiança (Etapa 8)

`shouldEscalate` (`packages/daemon/src/orchestrator/escalation.ts`), em ordem:

1. `fastModeOnly` e o turno é `pro` → **não escala** (`pro_mode`) — pro já usa tier melhor.
2. **local falhou** (código ≠ 0 / timeout) → escala (`local_failed`).
3. **resposta vazia ou < `MIN_CHARS`** → escala (`answer_too_short`).
4. **resposta parece recusa** (`looksLikeRefusal`: "não sei", "não tenho essa
   informação", …) → escala (`refusal`).
5. **juiz LLM = "não"** → escala (`judge_weak`).
6. senão → não escala (`confident`).

**Juiz LLM** (`router-escalation-judge` no Prompt Garden): uma chamada **SIM/NÃO**
curta ao **modelo local** — "a RESPOSTA responde à PERGUNTA de forma útil?". Só
roda quando (a) nenhum sinal barato dos passos 1–4 já decidiu **e** (b) o RAG foi
fraco (`!ragOk || ragTopScore < MIN_SCORE`) — se o RAG foi forte e a resposta não
parece recusa, confia sem gastar a chamada. `SIM`→ok, `NÃO`→weak, resto→`unknown`
(não escala).

## Tetos por sessão

`canEscalateSession(sessionId, cfg)` (limitador in-process): bloqueia se a sessão
já bateu `MAX_PER_SESSION` (`session_cap`) ou se está dentro do `COOLDOWN_MIN` do
último (`cooldown`). O bloqueio vira métrica `aos_router_escalation_total{reason=session_cap|cooldown, to_tier="-"}`.

## Escopo

- Só a partir do tier **`local`**, só sem `tier`/`model` fixados no request, e
  **um degrau, uma vez** (`nextEscalationTier` na ordem de `config.routerTiers`).
- Re-execução via `opencode run` (mesmo caminho de `zen`/`soul`); `router_history`
  / `cost_calls` registram o tier escalado.
- Métrica: `aos_router_escalation_total{reason,to_tier}`.
- Wired só no `POST /souls/:id/chat`. `agenda` / `events` / `voice` ficam para depois.

## Validação antes de ligar

Precisa de ambiente com Ollama vivo (o `local` tem que executar de fato — em CI a
sonda cai direto pra `zen`). Ligar em staging, olhar
`aos_router_escalation_total` por `reason` (quantos `judge_weak` vs bloqueios) e a
latência p95 do chat — cada escalonamento = **até 3 chamadas LLM** (local +
juiz + tier acima).
