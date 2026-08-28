# Canvas de Arquitetura por soul — referência

`os soul <id> canvas [--write]` gera um **AI Architecture Decision Canvas**
descritivo por soul. Os blocos marcados `· auto` vêm de `config.json` + fatos do
sistema; o bloco `· decisão` fica em branco para preenchimento humano.

Este documento explica cada bloco **com o vocabulário real do projeto** — não os
campos aspiracionais que a revisão de arquitetura (`docs/ARCHITECTURE-REVIEW.md`,
Análise 1) apontou como ficção (escalonamento p/ Claude, "cache semântico
sempre ligado", HITL via `interrupt()` do LangGraph, `ERR_BUDGET_EXCEEDED`).

## Quando gerar

O canvas completo só rende para souls **agentic** — a allowlist de tools resolvida
alcança alguma tool **L3** (efeito estrutural/externo/irreversível) ou tem curinga
total (`*`). Para souls sem isso, o header diz "Agentic: não" e os blocos de
decisão importam menos.

## Os blocos

| Bloco | Fonte | O que olhar |
|---|---|---|
| 1. Identidade | `config.json` | provider/modelo próprios vs. herdados do global |
| 2. Recuperação (RAG) | fatos do sistema + guardrails da soul | `RAG_RERANK` (default `off`), `RAG_SEMANTIC_CACHE` (default off), `RAG_INJECTION_MODO`, `ef_search`, threshold de relevância |
| 3. Roteamento | `config.routerTiers` | tiers `local`→`zen`→`soul` (+`langgraph`), fallback por sonda; `ExecutionMode` `fast`/`pro` por prompt. **Não há cascata por confiança** (ver T3.1) |
| 4. Tools & níveis | allowlist resolvida × `CAPABILITY_CATALOG` | quais patterns alcançam L3 |
| 5. Autonomia & aprovação | `agent.autonomy`, `agent.approvalPolicy` | `suggest`/`ask`/`auto`; Guardian OTP-over-Telegram só para promoção de Regra de Ouro |
| 6. Guardrails | `resolveEffectiveGuardrails` | `maxTurns`, `maxIterations`, `dailyLimit`, `allowedOrigins`, connectors |
| 7. Dados & memória | `agent.memoryPolicy` | classificação + retenção; isolamento por soul |
| 8. Auditoria | fixo | trilha markdown em `sessoes/<data>.md`, hash de `os manifest`, métricas `aos_*` |
| 9. Decisões | **humano** | ver abaixo |

## Bloco 9 — as perguntas que só o dono responde

- **Quais ações desta soul exigem aprovação humana, na prática, e por quê.**
  `autonomy` e `approvalPolicy` dizem o mecanismo; aqui vai o racional por classe
  de ação.
- **Fallback esperado** quando o tier primário cai (sonda falha → próximo tier) ou
  o RAG não acha nada (`hasRelevantDocs=false` → responde sem contexto). É
  aceitável? Deve recusar?
- **Custo do erro** por classe de ação: irreversível? financeiro? reputacional?
  LGPD? Isso calibra se `autonomy=auto` é seguro para aquela tool.
- **As 3 perguntas do curso** (decomposição): existe regra finita cobrindo >90%
  dos casos (então talvez não precise de LLM)? · o erro é caro/irreversível
  (então Approval Gate)? · o comportamento depende de contexto (então LLM+RAG)?

## Manter atualizado

O canvas é **gerado** — não editar os blocos `· auto` à mão; mude o `config.json`
e regenere. O bloco 9 é a única parte com conteúdo humano; ao rodar com `--write`,
reconcilie-o antes de sobrescrever `ARCHITECTURE_CANVAS.md`.
