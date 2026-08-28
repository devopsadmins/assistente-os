# Escalonamento por confiança (T3.1)

O roteador escolhe o tier **antes** de ver a resposta. Este mecanismo, **depois**
da execução no tier `local`, decide se a resposta é fraca o suficiente para valer
uma segunda tentativa num tier melhor (`zen`/`soul`).

**Desligado por default** — mesma política do reranker (T1.4) e do cache semântico
(T2.2): mecanismo pronto, ativação por env após medir.

| Env | Default | Efeito |
|---|---|---|
| `ROUTER_ESCALATION` | `off` | `on` / `1` / `true` liga |
| `ROUTER_ESCALATION_MIN_SCORE` | `0.55` | score do 1º chunk de RAG abaixo do qual o contexto é "fraco" (clamp 0–1) |
| `ROUTER_ESCALATION_MIN_CHARS` | `40` | respostas mais curtas que isto (trim) são "fracas" (clamp 0–10000) |

## Regras (conservador — só sobe em sinal claro)

`shouldEscalate` (`packages/daemon/src/orchestrator/escalation.ts`):

1. **local falhou** (código ≠ 0 / timeout) → escala (`local_failed`)
2. **resposta vazia ou < `MIN_CHARS`** → escala (`answer_too_short`)
3. **resposta parece recusa** (`looksLikeRefusal`: "não sei", "não tenho essa
   informação", …) **e**:
   - o RAG não achou nada (`verdict.ok=false`) → escala (`refusal_no_rag`)
   - o score do topo < `MIN_SCORE` → escala (`refusal_weak_rag`)
4. senão → não escala (`confident`)

## Escopo

- Só a partir do tier **`local`**, só quando o usuário **não** fixou `tier`/`model`
  no request, e **só sobe um degrau, uma vez** (`nextEscalationTier` na ordem de
  `config.routerTiers`).
- A re-execução vai por `opencode run` (mesmo caminho dos tiers `zen`/`soul`); o
  `router_history`/`cost_calls` registram o tier escalado.
- Métrica: `aos_router_escalation_total{reason,to_tier}`.
- Wired só no `POST /souls/:id/chat`. `agenda`/`events`/`voice` ficam para depois.

## Validação antes de ligar

Precisa de ambiente com Ollama vivo (o tier `local` tem que de fato executar — em
CI a sonda cai direto pra `zen`). Ligar em staging, olhar
`aos_router_escalation_total` por `reason` e a latência p95 do chat (cada
escalonamento = 2 chamadas LLM) antes de ligar em produção.
