/**
 * Canvas de Arquitetura por soul (T2.3 de `docs/ARCHITECTURE-REVIEW.md`).
 *
 * Um "AI Architecture Decision Canvas" DESCRITIVO e GERADO — os blocos
 * determinísticos vêm de `config.json` da soul + fatos do sistema; só os campos
 * de decisão humana ficam em branco. Não é o template aspiracional que a
 * revisão criticou (escalonamento p/ Claude, cache semântico "sempre ligado",
 * HITL via `interrupt()`): aqui o vocabulário é o real.
 *
 * `os soul <id> canvas [--write]`.
 */
import type { Soul } from "./souls.js";
import { CAPABILITY_CATALOG, capabilityRiskLevel, type RiskLevel } from "./policy.js";
import {
  resolveAllowedTools,
  resolveEffectiveGuardrails,
  resolveAutonomy,
  resolveApprovalPolicy,
  resolveMemoryPolicy,
  resolveConnectors,
  matchesToolPattern,
  DEFAULT_GLOBAL_GUARDRAILS,
} from "./types/agent.js";

export interface CanvasSystemFacts {
  routerTiers: string[];
  ragRerankMode: string;
  ragInjectionMode: string;
  ragHnswEfSearch: number;
  /** RAG_SEMANTIC_CACHE ligado? */
  semanticCache: boolean;
}

const LEVEL_RANK: Record<RiskLevel, number> = { L1: 1, L2: 2, L3: 3 };

/** Maior nível de risco que um pattern da allowlist consegue alcançar no catálogo. */
export function maxLevelForPattern(pattern: string): RiskLevel | undefined {
  const direct = capabilityRiskLevel(pattern);
  let best: RiskLevel | undefined = direct;
  for (const entry of CAPABILITY_CATALOG) {
    if (matchesToolPattern(pattern, entry.pattern)) {
      if (!best || LEVEL_RANK[entry.level] > LEVEL_RANK[best]) best = entry.level;
    }
  }
  return best;
}

/** Agentic = a allowlist resolvida alcança alguma tool L3 (efeito estrutural/externo). */
export function isAgenticSoul(soul: Soul): { agentic: boolean; reasons: string[] } {
  const patterns = resolveAllowedTools(soul.config.agent);
  const l3 = patterns.filter((p) => maxLevelForPattern(p) === "L3");
  const reasons: string[] = [];
  if (l3.length > 0) reasons.push(`allowlist alcança tools L3: ${l3.join(", ")}`);
  if (patterns.includes("*")) reasons.push("allowlist tem curinga total (`*`)");
  return { agentic: reasons.length > 0, reasons };
}

function bullet(label: string, value: string | number | undefined | null): string {
  return `- **${label}:** ${value === undefined || value === null || value === "" ? "—" : value}`;
}

