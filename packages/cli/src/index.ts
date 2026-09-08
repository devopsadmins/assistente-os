#!/usr/bin/env node
import {
  loadConfig,
  listSouls,
  getSoul,
  getActiveSoul,
  setActiveSoul,
  getPool,
  isDbHealthy,
  closePool,
  runMigrations,
  sumCostBySoul,
  recentCalls,
  migrateAlmas,
  importSegundoCerebro,
  printMigrationSummary,
  buildExecutionManifest,
  anotar,
  registrarLicao,
  decidir,
  addAgendaItem,
  getAgendaItems,
  listPendingRules,
  approveRule,
  rejectRule,
  resendApprovalCode,
  getUsageSummary,
  getTrace,
  type UsageSummaryFilters,
  buildSoulCanvas,
  mergeCanvasDecisions,
  canvasDrift,
  type CanvasSystemFacts,
  type AssistenteOsConfig,
  acquireSharedLock,
} from "@assistente-os/core";
import {
  indexDirectory,
  search,
  indexStats,
  listEntities,
  listRelations,
  listObservations,
  graphStats,
  getEmbedder,
  listDocumentPaths,
  getDocumentText,
  getDocumentExtractionStatus,
  setDocumentExtractionState,
  segmentDocumentText,
  processExtractionJob,
  graphDedupConfig,
} from "@assistente-os/memory";
import { startDaemon } from "@assistente-os/daemon";
import { join } from "node:path";
import { createFullBackup, pruneOldBackups } from "./backup.js";
import { runSkillCommand } from "./skill.js";
import { runRagCommand, isIndexStale } from "./rag.js";
import { runPromptCommand } from "./prompt.js";
import { runDiscriminatorCommand } from "./discriminator.js";
import { requireArg, parseEnumArg, parsePort, parseDateArg } from "./argSchema.js";

const BACKUP_RETENTION_DAYS = 7;

/** Fatos do sistema para o Canvas de Arquitetura (`os soul <id> canvas`). */
function canvasFacts(config: AssistenteOsConfig): CanvasSystemFacts {
  return {
    routerTiers: config.routerTiers,
    ragRerankMode: config.ragRerankMode,
    ragInjectionMode: config.ragInjectionMode,
    ragHnswEfSearch: config.ragHnswEfSearch,
    semanticCache: /^(on|1|true)$/i.test(process.env.RAG_SEMANTIC_CACHE ?? ""),
    langgraphEnabled: process.env.LANGGRAPH_ENABLED === "true",
  };
}

const HELP = `
os — terrasIA

Uso:
  os status                          mostra home, souls e modelo padrão
  os souls                           lista as souls
  os soul <id>                       mostra config e arquivos de uma soul
  os soul <id> ativa                 define a soul ativa
  os soul <id> canvas [--write]      gera o Canvas de Arquitetura da soul (stdout ou ARCHITECTURE_CANVAS.md)
  os chat <soul> <prompt...>         roda opencode run headless na soul
  os migrate <src>                   migra almas do SLC-OS para <home>/souls
  os import-sc <src>                 importa Segundo Cérebro para <home>/souls/segundo-cerebro
  os memory <soul> index             indexa a pasta da soul (md/txt) no memory.db
  os memory <soul> search <q>        busca RAG (literal se Ollama ausente)
  os memory <soul> status            contagem de chunks e grafo
  os memory backfill-entities [--soul <id>] [--dry-run] [--limit N] [--model <nome>] [--force]
                                     extrai entidades/relações do que já está indexado no RAG
                                     (por documento, não por chunk); --model sobrescreve só
                                     pra esta run (não mexe no OLLAMA_CHAT_MODEL do chat ao
                                     vivo) — ver docs/ROADMAP.md (OPS-02)
  os rag eval [<soul>] [--rerank …] [--hybrid] [--min-hit1 0.7] [--min-refusal 0.8] [--faithfulness] [--record]
  os rag eval [<soul>] --history     evolução dos runs de eval (hit@k / refusal / faithfulness)
                                     avalia recuperação: hit@k / MRR / recall@5
  os prompt list                     lista os prompts do Prompt Garden (id / versão / hash)
  os prompt show <id>                mostra o detalhe de um prompt do garden
  os graph <soul> list               lista entidades/relações/observações
  os costs                           resumo de custos
  os costs usage [--soul <id>] [--from <date>] [--to <date>]  resumo agregado de uso/tokens
  os trace <trace-id>                reconstrói um turno de chat (linha canônica + spans por estágio)
  os agenda add <soul> <título> [--due <iso>] [corpo...]
                                     agenda uma tarefa (soul "-" = nenhuma)
  os agenda list [pending|done|all]  lista itens da agenda (padrão: pending)
  os worktree create <taskId> [--base <branch>] [--soul <id>]  cria worktree isolada
  os worktree merge <taskId> [--target <branch>]               merge local + testes
  os worktree destroy <taskId>       destrói worktree e limpa refs git
  os worktree list                   lista worktrees ativas
  os guardian pending                lista propostas de regra aguardando aprovação
  os guardian approve <id> <código>  aprova uma proposta (código enviado por Telegram)
  os guardian reject <id> <código>   rejeita uma proposta
  os guardian resend <id>            gera e reenvia um novo código de aprovação
  os daemon [port]                   inicia o daemon REST+WS (padrão 4310)
  os voice                           inicia o pipeline de voz (VAD + STT + TTS)
  os backup                          gera um ZIP completo do perfil, RAG e conhecimento em
                                     ASSISTENTE_OS_BACKUP_DIR (padrão ~/.assistant-os-backups; retenção de 7 dias)
  os help                            mostra esta ajuda

Variáveis de ambiente: ASSISTENTE_OS_HOME (padrão ~/.assistant-os),
ASSISTENTE_OS_BACKUP_DIR (padrão ~/.assistant-os-backups),
OLLAMA_URL, OLLAMA_CHAT_MODEL, OLLAMA_EMBED_MODEL, AOS_HOST,
ASSISTENTE_OS_DAEMON_TOKEN, VOICE_ENABLED,
GUARDIAN_APPROVAL_CHAT_ID (chat id do Telegram que recebe códigos de aprovação do Guardian),
GUARDIAN_APPROVAL_TTL_HOURS (validade do código, padrão 24h).
`;

