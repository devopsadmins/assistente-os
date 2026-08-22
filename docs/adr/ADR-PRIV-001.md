# ADR-PRIV-001 — Base legal, finalidade e retenção para dados de famílias (`familias`)

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**
> Cópia por decisão. Não editar um ADR aceito: nova decisão cria ADR substituto e preserva o histórico.

## 1. Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-PRIV-001` |
| Versão | `1.0` |
| Status | Proposta (aguardando assinatura do owner de risco/responsável clínico) |
| Data da aceitação | — |
| Owner técnico | agente assistente-os |
| Owner de negócio | responsável pelo serviço de psicoterapia familiar/infanto-juvenil |
| Owner de risco | security-reviewer / DPO |
| Perfil de conformidade | AI-4 (sinalizado em avaliação; formalização própria pendente de ADR dedicado) |
| Módulos normativos aplicáveis | privacy-data-protection, ai-governance, security-operations |
| Blocos do questionário de origem | Bloco G (gate G3) |
| Relacionados | ADR-AI-003, ADR-AI-004; migration `0008_familias_privacidade`; `packages/core/src/familias.ts` |
| Rastreabilidade norma externa | LGPD art. 6º, 7º I, 11 II f, 14, 15, 16, 18 VI · ISO/IEC 27001:2022 (A.5.34, A.8.10) · ISO/IEC 42001:2023 |

## 2. Contexto

O gate **G3 do Bloco G** da norma v4.0 está reprovado: a tabela `familias` (migration `0004`, `packages/core/src/migrations.ts`) trata dado pessoal de crianças e adolescentes — `telefone`, `nome_familia`, `nome_crianca` — e dado potencialmente sensível de saúde via `questionnaire_data`/`anamnese_phase` (anamnese infanto-juvenil e psicoterapia familiar), **sem base legal, finalidade ou retenção declaradas**. A retenção existente no projeto cobre apenas sessões da soul (`limparSoul`, `alma.ts`) e embeddings por soul (`packages/memory/src/reindex.ts`), não a tabela `familias`. Gate reprovado bloqueia produção e exige item de roadmap datado com owner.

Fatos adicionais verificados:

1. O `soul_id` é derivado diretamente do telefone (`familia_<telefone>`, `familias.ts::telefoneToSoulId`) — o identificador pessoal se propaga como chave por todas as tabelas e diretórios da soul.
2. Não existia rota de eliminação nem rotina de retenção para famílias (direito de eliminação, LGPD art. 18 VI, sem caminho de atendimento).
3. Métricas operacionais (`cost_calls`, `router_history`) referenciam o soul mas não carregam conteúdo pessoal além do identificador.

## 3. Decisão

Adotar **dupla pista de base legal**, finalidade única e retenção configurável com eliminação total em cascata:

1. **Base legal — dado pessoal comum** (telefone, nomes): consentimento dos pais/responsáveis (LGPD art. 7º I c/c art. 14 — criança/adolescente: consentimento específico e destacado de um dos responsáveis, no melhor interesse).
2. **Base legal — dado sensível de saúde** (anamnese/questionário): tutela da saúde, exclusivamente por profissional de saúde (LGPD art. 11 II "f"). *Premissa organizacional: o serviço é operado com profissional habilitado; caso não se aplique, este item deve ser reaberto antes do uso real.*
3. **Finalidade**: prestação do serviço de psicoterapia familiar e infanto-juvenil (registro em `familias.finalidade`).
4. **Retenção**: dados mantidos durante o acompanhamento; após encerramento (`status = 'encerrado'`), prazo padrão de **1825 dias** (configurável via `FAMILIAS_RETENCAO_DIAS`), findo o qual a rotina de retenção exclui o registro e todos os dados derivados da soul.
5. **Mecanismos implementados**:
   - Migration `0008_familias_privacidade`: colunas `base_legal`, `base_legal_sensivel`, `finalidade`, `encerrado_em`, `retencao_ate` + `COMMENT` no schema.
   - `encerrarFamilia()` / `excluirFamilia()` / `listarFamiliasVencidas()` / `sweepRetencaoFamilias()` em `packages/core/src/familias.ts`.
   - Rotas `POST /familias/:id/encerrar` e `DELETE /familias/:id` no daemon.
   - Sweep diário (e na inicialização) em `packages/daemon/src/server.ts`.