/** Markdown do canvas. Puro — sem I/O. */
export function buildSoulCanvas(soul: Soul, facts: CanvasSystemFacts): string {
  const c = soul.config;
  const agent = c.agent;
  const tools = resolveAllowedTools(agent);
  const guard = resolveEffectiveGuardrails(DEFAULT_GLOBAL_GUARDRAILS, agent);
  const autonomy = resolveAutonomy(agent);
  const approval = resolveApprovalPolicy(agent);
  const mem = resolveMemoryPolicy(agent);
  const connectors = resolveConnectors(agent);
  const { agentic, reasons } = isAgenticSoul(soul);

  const toolRows = tools
    .map((p) => {
      const lvl = maxLevelForPattern(p);
      return `| \`${p}\` | ${lvl ?? "?"} |`;
    })
    .join("\n");

  const l3Tools = tools.filter((p) => maxLevelForPattern(p) === "L3");

  return [
    `# Canvas de Arquitetura — soul \`${soul.id}\``,
    "",
    "> Gerado por `os soul " + soul.id + " canvas`. Blocos **auto** vêm de " +
      "`config.json` + fatos do sistema; blocos **decisão** ficam em branco para " +
      "você preencher. Ver `docs/ARCHITECTURE-CANVAS-TEMPLATE.md`.",
    "",
    `**Agentic:** ${agentic ? "sim" : "não"}${reasons.length ? ` (${reasons.join("; ")})` : ""}. ` +
      (agentic
        ? "O canvas completo se aplica."
        : "Sem tools L3 nem curinga — o canvas é opcional; os blocos de decisão importam menos."),
    "",
    "## 1. Identidade  · auto",
    bullet("nome", c.name),
    bullet("descrição", c.description),
    bullet("provider", c.provider ?? agent?.provider),
    bullet("modelo (chat)", c.models?.chat ?? agent?.model),
    bullet("modelo (embed)", c.models?.embed),
    "",
    "## 2. Recuperação (RAG)  · auto",
    "- **Busca:** pgvector(768) HNSW (`ef_search=" + facts.ragHnswEfSearch + "`) → " +
      "fallback ILIKE literal quando não há vetor/resultado.",
    "- **Cache:** exato (sha1 query+params, TTL 60s) + semântico " +
      (facts.semanticCache ? "**ligado**" : "desligado (`RAG_SEMANTIC_CACHE`)") + ".",
    bullet("reranker (`RAG_RERANK`)", facts.ragRerankMode),
    bullet("screening de injection (`RAG_INJECTION_MODO`)", facts.ragInjectionMode),
    bullet("threshold de relevância da soul", guard.ragRelevanceThreshold),
    "",
    "## 3. Roteamento  · auto",
    "- **Tiers:** `" + facts.routerTiers.join("` → `") + "`" +
      " (+ `langgraph` quando habilitado) — fallback por sonda de disponibilidade.",
    "- **ExecutionMode:** `fast` / `pro` decidido por tamanho e keywords do prompt " +
      "(`orchestrator/router.ts`). **Não há** cascata por confiança.",
    "",
    "## 4. Tools & níveis de risco  · auto",
    "| pattern (allowlist) | nível máx. |",
    "|---|---|",
    toolRows,
    "",
    l3Tools.length
      ? "> ⚠️ L3 (efeito estrutural/externo/irreversível): " + l3Tools.map((t) => `\`${t}\``).join(", ")
      : "> Sem tools L3.",
    "",
    "## 5. Autonomia & aprovação  · auto",
    bullet("autonomy", autonomy + "  (suggest = só propõe · ask = pede confirmação · auto = executa)"),
    bullet("approvalPolicy (sempre confirmam)", approval.length ? approval.map((p) => `\`${p}\``).join(", ") : "—"),
    "- **Guardian:** promoção de Regra de Ouro exige código OTP por Telegram (`golden-rules.ts`).",
    "",
    "## 6. Guardrails  · auto",
    bullet("maxTurns / sessão", guard.maxTurns),
    bullet("maxIterations (loop agentic)", guard.maxIterations),
    bullet("dailyLimit (config.json)", c.dailyLimit),
    bullet("dailyLimitTokens (guardrails)", guard.dailyLimitTokens),
    bullet("allowedOrigins (browser/HTTP)", guard.allowedOrigins?.join(", ")),
    bullet("connectors MCP autorizados", connectors.length ? connectors.join(", ") : "—"),
    "",
    "## 7. Dados & memória  · auto",
    bullet("classificação", mem.classification),
    bullet("retenção", mem.retention),
    "- Isolamento por soul: chunks/grafo/sessões/custos filtrados por `soul` (suíte cross-tenant).",
    "",
    "## 8. Auditoria  · auto",
    "- Trilha: `logFullAuditEntry` → `souls/" + soul.id + "/sessoes/<data>.md`.",
    "- Manifesto: `os manifest` — hash determinístico inclui `systemPromptHash` da soul, " +
      "o Prompt Garden e a config de RAG.",
    "- Métricas: Prometheus `aos_*` (`aos_tokens_total`, `aos_llm_latency_seconds`, " +
      "`aos_rag_cache_total`, `aos_rag_rerank_seconds`).",
    "",
    "## 9. Decisões (preencher à mão)  · decisão",
    "- **Quais ações desta soul exigem aprovação humana, na prática, e por quê:**",
    "- **Fallback esperado** quando o tier primário cai / o RAG não acha nada:",
    "- **Custo do erro** por classe de ação (irreversível? financeiro? reputacional?):",
    "- **As 3 perguntas** (curso): existe regra finita cobrindo >90% dos casos? · " +
      "o erro é caro/irreversível? · o comportamento depende de contexto?",
    "",
  ].join("\n");
}