/** Tentativas por segmento dentro de uma única run síncrona do backfill —
 * conceito separado de MAX_EXTRACTION_ATTEMPTS da fila (esta rotina não usa
 * entity_extraction_queue, chama processExtractionJob direto). */
const BACKFILL_MAX_ATTEMPTS = 2;

interface BackfillFlags {
  soul?: string;
  dryRun: boolean;
  limit?: number;
  model?: string;
  /** Reprocessa mesmo documentos já `completed` — pra comparar configs (timeout,
   * ENTITY_EXTRACTION_MAX_INPUT_CHARS) no MESMO documento entre duas runs. */
  force: boolean;
}

function parseBackfillFlags(args: string[]): BackfillFlags {
  const flags: BackfillFlags = { dryRun: false, force: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--soul" && args[i + 1]) {
      flags.soul = args[++i];
    } else if (args[i] === "--dry-run") {
      flags.dryRun = true;
    } else if (args[i] === "--limit" && args[i + 1]) {
      flags.limit = Number(args[++i]);
    } else if (args[i] === "--model" && args[i + 1]) {
      flags.model = args[++i];
    } else if (args[i] === "--force") {
      flags.force = true;
    }
  }
  return flags;
}

/**
 * Extrai entidades/relações do que já está indexado no RAG (`chunks`), não só
 * de conversas (addObservation). Granularidade por documento (`path`), não
 * por chunk — 49.728 chunks viram ~1.355 documentos, 37x menos chamadas de
 * LLM. Sequencial de propósito: é a mesma instância Ollama local/LAN que o
 * poller do daemon (packages/daemon/src/entityExtraction.ts) já usa —
 * paralelizar agravaria os timeouts que motivaram o retry/timeout maior ali.
 * Bypassa `entity_extraction_queue` (chama processExtractionJob direto) pra
 * não competir com tráfego de chat ao vivo e ter progresso síncrono no
 * terminal. Idempotente via `document_extraction_state`: documentos já
 * `completed` são pulados (exceto com `--force`), então a run pode ser
 * interrompida (Ctrl-C) e retomada depois sem reprocessar.
 *
 * Segura um advisory lock compartilhado (`acquireSharedLock`) enquanto roda:
 * várias souls/processos de backfill convivem entre si sem se bloquear, mas
 * o poller do daemon (`packages/daemon/src/entityExtraction.ts`) pula seus
 * ticks enquanto qualquer backfill estiver ativo — evita a mesma contenção
 * de Ollama que motivou o processamento serial. Paralelismo *entre souls*
 * (ex.: dois backfills ao mesmo tempo) continua por conta de quem chama —
 * dados reais mostraram taxa de falha maior nesse caso (ver docs/ROADMAP.md),
 * então não é recomendado sem medir primeiro.
 */
