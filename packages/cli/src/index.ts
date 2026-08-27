#!/usr/bin/env node
import {
  loadConfig,
  listSouls,
  getSoul,
  getActiveSoul,
  setActiveSoul,
  getPool,
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
  type UsageSummaryFilters,
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
} from "@assistente-os/memory";
import { startDaemon } from "@assistente-os/daemon";
import { join } from "node:path";
import { createFullBackup, pruneOldBackups } from "./backup.js";
import { runSkillCommand } from "./skill.js";
import { runRagCommand } from "./rag.js";

const BACKUP_RETENTION_DAYS = 7;

const HELP = `
os — Assistente OS

Uso:
  os status                          mostra home, souls e modelo padrão
  os souls                           lista as souls
  os soul <id>                       mostra config e arquivos de uma soul
  os soul <id> ativa                 define a soul ativa
  os chat <soul> <prompt...>         roda opencode run headless na soul
  os migrate <src>                   migra almas do SLC-OS para <home>/souls
  os import-sc <src>                 importa Segundo Cérebro para <home>/souls/segundo-cerebro
  os memory <soul> index             indexa a pasta da soul (md/txt) no memory.db
  os memory <soul> search <q>        busca RAG (literal se Ollama ausente)
  os memory <soul> status            contagem de chunks e grafo
  os rag eval [<soul>] [--rerank off|cross-encoder|llm] [--file <p>] [--min-hit1 0.7]
                                     avalia recuperação: hit@k / MRR / recall@5
  os graph <soul> list               lista entidades/relações/observações
  os costs                           resumo de custos
  os costs usage [--soul <id>] [--from <date>] [--to <date>]  resumo agregado de uso/tokens
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

async function main(): Promise<void> {
  const config = loadConfig();
  const [cmd, ...args] = process.argv.slice(2);

  // Comandos que não tocam o banco não precisam de conectividade pra funcionar.
  // backup também entra na lista: o dump é feito pelo pg_dump (conexão própria),
  // e abrir pool aqui compete com o daemon por conexões do Postgres.
  if (cmd !== undefined && cmd !== "help" && cmd !== "--help" && cmd !== "-h" && cmd !== "backup") {
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
      console.log(`home: ${config.home}`);
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
      const id = args[0];
      const action = args[1];
      if (!id) {
        console.log("uso: os soul <id> [ativa]");
        return;
      }
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
      if (action === "anota" || action === "licao" || action === "decide") {
        if (action === "anota") {
          const texto = args.slice(2).join(" ");
          if (!texto.trim()) {
            console.log("uso: os soul <id> anota <texto>");
            return;
          }
          const file = anotar(soul.dir, texto);
          console.log(`anotado: ${file}`);
          return;
        }
        if (action === "licao") {
          const texto = args.slice(2).join(" ");
          if (!texto.trim()) {
            console.log("uso: os soul <id> licao <texto>");
            return;
          }
          const file = registrarLicao(soul.dir, texto);
          console.log(`lição registrada: ${file}`);
          return;
        }
        // decide
        const titulo = args[2] ?? "";
        if (!titulo) {
          console.log("uso: os soul <id> decide <titulo> [contexto...]");
          return;
        }
        try {
          const file = decidir(soul.dir, { titulo, contexto: args.slice(3).join(" ") });
          console.log(`decisão registrada: ${file}`);
          return;
        } catch (err: any) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
          return;
        }
      }
      console.log(`id: ${soul.id}`);
      console.log(`dir: ${soul.dir}`);
      console.log(`config: ${JSON.stringify(soul.config, null, 2)}`);
      return;
    }

    case "chat": {
      const id = args[0];
      const prompt = args.slice(1).join(" ");
      if (!id || !prompt.trim()) {
        console.log("uso: os chat <soul> <prompt...>");
        return;
      }
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
      const src = args[0];
      if (!src) {
        console.log("uso: os migrate <src>");
        return;
      }
      const summary = migrateAlmas(src, config.home);
      printMigrationSummary(summary);
      return;
    }

    case "import-sc": {
      const src = args[0];
      if (!src) {
        console.log("uso: os import-sc <src>");
        return;
      }
      const summary = importSegundoCerebro(src, config.home);
      printMigrationSummary(summary);
      return;
    }

    case "memory": {
      const id = args[0];
      const action = args[1];
      if (!id || !action) {
        console.log("uso: os memory <soul> <index|search|status>");
        return;
      }
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
        const q = args.slice(2).join(" ");
        if (!q) {
          console.log("uso: os memory <soul> search <query>");
          return;
        }
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
      } else {
        console.log("ação inválida: use index|search|status");
      }
      return;
    }

    case "graph": {
      const id = args[0];
      if (!id) {
        console.log("uso: os graph <soul> list");
        return;
      }
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
            filters.from = args[i + 1]!;
            i++;
          } else if (args[i] === "--to" && args[i + 1]) {
            filters.to = args[i + 1]!;
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

    case "worktree": {
      const sub = args[0];
      const daemon = await import("@assistente-os/daemon");
      const { createWorktree, mergeLocally, destroyWorktree, setupEnvironment } = daemon;

      if (sub === "create") {
        const taskId = args[1];
        if (!taskId) {
          console.log("uso: os worktree create <taskId> [--base <branch>] [--soul <id>]");
          process.exitCode = 1;
          return;
        }
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
        const taskId = args[1];
        if (!taskId) {
          console.log("uso: os worktree merge <taskId> [--target <branch>]");
          process.exitCode = 1;
          return;
        }
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
        const taskId = args[1];
        if (!taskId) {
          console.log("uso: os worktree destroy <taskId>");
          process.exitCode = 1;
          return;
        }
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
        const soulArg = args[1];
        const title = args[2];
        if (!soulArg || !title) {
          console.log('uso: os agenda add <soul|-> "<título>" [--due <iso>] [corpo...]');
          process.exitCode = 1;
          return;
        }
        const rest = args.slice(3);
        let dueAt: string | null = null;
        const bodyParts: string[] = [];
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--due" && rest[i + 1]) {
            dueAt = rest[i + 1]!;
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
        const filter = args[1] === "done" || args[1] === "all" ? args[1] : "pending";
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
        const id = args[1];
        const code = args[2];
        if (!id || !code) {
          console.log(`uso: os guardian ${sub} <id> <código>`);
          process.exitCode = 1;
          return;
        }
        try {
          if (sub === "approve") {
            const rule = approveRule(config.home, repoRoot, id, code);
            console.log(`regra aprovada e aplicada: [${rule.topic}] ${rule.ruleText}`);
          } else {
            rejectRule(config.home, id, code);
            console.log(`proposta ${id} rejeitada`);
          }
        } catch (err: any) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
        return;
      }

      if (sub === "resend") {
        const id = args[1];
        if (!id) {
          console.log("uso: os guardian resend <id>");
          process.exitCode = 1;
          return;
        }
        try {
          resendApprovalCode(config.home, id);
          console.log(`novo código gerado e enviado por Telegram (se GUARDIAN_APPROVAL_CHAT_ID estiver configurado) para a proposta ${id}`);
        } catch (err: any) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
        return;
      }

      console.log("uso: os guardian pending | os guardian approve <id> <código> | os guardian reject <id> <código> | os guardian resend <id>");
      return;
    }

    case "daemon": {
      const port = args[0] ? Number(args[0]) : Number(process.env.AOS_PORT ?? 4310);
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
  .catch((err: any) => {
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
