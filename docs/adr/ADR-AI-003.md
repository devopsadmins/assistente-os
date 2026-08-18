# ADR-AI-003 — Adotar loop de almas (openclaw-style) e gate de relevância (SLC-OS) no assistente-os

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**
> Cópia por decisão. Não editar um ADR aceito: nova decisão cria ADR substituto e preserva o histórico.

## 1. Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-AI-003` |
| Status | Aceita (2026-08-16) |
| Perfil de conformidade | AI-3 |
| Módulos normativos aplicáveis | ai-protocols, security-operations, vendor-cloud |
| Blocos do questionário de origem | Bloco G, Bloco 1, Bloco 3, Bloco 5, Bloco 6, Bloco 13 |
| Rastreabilidade norma externa | ISO/IEC 27001:2022 · LGPD |
| Owner técnico | agente assistente-os (Claude Code) |
| Owner de negócio | area de agentes |
| Owner de risco | security-reviewer |

## 2. Contexto

O assistente-os é um agente CLI/REST (AI-3) que orquestra open-code headless com memória SQLite + RAG Ollama. Antes desta decisão, o agente não possuía memória persistente de sessão nem filtro de relevância em buscas, gerando (a) perda de contexto entre sessões e (b) respostas baseadas em trechos de conhecimento irrelevantes ou de baixa confiança. O SLC-OS (repósitório paralelo) já contém as implementações canônicas: acervo.py (anotar/registrar_licao/decidir) e rag.py::relevancia (tokenização NFKD, STOPWORDS_PT, min_score, min_term_matches, modos recusar/aviso/libre). Precisamos portar essas duas capacidades sem violar a restrição do domínio (nada de shell/child_process fora do runner open-code, que já existia) e sem expor credenciais/segredos.

## 3. Decisão

Adotar o loop de almas (openclaw-style) e o gate de relevância (SLC-OS) como componentes internos do assistente-os:

1. `packages/core/src/alma.ts` expõe `anotar`/`registrarLicao`/`decidir`/`appendSoulFile` sobre arquivos da soul (node:fs, zero shell).
2. ADRs gravam-se **dentro da alma** em `decisoes/<data>-<slug>.md` (isolação por soul — diverge de SLC-OS que grava fora).
3. `packages/memory/src/relevance.ts` porta tokenização NFKD + `STOPWORDS_PT` + `relevancia`/`searchWithVerdict` com modos `recusar|aviso|libre` e defaults `min_score=0.35`, `min_term_matches=1`.
4. O chat (`POST /souls/:id/chat`) injeta no prompt um prefixo de contexto persistente da alma + RAG filtrado pelo gate — `memorizar=false` por default (chat nunca grava).
5. Exposição: tools MCP `soul_anotar`/`soul_licao`/`soul_decidir` + `memory_search{verdict}`, CLI `os soul <id> {anota|licao|decide}`, endpoints REST `/souls/:id/{anotar,licao,decidir}` e `/memory/search{verdict}`.

**Não muda:** runner open-code, router de tiers, schema SQLite.

## 4. Alternativas consideradas

| Alternativa | Motivo da rejeição |
|---|---|
| Não portar (manter status quo sem memória persistente nem gate) | mantém bugs conhecidos (perda de contexto, RAG ruído) — afeta AI-3 diretamente. |
| Gravar ADRs fora da alma (compartilhado global, como SLC-OS faz) | rompe o isolamento por soul exigido pelo modelo de memória do assistente-os; risco de contaminação cross-soul. |

## 5. Consequências e controles

| Consequência | Impacto | Controle compensatório |
|---|---|---|
| Memória de sessão e lições aprendidas sobrevivem entre runs da soul. | alto | escrita apenas via tools/CLI/REST explícitos (`memorizar=false` no chat). |
| Busca RAG com veredito explícito (ok/score/termos/motivo/modo) para callers decidirem como reagir. | médio | modo `aviso` default não recusa; `recusar` bloqueia com 409 no REST. |
| Novos riscos operacionais: crescimento de disco em sessões/licoes/decisões. | baixo | rotina de retenção a definir no backlog (não automática). |

## 6. Evidências exigidas (Princípio 10)

| Requisito/controle | Artefato | Local |
|---|---|---|
| Port da alma: escrever sem shell | `packages/core/src/alma.ts` + testes (11) | assistente-os/packages/core/src/alma.ts |
| Port do gate: tokenização + STOPWORDS_PT | `packages/memory/src/relevance.ts` + testes (15) | assistente-os/packages/memory/src/relevance.ts |
| Integração chat + RAG gate | `packages/daemon/src/server.ts` (chat handler) + 47 testes root green | assistente-os/packages/daemon/src/server.ts |
| Exposição MCP/CLI/REST | `packages/tools/src/index.ts`, `packages/cli/src/index.ts`, `server.ts` endpoints | multi-package |

## 7. Gatilhos de reavaliação

- Mudança de arquitetura, fornecedor, modelo, protocolo, região ou classificação de risco.
- Novo requisito legal, regulatório ou contratual.
- Incidente relevante relacionado ao escopo.
- Vencimento de exceção vinculada.
- Revisão programada: 2027-02-16.

## 8. Aprovação

| Papel | Nome | Data | Assinatura/registro |
|---|---|---|---|
| Owner técnico | agente assistente-os (Claude Code) | 2026-08-16 | auto-registro |
| Owner de negócio | area de agentes | — | pendente |
| Owner de risco | security-reviewer | — | pendente |
| Aprovador da governança | — | — | pendente |

## Histórico

| Data | Evento | Autor |
|---|---|---|
| 2026-08-16 | Aceita | Claude Code |
