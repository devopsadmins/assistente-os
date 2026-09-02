# Plano: Arquitetura Departamental — Skills + MCPs no Assistente OS

> Gerado em 2026-09-01. Atualizado em 2026-09-01 com Fase 2.5 (Gestão de Contexto).

---

## 1. Visão Geral

Estruturar o Assistente OS com **7 souls departamentais nativas**, cada uma com:
- **Skills procedurais** (Markdown, injeção dinâmica via matcher híbrido)
- **MCP Tools namespaced** (tools tipadas, autorizadas via Zero Trust allowlist)

| Departamento | Soul ID | Foco Principal |
|--------------|---------|----------------|
| Fiscal / Tributário | `fiscal` | Apuração, obrigações acessórias, validações NF-e/SPED |
| DP / RH | `dp_rh` | Folha, eSocial, rescisões, férias, benefícios |
| Financeiro | `financeiro` | Conciliação, fluxo de caixa, contas a pagar/receber |
| Compras | `compras` | Homologação, cotação, OC, recebimento, contratos |
| Vendas | `vendas` | Qualificação, proposta, negociação, pós-venda, CRM |
| TI | `ti` | Incidentes, changes, backup, segurança, licenças, cloud |
| Customer Success | `cs` | Onboarding, health score, renovação, SLA, base conhecimento |

---

## 2. O que Já Existe (Suporta Nativamente)

| Conceito | Implementação Atual |
|----------|---------------------|
| Souls departamentais | `soul_create` + pasta `~/.assistant-os/souls/<id>/` |
| Skills dinâmicas | `scanSkillDirs` + `matchSkills` (léxico + embedding) |
| MCP Tools | `TOOLS[]` em `packages/tools/src/index.ts` |
| Zero Trust / Allowlist | `agent.permissions.skills` + `agent.permissions.tools` |
| Isolamento de dados | `memory.db` por soul + `kernel.db` global |

---

## 3. Fases de Implementação

### Fase 1: Estrutura Base das Souls (Script Automatizado)
```bash
# Script: scripts/setup-departments.ts
# Para cada departamento: dry-run → valida → executa
os soul create fiscal \
  --purpose "Especialista fiscal/tributário: apuração, obrigações acessórias, validações" \
  --skills "conferencia-tributaria,validacao-nfe,calculo-retencoes,sped-contribuicoes" \
  --capabilities "memory:*,graph_list,action_execute" \
  --provider zen-sousa --model nemotron-3-ultra-free
```
**Entregável:** 7 pastas em `~/.assistant-os/souls/` com `config.json` populado.

---

### Fase 2: Skills Base por Departamento (Templates Markdown)

**Localização:** `~/.assistant-os/souls/<depto>/skills/<skill>.md`  
**Formato:** Frontmatter válido + body com sections padrão

```markdown
---
name: conferencia-tributaria
description: Checklist e regras para conferir apuração de impostos (ICMS, IPI, PIS/COFINS, IRPJ/CSLL)
keywords: ["apuração", "impostos", "conferência", "validação", "DARF", "GARE"]
tools: ["memory_search", "action_execute"]
---
# Procedimento de Conferência Tributária
## 1. Identificar regime tributário da empresa (contexto.md)
## 2. Validar CFOP x CST x CSOSN por operação
## 3. Conferir bases de cálculo vs. documentos fiscais
...
```

**Skills sugeridas por departamento (4-6 cada):**

| Departamento | Skills |
|--------------|--------|
| **Fiscal** | `conferencia-tributaria`, `validacao-nfe`, `calculo-retencoes`, `sped-contribuicoes`, `certidoes-negativas`, `regimes-especiais` |
| **DP/RH** | `fechamento-folha`, `rescisao-trabalhista`, `esocial-eventos`, `ferias-13o`, `beneficios-vt-vr`, `medicina-ocupacional` |
| **Financeiro** | `conciliação-bancaria`, `fluxo-caixa`, `contas-pagar-receber`, `emissao-boletos`, `relatorios-gerenciais`, `auditoria-interna` |
| **Compras** | `homologacao-fornecedor`, `cotacao-comparativo`, `ordem-compra`, `recebimento-nota`, `gestao-contratos`, `compliance-fornecedor` |
| **Vendas** | `qualificacao-lead`, `proposta-comercial`, `negociacao-contrato`, `pos-venda-onboarding`, `metas-comissoes`, `crm-higienizacao` |
| **TI** | `gestao-incidentes`, `change-management`, `backup-restore`, `seguranca-acesso`, `licencas-software`, `infra-cloud` |
| **CS** | `onboarding-cliente`, `health-score`, `renovacao-churn`, `escala-suport`, `base-conhecimento`, `sla-monitoramento` |

---

