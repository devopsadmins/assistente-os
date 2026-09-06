# ADR-RAG-002: Hierarquia de Autoridade de Fontes e Política de Recusa em Colisão de Contexto

- **Status:** Proposta (aguardando revisão técnica + owner de governança para a tabela domínio→tier)
- **Data:** 2026-09-06
- **Relacionados:** ADR-AI-003 (Zero Trust, `RAG_INJECTION_MODO`, gate de relevância RAG); ADR-RAG-001 (reranking — medição em corpus PT-BR); `packages/memory/src/rag-confidence.ts` (modo "evidência insuficiente", E11); `packages/daemon/src/extract.ts` + upload self-service (FM1 — ver `docs/FRIENDLY-MODE.md`); `docs/AI-INVENTORY.md` #1 (Chat por soul, risco AI-3).

> **Nota de processo.** `docs/adr/` foi arquivado para fora do repo em 2026-09-06
> (série movida para a soul `consultoria_ia`). Este ADR reabre o diretório — o
> `compliance-gate` do CI já trata `docs/adr/` como paper trail válido. Alinhar
> com o dono do processo se a série volta a viver aqui. Numeração: `ADR-RAG-001`
> já existe (referenciado em `rerank.ts`), então `ADR-RAG-002` é o próximo.

## §1. Contexto

O sistema #1 do `AI-INVENTORY.md` (Chat por soul, AI-3) já detecta prompt injection nos chunks de RAG (`RAG_INJECTION_MODO`, descarta chunk suspeito), aplica gate de relevância, e — com `AOS_RAG_MIN_CONFIDENCE` ligado — entra em "evidência insuficiente" quando a confiança agregada fica abaixo do piso (`rag-confidence.ts`). O que **nenhum** desses guardrails resolve: quando dois chunks igualmente "limpos" (sem injection, ambos relevantes, confiança alta) carregam informação normativa **conflitante** — ex. uma mensagem de canal informal dizendo "aprovação acima de R$ 5.000" e um documento de política oficial dizendo "acima de R$ 10.000". O pipeline atual monta o contexto com ambos e delega ao modelo a ponderação de qual vale.

Pedir a um LLM que arbitre precedência normativa via prompt é delegar uma decisão binária e determinística (dado o par de fontes, A tem mais autoridade que B — sempre) para um processo de amostragem estocástica. O modelo é bom em julgamento contextual; precedência não é julgamento contextual, é regra de negócio.

Lacunas concretas no pipeline atual (`retrieveContext` em `packages/memory/src/rag-chain.ts`; reordenação em `rerank.ts`):

1. Não há campo de proveniência/autoridade no schema de chunk. A tabela `chunks` tem `soul, doc_key, path, title, body, embedding, content_hash, updated_at` — nada de origem/tier (ver `UPSERT_CHUNK_SQL` em `indexer.ts`).
2. O único filtro que roda **antes** do LLM é o de relevância (score) e o descarte por injection. Não há filtro por autoridade em estágio nenhum.
3. Não há política de recusa para conflito entre fontes de **mesmo** tier: o sistema sempre sintetiza.

## §2. Decisão

Três mecanismos na arquitetura de ingestão/retrieval, **não** no system prompt. Ordem de valor: 2.1 + 2.2 + 2.4 são o v1 shippável; 2.3 fica atrás de um spike (ver §8).

### 2.1 — Campo de autoridade no schema

Coluna nova em `chunks`, carimbada **no momento da ingestão** por regra de origem (path/canal) ou por quem ingere — nunca inferida pelo LLM em runtime:

```sql
-- migração 00XX_rag_chunks_authority
ALTER TABLE chunks ADD COLUMN authority_tier SMALLINT NOT NULL DEFAULT 4;
ALTER TABLE chunks ADD COLUMN provenance JSONB;  -- opcional em v1, ver abaixo
CREATE INDEX chunks_soul_authority_idx ON chunks (soul, authority_tier);
```

```ts
// packages/memory/src/authority.ts (novo)
export enum AuthorityTier {
  SISTEMA_OFICIAL = 1,      // ERP, banco transacional, fonte de sistema
  POLITICA_VIGENTE = 2,     // documento de política com versão ativa
  DOCUMENTO_VALIDADO = 3,   // ata assinada, contrato, doc revisado
  COMUNICACAO_INFORMAL = 4, // chat, e-mail solto, upload self-service sem classificação
}

// v1: só o essencial. Campos temporais (validFrom/validUntil, política vigente
// vs. superada) e detecção de conflito ficam para um ADR próprio (§8).
export interface SourceProvenance {
  authorityTier: AuthorityTier;
  sourceSystem: string;   // ex. "erp-financeiro", "upload:conta", "slack-#geral"
  ingestedBy: string;     // pipeline ou identidade que carimbou o tier
  ingestedAt: string;     // ISO
}
```

