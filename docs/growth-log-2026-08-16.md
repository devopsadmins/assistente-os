# Growth Log — 2026-08-16

## Tarefa
Portar as ideias SLC-OS (loop de almas openclaw-style + gate de relevância RAG) para o assistente-os, sem usar shell.

## O que funcionou bem
- **`alma.ts`**: write-back via `node:fs` puro (append) — sem shell, sem child_process. Sessões/llçeos/adr idempotentes (slug+data) ficaram diretos.
- **`relevance.ts`**: port direto de `rag.py::relevancia`; a tokenização NFKD + STOPWORDS_PT já estava embutida no arquivo-fonte original, o que evitou rederivado. `usefulTerms` (score × termos) deu cobertura boa com poucos testes.
- **Injeção no chat**: prefixar o prompt com contexto da alma + RAG filtrado pelo gate foi o caminho mais não-intrusivo — sem tocar no runner open-code.
- **Testes**: 47 testes root green; os testes de alma/RAG foram escritos per-test-suite (core, memory, tools) e validam escrita + duplicata + verdict.

## Aprendizado (pattern reutilizável)
- **Char-class regex trap (Windows)**: `[\/]` em `.split()` NÃO captura backslash num char-class — precisa de `[/\\]`. Erro recorrente em asserts de path. Preferir `basename`/`dirname` do `node:path` em vez de regex de separador.
- **Modo "aviso" como default seguro**: para gates de RAG, `aviso` (informativo, não recusado) é o default menos disruptivo — deixa o caller decidir. `recusar` precisa ser explícito + sinalização HTTP (409).
- **Write-back opt-in no chat**: `memorizar=false` default manteve o comportamento do chat estável (nada grava) enquanto a funcionalidade de escrita existe nas tools/CLI/REST. Evita surpresas para usuarios existentes.

## Decisões abertas (não validadas pelo usuário — sinalizar)
1. **Formato ADR dentro da alma** (`decisoes/<data>-<slug>.md`) em vez do padrão SLC-OS (fora da alma). Escolhi dentro para isolamento por soul.
2. **`memorizar=false` default no chat** — usuário pode querer opt-in.
3. **Modo gate default `aviso`** — pode valer `libre` para chat (nunca recusar), reservar `recusar` para REST.

## Próximos passos (backlog)
- A5 opcional: write-back auto no chat quando `memorizar=true` (persistir anotação pós-turno) — depende da decisão #2.
- Rotina de retenção de sessões/licoes/decisões (evitar crescimento de disco).
- Questionário AI-3 completo (Bloco 2-4, 7-12) — requirements adicionais para produção: inventário de IA, manifesto de execução versionado, dataset de avaliação + thresholds, fallback/kill-switch, limites de custo/tokens/tempo.
- Rever ADR-AI-003 quando houver revisão (gatilho: 2027-02-16).