### Fase 2.5: Tiered Context Loading + Auditoria Periódica de Contexto

> **Motivação:** Hoje `soul_context` carrega 5 arquivos inteiros (`perfil.md`, `contexto.md`, `licoes.md`, `pessoas.md`, `soul.md`) — polui janela de contexto, aumenta custo/latência. Pastas `sessoes/`, `licoes.md`, `contexto.md` crescem indefinidamente sem rota de limpeza.

#### A. `abstract.md` — Índice de 1 Linha por Seção (Tier 1)

**Localização:** `~/.assistant-os/souls/<depto>/abstract.md` (auto-gerado, regenerado na auditoria)

**Formato:**
```markdown
# abstract.md — Soul: fiscal
## perfil.md
- Regime: Lucro Real | Segmento: Indústria | UF: SP
## contexto.md
- ERPs: Sankhya, Domínio | Certificados: A1, A3 | Prazos: SPED até dia 15
## licoes.md (últimas 5)
- 2026-08-15: CST 060 em saída interestadual exige FCI
- 2026-08-10: DARF 5952 (IRPJ/CSLL) vence dia 31
## sessoes/ (últimas 3)
- 2026-08-20: Reunião com contador — fechamento jul/26
- 2026-08-18: Validação NF-e entrada interestadual
## decisoes/ (ativas)
- 2026-07-01: Adotar regime especial ICMS-ST para cliente X
## skills/ (habilitadas)
- conferencia-tributaria, validacao-nfe, calculo-retencoes
```

**Uso no `soul_context` (MCP Tool):**
1. Lê `abstract.md` primeiro (≈200 tokens) — **Tier 1: visão geral**
2. Se `args.detail === true` OU query específica → lê arquivos completos — **Tier 2: detalhe sob demanda**
3. Evita carregar `contexto.md` + `licoes.md` inteiros no prompt padrão

---

#### B. Skill `auditoria-contexto` (Executável via Agenda/Mission Runner)

**Localização:** `~/.assistant-os/souls/<depto>/skills/auditoria-contexto.md`

**Frontmatter:**
```markdown
---
name: auditoria-contexto
description: Rotina periódica: arquiva notas antigas, atualiza abstract.md, mantém contexto enxuto
keywords: ["auditoria", "contexto", "limpeza", "arquivamento", "abstract"]
tools: ["memory_search", "action_execute", "soul_anotar"]
---
```

**Procedimento (executar quinzenal/mensal via `agenda_add`):**
1. **Varrer `licoes.md`** → itens > 90 dias sem reincidência → mover para `licoes-arquivo/YYYY-MM.md`
2. **Varrer `sessoes/`** → reuniões > 180 dias → compactar em `sessoes-arquivo/YYYY-QN.md` (resumo + decisões)
3. **Varrer `contexto.md`** → seções obsoletas (ERP trocado, certificado vencido) → mover para `contexto-historico.md`
4. **Regenerar `abstract.md`** com estado atual (1 linha por seção)
5. **Registrar em `licoes.md`**: "Auditoria de contexto executada — X itens arquivados, abstract.md atualizado"

**Agendamento sugerido (por soul):**
```bash
# Quinzenal para fiscal/dp_rh (alta rotatividade legislativa)
os agenda add --soul fiscal --title "Auditoria de contexto" --body "Executar skill auditoria-contexto" --due_at "2026-09-15T02:00:00"
# Mensal para demais
os agenda add --soul ti --title "Auditoria de contexto" --body "Executar skill auditoria-contexto" --due_at "2026-10-01T02:00:00"
```

---

#### C. Integração no `soul_context` (MCP Tool — `packages/tools/src/index.ts`)

Modificar `case "soul_context":`:

```typescript
case "soul_context": {
  const soul = this.requireSoul(args.soul);
  if ("error" in soul) throw new Error(soul.error);
  authorizeTool(this.config.home, soul.id, name);

  // Tier 1: abstract.md (leve, ~200 tokens)
  const abstractPath = join(this.config.home, "souls", soul.id, "abstract.md");
  let contextParts: string[] = [];
  if (existsSync(abstractPath)) {
    contextParts.push(`# Resumo da Soul (abstract.md)\n${readFileSync(abstractPath, "utf8")}`);
  }

  // Tier 2: arquivos completos somente se detail=true
  const detail = args.detail === true;
  const files = detail ? ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"] : [];

  for (const f of files) {
    const p = join(this.config.home, "souls", soul.id, f);
    if (existsSync(p)) contextParts.push(`# ${f}\n\n${readFileSync(p, "utf8")}`);
  }

  return { soul: soul.id, context: contextParts.join("\n\n"), abstractUsed: existsSync(abstractPath) };
}
```

---

#### D. Decisões para Confirmar (Fase 2.5)

| Ponto | Opção A (Recomendada) | Opção B |
|-------|----------------------|---------|
| **Onde fica `abstract.md`?** | Raiz da soul (`~/.assistant-os/souls/<id>/abstract.md`) | Subpasta `skills/` ou `manifest/` |
| **Frequência auditoria** | Quinzenal (fiscal, dp_rh) / Mensal (demais) | Configurável por soul via `config.json` |
| **Regeneração `abstract.md`** | Skill `auditoria-contexto` faz tudo | Função utilitária separada `regenerateAbstract(soulId)` |
| **`soul_context` default** | `detail=false` (só abstract) — breaking change | `detail=false` + parâmetro opcional `includeFull: true` |

---

### Fase 3: MCP Tools Namespaced (Refatoração `packages/tools/src/index.ts`)

**Padrão de nomes:** `<dominio>_<acao>`
```typescript
const FISCAL_TOOLS = [
  "fiscal_consultar_cnpj",
  "fiscal_validar_xml_nfe",
  "fiscal_calcular_juros_selic",
  "fiscal_emitir_darf",
  "fiscal_consultar_certidao",
];