`NOT NULL DEFAULT 4` é proposital: fonte sem proveniência declarada nunca herda autoridade alta por omissão — **fail-closed**, mesmo princípio de `authorizeAgentSoul`.

### 2.2 — Filtro por autoridade no retrieval (código, não prompt)

```ts
// packages/memory/src/rag-chain.ts
export interface RetrievalPolicy {
  /** Valor NUMÉRICO máximo de tier aceito. maxTier = 2 → aceita tiers 1 e 2
   *  (SISTEMA_OFICIAL + POLITICA_VIGENTE), exclui 3 e 4. */
  maxTier: AuthorityTier;
}

/** Config por soul/domínio — NÃO por prompt. Ver §5 e §7 (owner de governança). */
export function resolveRetrievalPolicy(soul: SoulConfig, queryIntent?: string): RetrievalPolicy;

// retrieveContext ganha `policy` e adiciona `AND authority_tier <= $maxTier`
// à query. Chunks acima do teto NUNCA entram no array retornado.
```

Ponto crítico: `COMUNICACAO_INFORMAL` não é "desencorajada por instrução" — é **excluída da query** antes do array de chunks existir na memória do processo que monta o prompt. Testável com assert direto:

```ts
expect(chunks.every((c) => c.authorityTier <= policy.maxTier)).toBe(true);
```

Default sensato: sem `resolveRetrievalPolicy` configurada para a soul, `maxTier = 4` (comportamento atual, nada muda). Souls que respondem sobre política financeira/fiscal/jurídica recebem `maxTier <= 2` por config explícita.

### 2.3 — Recusa em conflito de mesmo tier — DIFERIDO (depende de spike)

Quando o filtro de 2.2 não resolve — porque o conflito está **dentro do mesmo tier** (duas políticas oficiais discordando) — o sistema não deve sintetizar. Mas a detecção depende de resolver **`topicKey`**: normalizar "limite de alçada" ≈ "aprovação de despesa" ≈ "teto para aprovação" ao mesmo assunto é ele próprio um problema de classificação, e não pode ser o LLM sem verificação determinística por trás (mesma recursão).

**Antes de especificar 2.3, um spike** (ver §8) precisa responder: `topicKey` sai de (a) chave manual por documento no ingest, (b) extração de entidade + valor numérico com regra, ou (c) classificação com um segundo passe verificável. Sem essa resposta, 2.3 é aspiracional.

Quando existir, o comportamento **reusa a infraestrutura de "evidência insuficiente"** já pronta (`rag-confidence.ts`), não um caminho paralelo: o handler não chama o provider para sintetizar sobre o trecho em conflito, devolve a resposta estruturada de recusa **com as duas fontes + proveniência + timestamps**, e grava na fila de revisão humana. `status` distinto de "não encontrado" (ver Risco em §4).

### 2.4 — Proveniência no ingest e o caso do upload self-service (FM1)

O v1 vive ou morre da **regra de origem** que carimba o tier, porque quase todo conteúdo hoje entra sem classificação:

| Origem | Tier no ingest |
|---|---|
| Conectores de sistema (ERP, ADO, etc.) | 1 — carimbado pelo pipeline do conector |
| Ingest de documento de política com processo de aprovação | 2 — carimbado por quem aprova/ingere |
| Upload de operador (token admin) com pasta/nomeação convencionada | 3 — regra de path (`sources/validado/**` → 3), senão 4 |
| **Upload self-service (conta, FM1 — `POST /souls/:id/upload`)** | **4 sempre**, sem exceção em v1 |

O upload self-service é o buraco: `packages/daemon/src/extract.ts` + `routes/memory.ts` gravam tudo em `sources/uploads/` (o binário e o sidecar `.md`) sem canal para tier > 4. Um contrato em PDF e um export de Slack entram idênticos. Decisão v1: **todo upload self-service é `COMUNICACAO_INFORMAL` (4)**. Elevar tier de conteúdo self-service exige ação do operador (admin), nunca o próprio usuário — senão o mecanismo inteiro perde sentido (Risco em §4). Uma dica de "tipo de documento" no picker do friendly, com o operador confirmando, fica como trabalho futuro (§8).

Só pipelines de sistema e ingest com processo de aprovação podem carimbar tier 1/2. Isso precisa ser controle de código no ponto de ingestão, não convenção.

## §3. Consequências

**Positivas:**
- Precedência normativa deixa de depender de sampling do modelo; vira `WHERE` clause testável.
- Fila de revisão para conflitos same-tier (quando 2.3 existir) gera trilha de auditoria por construção.
- Reusa infra existente: `RAG_INJECTION_MODO`, audit trail de retrieval, e o modo "evidência insuficiente" do `rag-confidence.ts`.
- v1 (2.1+2.2+2.4) é incremental e reversível: sem `resolveRetrievalPolicy` configurada, o comportamento é idêntico ao de hoje.