async function runBackfillEntities(config: AssistenteOsConfig, args: string[]): Promise<void> {
  const flags = parseBackfillFlags(args);
  if (flags.soul && !getSoul(config.home, flags.soul)) {
    console.error(`soul não encontrada: ${flags.soul}`);
    process.exitCode = 1;
    return;
  }
  const pool = getPool(config.databaseUrl);
  const soulIds = flags.soul ? [flags.soul] : listSouls(config.home).map((s) => s.id);

  let candidateDocs = 0;
  let candidateSegments = 0;
  let processed = 0;
  let ok = 0;
  let failed = 0;
  const latenciesMs: number[] = [];
  const failuresByType = new Map<string, number>();

  const backfillLock = flags.dryRun ? null : await acquireSharedLock(pool);
  try {
    outer: for (const soulId of soulIds) {
      let paths: string[];
      try {
        paths = await listDocumentPaths(pool, soulId);
      } catch (err) {
        console.error(`${soulId}: falha ao listar documentos — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // Por soul, não por run inteira: um cache global por processo faria um
      // nome igual em duas souls diferentes ("João" em `main` e em
      // `investimentos`) colidir e vazar o canônico errado entre souls.
      const canonicalNameCache = new Map<string, string>();
      for (const path of paths) {
        let status: string | null;
        try {
          status = await getDocumentExtractionStatus(pool, soulId, path);
        } catch (err) {
          console.error(`${soulId}/${path}: falha ao consultar estado — ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if (status === "completed" && !flags.force) continue;

        if (flags.dryRun) {
          try {
            const text = await getDocumentText(pool, soulId, path);
            candidateDocs++;
            candidateSegments += segmentDocumentText(text).length;
          } catch (err) {
            console.error(`${soulId}/${path}: falha ao ler texto — ${err instanceof Error ? err.message : String(err)}`);
          }
          continue;
        }

        if (flags.limit !== undefined && processed >= flags.limit) break outer;

        // Um documento inteiro não deve derrubar a run inteira (horas de trabalho já
        // feito) por causa de um erro pontual — LLM ou conexão de banco instável no
        // meio de uma run longa. Falha aqui vira "failed" nesse documento só; a run
        // continua pro próximo (retomável depois via document_extraction_state).
        let docFailed = false;
        let lastError = "";
        let segmentCount = 0;
        try {
          const text = await getDocumentText(pool, soulId, path);
          const segments = segmentDocumentText(text);
          segmentCount = segments.length;
          for (const segment of segments) {
            let succeeded = false;
            for (let attempt = 0; attempt < BACKFILL_MAX_ATTEMPTS && !succeeded; attempt++) {
              try {
                const { usage } = await processExtractionJob(pool, { soul: soulId, body: segment }, {
                  ollamaUrl: config.ollamaUrl,
                  chatModel: flags.model ?? config.entityExtractionModel,
                  embedder: graphDedupConfig().embeddingEnabled ? getEmbedder() : undefined,
                  canonicalNameCache,
                });
                if (usage) latenciesMs.push(usage.latencyMs);
                succeeded = true;
              } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
                failuresByType.set(lastError, (failuresByType.get(lastError) ?? 0) + 1);
              }
            }
            if (!succeeded) {
              docFailed = true;
              break;
            }
          }
        } catch (err) {
          docFailed = true;
          lastError = err instanceof Error ? err.message : String(err);
          failuresByType.set(lastError, (failuresByType.get(lastError) ?? 0) + 1);
        }

        try {
          await setDocumentExtractionState(pool, soulId, path, docFailed ? "failed" : "completed", docFailed ? lastError : null);
        } catch {
          /* melhor esforço — não deixa um erro de estado derrubar a run */
        }
        docFailed ? failed++ : ok++;
        processed++;
        console.log(`[${processed}] ${soulId}/${path} — ${docFailed ? `falhou: ${lastError}` : `ok (${segmentCount} segmento(s))`}`);
      }
    }
  } finally {
    await backfillLock?.release();
  }

  if (flags.dryRun) {
    console.log(
      `dry-run: ${candidateDocs} documento(s) pendente(s) em ${soulIds.length} soul(s), ~${candidateSegments} segmento(s) de extração estimado(s) — nenhuma chamada de LLM feita`,
    );
    return;
  }
  console.log(`concluído: ${processed} documento(s) processado(s) — ${ok} ok, ${failed} falhou(aram)`);
  if (latenciesMs.length > 0) {
    const sum = latenciesMs.reduce((a, b) => a + b, 0);
    const min = Math.min(...latenciesMs);
    const max = Math.max(...latenciesMs);
    console.log(`latência LLM por chamada: média ${Math.round(sum / latenciesMs.length)}ms · min ${min}ms · max ${max}ms · n=${latenciesMs.length}`);
  }
  if (failuresByType.size > 0) {
    console.log("falhas por tipo:");
    for (const [message, count] of failuresByType) {
      console.log(`  ${count}x — ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const [cmd, ...args] = process.argv.slice(2);

  // Comandos que não tocam o banco não precisam de conectividade pra funcionar.
  // backup também entra na lista: o dump é feito pelo pg_dump (conexão própria),
  // e abrir pool aqui compete com o daemon por conexões do Postgres. discriminator
  // (SPEC-GR4) só fala com git + Zen/Ollama — sem isto, o job Discriminator do CI
  // (sem serviço Postgres, só build-and-test tem) crashava em ECONNREFUSED antes
  // de sequer chegar a julgar o diff (achado ao vivo, 2026-09-05).
  const NO_DB_COMMANDS = new Set(["help", "--help", "-h", "backup", "discriminator"]);
  if (cmd !== undefined && !NO_DB_COMMANDS.has(cmd)) {
    const applied = await runMigrations(getPool(config.databaseUrl));
    if (applied.length > 0) console.log(`migrações aplicadas: ${applied.join(", ")}`);
  }

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "status": {
      const souls = listSouls(config.home);
      const active = getActiveSoul(config.home);
      const dbOk = await isDbHealthy(getPool(config.databaseUrl));
      console.log(`home: ${config.home}`);
      console.log(`postgres: ${dbOk ? "ok" : "DEGRADED — /chat cai em modo Markdown-only (SPEC-HR1), sem sessão/RAG/limites"}`);
      console.log(`ollama: ${config.ollamaUrl} (chat: ${config.ollamaChatModel}, embed: ${config.ollamaEmbedModel})`);
      console.log(`degraus: ${config.routerTiers.join(" -> ")}`);
      console.log(`souls: ${souls.length} (ativa: ${active ?? "(nenhuma)"})`);
      return;
    }

    case "souls": {
      for (const soul of listSouls(config.home)) {
        const active = getActiveSoul(config.home) === soul.id ? " *" : "";
        console.log(`${soul.id}${active}  (${soul.config.description ?? "sem descrição"})`);
      }
      return;
    }

    case "soul": {
      const id = requireArg(args[0], "uso: os soul <id> [ativa | canvas [--write] | anota <txt> | licao <txt> | decide <titulo>]");
      if (id === null) return;
      const action = args[1];
      const soul = getSoul(config.home, id);
      if (!soul) {
        console.error(`soul não encontrada: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (action === "ativa") {
        setActiveSoul(config.home, id);
        console.log(`soul ativa: ${id}`);
        return;
      }
      if (action === "canvas") {
        const facts = canvasFacts(config);
        const md = buildSoulCanvas(soul, facts);
        if (args.includes("--write")) {
          const { writeFileSync, readFileSync, existsSync } = await import("node:fs");
          const out = join(soul.dir, "ARCHITECTURE_CANVAS.md");
          const prev = existsSync(out) ? readFileSync(out, "utf8") : null;
          const merged = mergeCanvasDecisions(md, prev);
          writeFileSync(out, merged, "utf8");
          console.log(
            prev && merged !== md
              ? `canvas escrito (bloco 9 preservado): ${out}`
              : `canvas escrito: ${out}`,
          );
        } else {
          console.log(md);
        }
        return;
      }
      if (action === "anota" || action === "licao" || action === "decide") {
        if (action === "anota") {
          const texto = requireArg(args.slice(2).join(" "), "uso: os soul <id> anota <texto>");
          if (texto === null) return;
          const file = anotar(soul.dir, texto);
          console.log(`anotado: ${file}`);
          return;
        }
        if (action === "licao") {
          const texto = requireArg(args.slice(2).join(" "), "uso: os soul <id> licao <texto>");
          if (texto === null) return;
          const file = registrarLicao(soul.dir, texto);
          console.log(`lição registrada: ${file}`);
          return;
        }
        // decide
        const titulo = requireArg(args[2], "uso: os soul <id> decide <titulo> [contexto...]");
        if (titulo === null) return;
        try {
          const file = decidir(soul.dir, { titulo, contexto: args.slice(3).join(" ") });
          console.log(`decisão registrada: ${file}`);
          return;
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
          return;
        }
      }
      console.log(`id: ${soul.id}`);
      console.log(`dir: ${soul.dir}`);
      {
        const { readFileSync, existsSync } = await import("node:fs");
        const canvasPath = join(soul.dir, "ARCHITECTURE_CANVAS.md");
        const prev = existsSync(canvasPath) ? readFileSync(canvasPath, "utf8") : null;
        const drift = canvasDrift(soul, canvasFacts(config), prev);
        console.log(`canvas: ${drift.stale ? `⚠️ defasado — ${drift.reason}` : "atualizado"}`);
      }
      console.log(`config: ${JSON.stringify(soul.config, null, 2)}`);
      return;
    }

    case "chat": {
      const usage = "uso: os chat <soul> <prompt...>";
      const id = requireArg(args[0], usage);
      if (id === null) return;
      const prompt = requireArg(args.slice(1).join(" "), usage);
      if (prompt === null) return;
      const soul = getSoul(config.home, id);
      if (!soul) {
        console.error(`soul não encontrada: ${id}`);
        process.exitCode = 1;
        return;
      }
      const { runOpenCode } = await import("@assistente-os/daemon");
      const result = await runOpenCode(prompt, { cwd: soul.dir, model: soul.config.models?.chat });
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.code !== 0) process.exitCode = 1;
      return;
    }

    case "migrate": {
      const src = requireArg(args[0], "uso: os migrate <src>");
      if (src === null) return;
      const summary = migrateAlmas(src, config.home);
      printMigrationSummary(summary);
      return;
    }

    case "import-sc": {
      const src = requireArg(args[0], "uso: os import-sc <src>");
      if (src === null) return;
      const summary = importSegundoCerebro(src, config.home);
      printMigrationSummary(summary);
      return;
    }

    case "memory": {
      if (args[0] === "backfill-entities") {
        await runBackfillEntities(config, args.slice(1));
        return;
      }
      const usage = "uso: os memory <soul> <index|search|status>";
      const id = requireArg(args[0], usage);
      if (id === null) return;
      const action = parseEnumArg(args[1], ["index", "search", "status"] as const, usage);
      if (action === null) return;
      const soul = getSoul(config.home, id);
      if (!soul) {
        console.error(`soul não encontrada: ${id}`);
        process.exitCode = 1;
        return;
      }
      const pool = getPool(config.databaseUrl);
      const embedder = getEmbedder();
      if (action === "index") {
        const r = await indexDirectory(pool, id, soul.dir, embedder);
        console.log(
          `indexado: ${r.files} arquivo(s), ${r.chunks} chunk(s) — ${r.embedded} (re)embedado(s), ${r.deleted} órfão(s) removido(s)`,
        );
      } else if (action === "search") {
        const q = requireArg(args.slice(2).join(" "), "uso: os memory <soul> search <query>");
        if (q === null) return;
        const results = await search(pool, id, q, embedder, 5);
        if (results.length === 0) {
          console.log("nenhum resultado");
          return;
        }
        for (const r of results) {
          console.log(`[${r.method} · ${r.score.toFixed(3)}] ${r.docKey}`);
          console.log(r.body.slice(0, 200).replace(/\s+/g, " "));
          console.log();
        }
      } else if (action === "status") {
        const stats = await indexStats(pool, id);
        const g = await graphStats(pool, id);
        console.log(`chunks: ${stats.chunks} (arquivos: ${stats.files})`);
        console.log(`grafo: ${g.entities} entidades, ${g.relations} relações, ${g.observations} observações`);
        const stale = isIndexStale(soul.dir, stats.lastIndexedAt);
        console.log(
          `índice: ${stats.lastIndexedAt ?? "nunca"} · ${stale ? "defasado (markdown mais novo — rode `os memory " + id + " index`)" : "atualizado"}`,
        );
      }
      return;
    }

    case "graph": {
      const id = requireArg(args[0], "uso: os graph <soul> list");
      if (id === null) return;
      const soul = getSoul(config.home, id);
      if (!soul) {
        console.error(`soul não encontrada: ${id}`);
        process.exitCode = 1;
        return;
      }
      const pool = getPool(config.databaseUrl);
      console.log("entidades:");
      for (const e of await listEntities(pool, id)) {
        console.log(`  ${e.kind}: ${e.name}`);
      }
      console.log("relações:");
      for (const r of await listRelations(pool, id)) {
        console.log(`  ${r.from} --${r.rel}--> ${r.to}`);
      }
      console.log("observações:");
      for (const o of await listObservations(pool, id)) {
        console.log(`  [${o.entity}] ${o.body}`);
      }
      return;
    }

    case "costs": {
      const sub = args[0];

      if (sub === "usage") {
        const pool = getPool(config.databaseUrl);
        const filters: UsageSummaryFilters = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--soul" && args[i + 1]) {
            filters.soul = args[i + 1]!;
            i++;
          } else if (args[i] === "--from" && args[i + 1]) {
            const from = parseDateArg(args[i + 1]!, "--from");
            if (from === null) return;
            filters.from = from;
            i++;
          } else if (args[i] === "--to" && args[i + 1]) {
            const to = parseDateArg(args[i + 1]!, "--to");
            if (to === null) return;
            filters.to = to;
            i++;
          }
        }
        const summary = await getUsageSummary(pool, filters);
        if (summary.length === 0) {
          console.log("(nenhum dado de uso encontrado)");
          return;
        }
        for (const row of summary) {
          console.log(`\nSoul: ${row.soul}`);
          console.log(`  Total calls: ${row.total_calls}`);
          console.log(`  Prompt tokens: ${row.total_prompt_tokens}`);
          console.log(`  Completion tokens: ${row.total_completion_tokens}`);
          console.log(`  Total tokens: ${row.total_tokens}`);
          if (Object.keys(row.by_mode).length > 0) {
            console.log("  By mode:");
            for (const [mode, data] of Object.entries(row.by_mode)) {
              console.log(`    ${mode}: ${data.calls} calls, ${data.tokens} tokens`);
            }
          }
          if (Object.keys(row.by_model).length > 0) {
            console.log("  By model:");
            for (const [model, data] of Object.entries(row.by_model)) {
              console.log(`    ${model}: ${data.calls} calls, ${data.tokens} tokens`);
            }
          }
        }
        return;
      }

      // Original costs summary
      const pool = getPool(config.databaseUrl);
      const souls = listSouls(config.home);
      console.log("custo por soul:");
      for (const s of souls) {
        console.log(`  ${s.id}: ${(await sumCostBySoul(pool, s.id)).toFixed(6)}`);
      }
      console.log("últimas chamadas:");
      for (const c of await recentCalls(pool, "main", 5)) {
        console.log(`  ${c.ts} ${c.provider}/${c.model} ${c.inputTokens}+${c.outputTokens}t $${c.cost.toFixed(6)} ${c.status}`);
      }
      return;
    }

    case "trace": {
      const traceId = requireArg(args[0], "uso: os trace <trace-id>");
      if (traceId === null) return;
      const pool = getPool(config.databaseUrl);
      const { execution, spans } = await getTrace(pool, traceId);
      if (!execution && spans.length === 0) {
        console.log(`(trace não encontrado: ${traceId})`);
        return;
      }
      if (execution) {
        console.log(
          `turno: soul=${execution.soul} tier=${execution.tier ?? "-"} model=${execution.model ?? "-"} ` +
            `status=${execution.status} tokens=${execution.tokensIn}+${execution.tokensOut} @ ${execution.ts}`,
        );
      }
      console.log(`spans (${spans.length}):`);
      for (const s of spans) {
        const tag = s.level === "err" ? " [ERR]" : "";
        console.log(`  +${String(s.elapsedMs).padStart(6)}ms  ${s.module.padEnd(14)} ${s.message}${tag}`);
      }
      return;
    }

    case "manifest": {
      const pool = getPool(config.databaseUrl);
      const manifest = await buildExecutionManifest({ home: config.home, pool });
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    case "skill": {
      console.log(runSkillCommand(config.home, args));
      return;
    }

    case "rag": {
      const code = await runRagCommand(config, args);
      if (code !== 0) process.exitCode = 1;
      return;
    }

    case "discriminator": {
      const code = await runDiscriminatorCommand(args);
      if (code !== 0) process.exitCode = 1;
      return;
    }

    case "prompt": {
      const code = runPromptCommand(args);
      if (code !== 0) process.exitCode = 1;
      return;
    }

    case "worktree": {
      const sub = args[0];
      const daemon = await import("@assistente-os/daemon");
      const { createWorktree, mergeLocally, destroyWorktree, setupEnvironment } = daemon;

      if (sub === "create") {
        const taskId = requireArg(args[1], "uso: os worktree create <taskId> [--base <branch>] [--soul <id>]");
        if (taskId === null) return;
        let baseBranch = "main";
        let soul: string | null = null;
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--base" && args[i + 1]) {
            baseBranch = args[i + 1]!;
            i++;
          } else if (args[i] === "--soul" && args[i + 1]) {
            soul = args[i + 1]!;
            i++;
          }
        }
        if (soul && !getSoul(config.home, soul)) {
          console.error(`soul não encontrada: ${soul}`);
          process.exitCode = 1;
          return;
        }
        const result = await createWorktree(taskId, baseBranch);
        if (result.success) {
          if (soul) {
            await setupEnvironment(taskId);
          }
          console.log(`worktree criada: ${result.path} (branch: ${result.branch})`);
        } else {
          console.error(`falha: ${result.error}`);
          process.exitCode = 1;
        }
        return;
      }

      if (sub === "merge") {
        const taskId = requireArg(args[1], "uso: os worktree merge <taskId> [--target <branch>]");
        if (taskId === null) return;
        let targetBranch = "main";
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--target" && args[i + 1]) {
            targetBranch = args[i + 1]!;
            i++;
          }
        }
        const result = await mergeLocally(taskId, targetBranch);
        if (result.success) {
          console.log(`merge bem-sucedido (testes: ${result.testsPassed ? "passaram" : "falharam"})`);
        } else {
          console.error(`falha: ${result.error}`);
          console.log(`testes passaram: ${result.testsPassed}`);
          process.exitCode = 1;
        }
        return;
      }

      if (sub === "destroy") {
        const taskId = requireArg(args[1], "uso: os worktree destroy <taskId>");
        if (taskId === null) return;
        await destroyWorktree(taskId);
        console.log(`worktree ${taskId} destruída`);
        return;
      }

      if (sub === "list" || sub === undefined) {
        const daemon = await import("@assistente-os/daemon");
        const { getWorkspacesRoot } = daemon;
        const fs = await import("node:fs/promises");
        const { join } = await import("node:path");
        const root = getWorkspacesRoot();
        try {
          const entries = await fs.readdir(root, { withFileTypes: true });
          const worktrees = entries.filter((e) => e.isDirectory()).map((e) => e.name);
          if (worktrees.length === 0) {
            console.log("(nenhuma worktree ativa)");
            return;
          }
          for (const w of worktrees) {
            console.log(`  ${w} -> ${join(root, w)}`);
          }
        } catch {
          console.log("(nenhuma worktree ativa)");
        }
        return;
      }

      console.log("uso: os worktree create <taskId> [--base <branch>] [--soul <id>] | os worktree merge <taskId> [--target <branch>] | os worktree destroy <taskId> | os worktree list");
      return;
    }

    case "agenda": {
      const sub = args[0];

      if (sub === "add") {
        const addUsage = 'uso: os agenda add <soul|-> "<título>" [--due <iso>] [corpo...]';
        const soulArg = requireArg(args[1], addUsage);
        if (soulArg === null) return;
        const title = requireArg(args[2], addUsage);
        if (title === null) return;
        const rest = args.slice(3);
        let dueAt: string | null = null;
        const bodyParts: string[] = [];
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--due" && rest[i + 1]) {
            const due = parseDateArg(rest[i + 1]!, "--due");
            if (due === null) return;
            dueAt = due;
            i++;
            continue;
          }
          bodyParts.push(rest[i]!);
        }
        const soul = soulArg === "-" ? null : soulArg;
        if (soul && !getSoul(config.home, soul)) {
          console.error(`soul não encontrada: ${soul}`);
          process.exitCode = 1;
          return;
        }
        const pool = getPool(config.databaseUrl);
        const item = await addAgendaItem(pool, soul, title, bodyParts.join(" ") || null, dueAt);
        console.log(`agendado #${item.id}: ${item.title}${item.due_at ? ` (due ${item.due_at})` : " (execução imediata)"}`);
        return;
      }

      if (sub === "list" || sub === undefined) {
        const filter = args[1] === undefined
          ? "pending"
          : parseEnumArg(args[1], ["pending", "done", "all"] as const, "uso: os agenda list [pending|done|all]");
        if (filter === null) return;
        const pool = getPool(config.databaseUrl);
        const items = await getAgendaItems(pool, filter);
        if (items.length === 0) {
          console.log(`(nenhum item ${filter})`);
          return;
        }
        for (const item of items) {
          console.log(`#${item.id} [${item.status}] ${item.soul ?? "-"} :: ${item.title} (${item.due_at ?? "sem prazo"})`);
        }
        return;
      }

      console.log("uso: os agenda add <soul|-> <título> [--due <iso>] [corpo...] | os agenda list [pending|done|all]");
      return;
    }

    case "guardian": {
      const sub = args[0];
      const repoRoot = process.env.ASSISTENTE_OS_REPO_ROOT || process.cwd();

      if (sub === "pending" || sub === undefined) {
        const pending = listPendingRules(config.home);
        if (pending.length === 0) {
          console.log("(nenhuma proposta pendente)");
          return;
        }
        for (const rule of pending) {
          console.log(`#${rule.id} [${rule.topic}] ${rule.ruleText}`);
          console.log(`  motivo: ${rule.reason}`);
          console.log(`  criada em ${rule.createdAt}; código válido até ${rule.approvalCodeExpiresAt}`);
        }
        return;
      }

      if (sub === "approve" || sub === "reject") {
        const gUsage = `uso: os guardian ${sub} <id> <código>`;
        const id = requireArg(args[1], gUsage);
        if (id === null) return;
        const code = requireArg(args[2], gUsage);
        if (code === null) return;
        try {
          if (sub === "approve") {
            const rule = approveRule(config.home, repoRoot, id, code);
            console.log(`regra aprovada e aplicada: [${rule.topic}] ${rule.ruleText}`);
          } else {
            rejectRule(config.home, id, code);
            console.log(`proposta ${id} rejeitada`);
          }
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
        return;
      }

      if (sub === "resend") {
        const id = requireArg(args[1], "uso: os guardian resend <id>");
        if (id === null) return;
        try {
          resendApprovalCode(config.home, id);
          console.log(`novo código gerado e enviado por Telegram (se GUARDIAN_APPROVAL_CHAT_ID estiver configurado) para a proposta ${id}`);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
        return;
      }

      console.log("uso: os guardian pending | os guardian approve <id> <código> | os guardian reject <id> <código> | os guardian resend <id>");
      return;
    }

    case "daemon": {
      const port = parsePort(args[0], Number(process.env.AOS_PORT ?? 4310));
      if (port === null) {
        // O .finally() de main() pula closePool() pra "daemon"/"voice" de
        // propósito (não derrubar a conexão que o daemon acabou de abrir) —
        // mas aqui a validação falhou ANTES de subir o daemon, então o pool
        // aberto pelas migrações fica pendurado sem isto, atrasando a saída
        // do processo até o keepalive do socket estourar (achado ao vivo:
        // ~30s, não instantâneo como as outras validações desta fatia).
        await closePool(config.databaseUrl);
        return;
      }
      const host = process.env.AOS_HOST ?? "127.0.0.1";
      const daemon = await startDaemon({
        port,
        host,
        home: config.home,
        token: process.env.ASSISTENTE_OS_DAEMON_TOKEN,
        voiceEnabled: process.env.VOICE_ENABLED === "true",
        whatsappEnabled: process.env.WHATSAPP_ENABLED === "true",
        telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
      });
      console.log(`[assistente-os] daemon em http://${host}:${daemon.port} (home: ${config.home})`);
      console.log(`[assistente-os] degraus: ${config.routerTiers.join(" -> ")}`);

      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[assistente-os] ${signal} recebido, encerrando graciosamente...`);
        await daemon.close();
        process.exit(0);
      };
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
      return;
    }

    case "voice": {
      const { VoicePipeline } = await import("@assistente-os/voice");
      const { runOpenCode } = await import("@assistente-os/daemon");

      console.log("🎤 Iniciando pipeline de voz...");
      console.log("   Modelos Whisper serão carregados (pode demorar na primeira vez)");
      console.log("   Pressione Ctrl+C para parar");

      const pipeline = new VoicePipeline({
        stt: { model: "base", language: "pt" },
        tts: { speed: 1.0 },
      });

      pipeline.setPromptHandler(async (prompt: string) => {
        console.log(`\n💬 Você: ${prompt}`);
        const soul = getActiveSoul(config.home) ?? "main";
        const soulData = getSoul(config.home, soul);
        if (!soulData) return `Soul ${soul} não encontrada`;

        const result = await runOpenCode(prompt, { cwd: soulData.dir, model: soulData.config.models?.chat });
        const response = result.stdout.trim();
        console.log(`🤖 Resposta: ${response}`);
        return response;
      });

      pipeline.on("error", (err: Error) => {
        console.error(`❌ Erro: ${err.message}`);
      });

      pipeline.on("speech-detected", () => {
        process.stdout.write("🔊");
      });

      pipeline.on("speech-ended", () => {
        process.stdout.write("📝");
      });

      await pipeline.start();

      // Manter processo vivo
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
          console.log("\n\n🛑 Parando pipeline de voz...");
          pipeline.stop();
          resolve();
        });
        process.on("SIGTERM", () => {
          pipeline.stop();
          resolve();
        });
      });

      console.log("Pipeline de voz encerrado.");
      return;
    }

    case "backup": {
      const backup = await createFullBackup(config.home, config.databaseUrl, config.backupDir);
      console.log(`backup criado: ${backup.path}`);
      console.log(`tamanho: ${(backup.bytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`itens de topo: ${backup.entries.join(", ")}`);
      const removed = await pruneOldBackups(config.backupDir, BACKUP_RETENTION_DAYS);
      if (removed.length > 0) {
        console.log(`retenção (${BACKUP_RETENTION_DAYS} dias): removido(s) ${removed.join(", ")}`);
      }
      console.log("atenção: o ZIP pode conter chaves e segredos do arquivo .env; armazene-o em local protegido");
      return;
    }

    default:
      console.error(`comando desconhecido: ${cmd}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    // "daemon"/"voice" seguem rodando de propósito (servidor HTTP / pipeline de voz);
    // fechar o pool aqui derrubaria a conexão que eles acabaram de abrir.
    const cmd = process.argv[2];
    if (cmd !== "daemon" && cmd !== "voice") {
      await closePool();
    }
  });