const RH_TOOLS = [
  "rh_simular_rescisao",
  "rh_validar_layout_esocial",
  "rh_calcular_ferias",
  "rh_gerar_holerite",
];

const FIN_TOOLS = [
  "fin_conciliar_extrato_ofx",
  "fin_emitir_boleto",
  "fin_consultar_saldo_banco",
];
```

**Autorização:** `agent.permissions.tools: ["fiscal_*", "rh_simular_*"]` (glob patterns já suportados).

---

### Fase 4: Orquestração Interdepartamental (v2, Opcional)

Criar soul `gestao` (orquestradora):
- Skills: `roteamento-interdepartamental`, `consolidador-relatorios`
- Usa `soul_chat` para delegar às souls especialistas
- Exemplo: "Impacto do reajuste no fluxo de caixa" → `dp_rh` (custo) + `financeiro` (projeção)

---

## 4. Decisões Pendentes (Para Alinhamento)

| Ponto | Opção A (Recomendada) | Opção B |
|-------|----------------------|---------|
| **Onde ficam skills base?** | Global (`~/.assistant-os/skills/`) — compartilhadas, versionadas no repo | Per-soul (copiadas na criação) |
| **Criação das souls** | Script automatizado `npm run setup:departments` | CLI manual `os soul create` 7x |
| **MCPs** | Monorepo único (`packages/tools`) | Pacotes separados (`@assistente-os/mcp-fiscal`, etc) |
| **Conteúdo inicial skills** | Template mínimo + 1 skill exemplo por depto | Conteúdo completo (exige SME fiscal/RH) |

---

## 5. Próximos Passos (Se Aprovado)

1. Criar `scripts/setup-departments.ts` (dry-run → valida → executa 7 souls)
2. Gerar skills template com frontmatter correto + body esqueleto (inclui `auditoria-contexto`)
3. Atualizar `packages/tools/src/index.ts` com prefixos de namespace + `soul_context` tiered
4. Teste de integração:
   ```bash
   os skill list --soul fiscal
   os skill show conferencia-tributaria --soul fiscal
   os skill show auditoria-contexto --soul fiscal
   ```

---

## 6. Arquivos a Criar/Modificar

### Novos
- `scripts/setup-departments.ts` — script de bootstrap das 7 souls
- `~/.assistant-os/souls/<depto>/skills/*.md` — 30-40 skills templates (inclui `auditoria-contexto`)
- `~/.assistant-os/souls/<depto>/abstract.md` — gerado na primeira auditoria
- `docs/departamentos-skills-mcp.md` — este documento

### Modificados
- `packages/tools/src/index.ts` — adicionar prefixos namespace nas tools + `soul_context` tiered loading
- `packages/core/src/skills.ts` — (se necessário) ajustar matcher para skills globais

---

## 7. Critérios de Aceite

- [ ] 7 souls criadas com `config.json` válido
- [ ] `os skill list --soul <depto>` lista 4-6 skills por departamento
- [ ] `os skill show <skill> --soul <depto>` renderiza frontmatter + body
- [ ] **`os skill show auditoria-contexto --soul fiscal` existe e renderiza**
- [ ] Tools MCP com prefixo `<dominio>_` funcionam via `tools/list` filtrado por allowlist
- [ ] **`abstract.md` existe em todas as 7 souls departamentais**
- [ ] **`soul_context` com `detail=false` retorna só `abstract.md` (< 500 tokens)**
- [ ] **`soul_context` com `detail=true` retorna arquivos completos (compatibilidade)**
- [ ] **Auditoria executa sem erro e arquiva itens em pastas `*-arquivo/`**
- [ ] `npm run build && npm run typecheck` passa sem erros