**Negativas / trade-offs:**
- Toda fonte precisa de `authority_tier` no ingest. Conteúdo já indexado assume tier 4 (mais restritivo) até reclassificação — retrofit é manual ou por regra de origem que também precisa de revisão.
- `resolveRetrievalPolicy` introduz uma tabela de config domínio→tier que alguém mantém (não é zero-manutenção).
- Souls com `maxTier <= 2` podem passar a responder "não encontrado" onde hoje respondem (com base em fonte informal). É o comportamento desejado, mas muda a taxa de resposta — medir antes de ligar por padrão em qualquer soul.

## §4. Riscos

- **Fail-open na migração:** se `authority_tier` entrar como `NULL` em vez de 4, conteúdo sem proveniência vaza como alta autoridade. Mitigação: `NOT NULL DEFAULT 4` + teste de regressão dedicado que insere chunk sem tier e assere `= 4`.
- **Bypass por reclassificação:** se qualquer ingest puder setar `authorityTier = 1`, o mecanismo perde sentido. Mitigação: carimbo de tier 1/2 só em pipelines de sistema / ingest com aprovação, no código — o upload self-service é hard-coded em 4 (§2.4).
- **"Não encontrado" vs. "recusado por conflito":** a resposta ao usuário final precisa distinguir os dois casos com clareza, ou o suporte do cliente trata recusa como bug. `status` estruturado distinto + copy revisada.
- **Falsos positivos em 2.3** (quando existir): dois chunks parecem conflitar mas são de escopos diferentes (unidades distintas). Precisa de `scope` no `topicKey` — outra razão para o spike vir antes.

## §5. Pendências / Perguntas em aberto

- [ ] **Spike de `topicKey`** (bloqueia 2.3) — ver §8.
- [ ] Quem popula `resolveRetrievalPolicy` por soul/domínio — config estática no onboarding do cliente, ou revisão periódica? Owner? (§7)
- [ ] Fila de revisão humana para conflitos — reusar a tabela do roadmap "memory provenance + review queue", ou criar dedicada?
- [ ] Regra de path para tier 3 em upload de operador — convenção de pasta (`sources/validado/**`)? metadado no upload?
- [ ] `provenance JSONB` em v1: gravar já (mesmo com poucos campos) ou só a coluna `authority_tier` e adiar o JSONB?

## §6. Dependências e progresso

Não iniciado. **As dependências citadas na versão anterior deste ADR já não valem:**

- ~~"Fase 0: refactor de `handleChat` (640 linhas) e `tools/src/index.ts` (1859 linhas)"~~ — feito na Onda 3e (2026-09-04). Hoje: `packages/daemon/src/routes/chat.ts` = 22 linhas (dividido em módulos + `promptPipeline.ts`), `packages/tools/src/index.ts` = 363 linhas. O filtro de tier já pode nascer isolado e testável.
- ~~"Config centralization (~58 `process.env` → `loadConfig` + zod)"~~ — a Onda 3d decidiu **não** migrar as leituras single-site sem bug motivador. `resolveRetrievalPolicy` deve seguir o padrão vigente do repo (env var + `loadConfig` onde já existe), não esperar uma migração que não vai acontecer.

**Dependências reais:**
- Migração `00XX_rag_chunks_authority` (`packages/core/src/migrations.ts` — caminho sensível, exige paper trail; este ADR serve).
- `retrieveContext` (`rag-chain.ts`) aceitar `policy` e propagar o `WHERE` — mudança localizada.
- Regra de origem no ingest: `indexer.ts` (`indexFile`) e o handler de upload (`routes/memory.ts`) passam o tier ao gravar o chunk.

## §7. RACI (pendente — ação humana)

| Papel | Responsável |
|---|---|
| Owner de negócio (aprova a tabela domínio→tier) | — pendente |
| Owner de risco/governança | — pendente |
| Aprovador técnico | — pendente |
| Implementação | — pendente |

## §8. Escopo — v1 vs. depois (YAGNI)

**v1 (shippável, sem spike):**
- `authority_tier SMALLINT NOT NULL DEFAULT 4` + índice (§2.1).
- Regra de origem no ingest, com upload self-service = 4 sempre (§2.4).
- `resolveRetrievalPolicy` + `AND authority_tier <= $maxTier` no `retrieveContext` (§2.2), default `maxTier = 4` (no-op até config por soul).
- Testes: chunk sem tier → 4; `chunks.every(c => c.authorityTier <= policy.maxTier)`.

**Depois (cada um seu spike/ADR):**
- **Detecção de conflito same-tier (§2.3)** — precede de spike de `topicKey`.
- **Validade temporal** (`validFrom`/`validUntil`, política vigente vs. superada) — ADR próprio; é uma feature diferente de "autoridade".
- **Classificação de intenção de query** (o `queryIntent` de `resolveRetrievalPolicy`) — hoje pode ser regra por soul; automatizar exige o mesmo cuidado determinístico do §2.3.
- **UI de tipo de documento no upload friendly** com confirmação do operador para elevar tier.