6. **Escopo da eliminação**: transação apagando, por soul — `execution_logs`, `sessions`, `events`, `agenda`, `entity_extraction_queue`, `observations`, `relations`, `entities`, `chunks` (embeddings RAG), `agent_checkpoints` e a linha de `familias` — seguido da remoção do diretório `souls/<soul_id>/` em disco.

### O que NÃO muda

- Métricas sem conteúdo pessoal (`cost_calls`, `router_history`) são preservadas após a exclusão (decisão documentada; contêm apenas identificadores agregados de custo/latência).
- A derivação `soul_id ← telefone` permanece nesta versão (ver §7).

## 4. Alternativas consideradas

| Alternativa | Motivo da rejeição |
|---|---|
| Base legal unificada por consentimento (art. 7º I + 11 I) | Frágil para dado de saúde: revogação de consentimento obrigaria interrupção imediata do tratamento clínico em curso; art. 11 II f reflete melhor a natureza da relação terapêutica |
| Pseudonimização/anonimização em vez de eliminação | Anonimização irreversível de anamnese não garante utilidade clínica; pseudônimo retido ainda é dado pessoal sob custódia — maior superfície de risco sem necessidade |
| Retenção indefinida até decisão futura | Violaria princípio da necessidade (art. 6º III) e manteria G3 reprovado |
| Exclusão apenas da tabela `familias` (sem cascata) | Deixaria PII derivada espalhada (memória, eventos, RAG, checkpoints) — eliminação cosmética, não fecha o gate |

## 5. Consequências e controles

| Consequência | Impacto | Controle compensatório |
|---|---|---|
| Backups/dumps do Postgres retêm linhas eliminadas até rotação do ciclo | Médio | Ressalva operacional registrada aqui; política de rotação/restauração deve respeitar pedido de eliminação (item pendente de owner — §7) |
| Eliminação em cascata é irreversível | Médio | Operação explícita via API autenticada; sweep só atinge registros `encerrados` com prazo vencido; transação garante atomicidade relacional |
| Consentimento dos responsáveis precisa ser capturado fora do banco (canal WhatsApp) | Alto | Evidência de consentimento é requisito do fluxo de onboarding — pendência organizacional registrada (§7); schema já declara a base legal adotada |

## 6. Evidências mínimas (Princípio 10)

- Migration aplicada: `packages/core/src/migrations.ts` (`0008_familias_privacidade`) + testes `packages/core/src/test/familias.test.ts` (defaults de privacidade, encerramento, vencimento, cascata, sweep).
- Código: `familias.ts` (ciclo de vida), `routes/familias.ts` (rotas), `server.ts` (sweep diário).

## 7. Pendências (roadmap datado — owners)

| Item | Descrição | Owner | Prazo |
|---|---|---|---|
| P1 | Confirmar prazo de arquivo de prontuário junto ao Conselho Federal de Psicologia e ajustar `FAMILIAS_RETENCAO_DIAS` se necessário | Responsável clínico | antes do go-live com famílias reais |
| P2 | Capturar/evidenciar consentimento dos responsáveis no onboarding WhatsApp | owner de negócio + DPO | antes do go-live |
| P3 | Política de backups coerente com pedidos de eliminação (rotação/repurga) | owner técnico | 30 dias |
| P4 | Substituir derivação `soul_id ← telefone` por identificador opaco (minimização) | owner técnico | roadmap — próxima janela de refactor |
| P5 | ADR formal de classificação de perfil (AI-4 sinalizada por processamento de voz em runtime — `packages/voice/src/pipeline.ts`) | owner técnico + owner de risco | próximo passo do fluxo de adoção |
