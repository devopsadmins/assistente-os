import { createHash } from "node:crypto";
import {
  loadConfig, getPool, recordCostCall, selectRoute, getSoul,
  claimPendingEvents, finishEvent, openSession, bumpSessionPrompt, recordExecution,
  buscarFamiliaPorTelefone, criarFamilia, contarFamiliasAtivas,
} from "@assistente-os/core";
import { runOpenCode, type OpenCodeRunResult } from "./runner.js";
import { buildPrompt } from "./context.js";
import { criarSoulFamiliar } from "./onboarding.js";

export interface EventConsumerOptions {
  home: string;
  run?: (prompt: string, options: Parameters<typeof runOpenCode>[1]) => Promise<OpenCodeRunResult>;
  onDone?: (event: { id: number; type: string; soul: string | null; status: string }) => void;
  /** Callback chamado com stdout quando evento é de canal externo (ex: whatsapp.message). */
  onResponse?: (eventId: number, stdout: string) => void;
}

const BASE_SOUL_ID = "mente_inclusiva";
const MAX_FAMILIAS = 10;
const TELEFONE_SKIP_PATTERN = /^(pular|skip|ok|proximo|próxima)$/i;

/**
 * Consome eventos pendentes em background: monta o buffer da soul de destino,
 * seleciona o degrau do roteador, executa o opencode run headless e registra
 * custo + execution_log. Eventos falhos viram status "failed" (não saem da fila).
 *
 * Para eventos do tipo whatsapp.message, resolve a família pelo telefone:
 *   - Se a família não existe, cria a soul familiar e inicia o onboarding.
 *   - Se a família existe, usa a soul correspondente.
 *   - Se o limite de famílias foi atingido, rejeita o evento.
 */
export async function processPendingEvents(options: EventConsumerOptions): Promise<number> {
  const { home, onDone, onResponse } = options;
  const run = options.run ?? runOpenCode;
  const config = loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const pending = await claimPendingEvents(pool, 5);
  let processed = 0;
  for (const ev of pending) {
    try {
      let soulId = ev.soul ?? "main";
      let onboardingPhase = -1;

      if (ev.type === "whatsapp.message") {
        const resolved = await resolveFamilia(pool, home, ev, config);
        soulId = resolved.soulId;
        onboardingPhase = resolved.phase;
      }

      const soul = getSoul(home, soulId);
      if (!soul) throw new Error(`soul ${soulId} não encontrada`);

      let payloadText = "";
      if (ev.payload) {
        try {
          const parsed = JSON.parse(ev.payload);
          payloadText = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        } catch {
          payloadText = ev.payload;
        }
      }

      let prompt = `[evento ${ev.type}]${payloadText ? `\n${payloadText}` : ""}`;
      if (onboardingPhase >= 0) {
        prompt = buildOnboardingPrompt(onboardingPhase, payloadText);
      }

      const built = await buildPrompt({ home, soul, prompt, config });
      const decision = await selectRoute(pool, config, soul, config.routerTiers);
      const session = await openSession(pool, soul.id, config.defaultMaxTurns);
      await bumpSessionPrompt(pool, session.id);
      const startedAt = Date.now();
      const result = await run(built.fullPrompt, {
        cwd: soul.dir,
        model: decision.target.model,
        timeoutSeconds: 120,
        agent: soul.config.agent ? soul.id : undefined,
        soulId: soul.id,
      });
      await recordCostCall(pool, {
        soul: soul.id,
        provider: decision.target.provider,
        model: decision.target.model,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `tier=${decision.target.tier}; origem=event:${ev.type}; latency_ms=${Date.now() - startedAt}`,
      });
      await recordExecution(pool, {
        sessionId: session.id,
        soul: soul.id,
        kind: `event:${ev.type}`,
        promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
        model: decision.target.model,
        tier: decision.target.tier,
        filesLoaded: built.files.filter((f) => f.chars > 0).length,
        contextChars: built.contextChars,
        verdict: built.verdict == null ? undefined : JSON.stringify(built.verdict),
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `latency_ms=${Date.now() - startedAt}`,
      });
      const status = result.code === 0 && !result.timedOut ? "completed" : "failed";
      await finishEvent(pool, ev.id, status);
      onDone?.({ id: ev.id, type: ev.type, soul: ev.soul, status });
      if (status === "completed" && onResponse && ev.type === "whatsapp.message") {
        onResponse(ev.id, result.stdout ?? "");
      }
    } catch (err) {
      await finishEvent(pool, ev.id, "failed", err instanceof Error ? err.message : String(err));
      onDone?.({ id: ev.id, type: ev.type, soul: ev.soul, status: "failed" });
    }
    processed += 1;
  }
  return processed;
}

interface FamiliaResolve {
  soulId: string;
  phase: number;
}

async function resolveFamilia(
  pool: ReturnType<typeof getPool>,
  home: string,
  ev: { payload: string | null; id: number; soul: string | null },
  config: ReturnType<typeof loadConfig>,
): Promise<FamiliaResolve> {
  let jid = "";
  let from = "";
  if (ev.payload) {
    try {
      const parsed = JSON.parse(ev.payload) as { jid?: string; from?: string };
      jid = parsed.jid ?? "";
      from = parsed.from ?? "";
    } catch {
      // ignore
    }
  }
  const telefone = jid.replace(/@.*$/, "");
  if (!telefone) return { soulId: ev.soul ?? "main", phase: -1 };

  const existente = await buscarFamiliaPorTelefone(pool, telefone);
  if (existente) {
    return { soulId: existente.soulId, phase: existente.anamnesePhase };
  }

  const ativas = await contarFamiliasAtivas(pool);
  if (ativas >= MAX_FAMILIAS) {
    throw new Error("limite_familias");
  }

  const familia = await criarFamilia(pool, telefone, from || "Família");
  await criarSoulFamiliar(home, familia, BASE_SOUL_ID);
  return { soulId: familia.soulId, phase: 0 };
}

function buildOnboardingPrompt(phase: number, payloadText: string): string {
  const instrucoesBase = [
    "INSTRUÇÕES DE ONBOARDING — ANAMNESE CONVERSACIONAL",
    "",
    "Você está realizando uma anamnese com uma família via WhatsApp.",
    "Regras:",
    "1. Faça UMA pergunta por vez, de forma conversacional e acolhedora.",
    "2. Leia o arquivo de referência da anamnese atual no sources/documentos/.",
    "3. Respostas devem ser salvas em sessoes/onboarding-infanto.md (fase 1) ou onboarding-familiar.md (fase 2).",
    "4. Formato de cada resposta: ## Seção X - [Nome]\\n- [campo]: [resposta]",
    "5. Se a família digitar 'pular', pule a pergunta atual (se não for obrigatória).",
    "   Obrigatórios (NÃO podem ser pulados): nome da criança, idade/nascimento, queixa principal.",
    "6. Ao final de cada fase, atualize o perfil.md e contexto.md com os dados coletados.",
    "7. Ao final da fase 1, use agenda_add para agendar lembrete em 3 dias para a fase 2.",
    "8. Ao final da fase 2, rode memory_index para atualizar o RAG.",
    "",
    "NÃO diagnostique, NÃO prescreva, NÃO minimize sofrimento.",
    "Linguagem simples, sensível e afetuosa. Máximo 2 parágrafos curtos por resposta.",
    "",
  ];

  if (phase === 0) {
    return [
      ...instrucoesBase,
      "FASE ATUAL: Início — anamnese infanto-juvenil.",
      "Arquivo de referência: sources/documentos/anamnese infanto-juvenil.txt",
      "",
      "Antes de começar, apresente-se e explique o fluxo para a família:",
      "- Várias perguntas, uma por vez",
      "- Digitando 'pular' avança a pergunta",
      "- Respostas ficam salvas com segurança",
      "",
      "Depois da apresentação, comece pela primeira pergunta (nome da criança).",
      "",
      `MENSAGEM DA FAMÍLIA: ${payloadText}`,
    ].join("\n");
  }

  if (phase === 1) {
    return [
      ...instrucoesBase,
      "FASE ATUAL: Anamnese infanto-juvenil em andamento.",
      "Arquivo de referência: sources/documentos/anamnese infanto-juvenil.txt",
      "Leia sessoes/onboarding-infanto.md para ver de onde parou.",
      "Retome de onde a família ficou. Pergunte a próxima pergunta pendente.",
      "",
      `MENSAGEM DA FAMÍLIA: ${payloadText}`,
    ].join("\n");
  }

  if (phase === 2) {
    return [
      ...instrucoesBase,
      "FASE ATUAL: Anamnese infanto-juvenil concluída. Agora inicie a anamnese familiar.",
      "Arquivo de referência: sources/documentos/ANAMNESE PARA PSICOTERAPIA FAMILIAR.txt",
      "Todas as perguntas desta fase são opcionais — use 'pular' para avançar.",
      "Leia sessoes/onboarding-infanto.md para contexto da família.",
      "",
      "Apresente-se novamente e explique que agora são perguntas sobre a dinâmica da família.",
      "Depois, comece pela primeira pergunta (motivação).",
      "",
      `MENSAGEM DA FAMÍLIA: ${payloadText}`,
    ].join("\n");
  }

  if (phase === 3) {
    return [
      ...instrucoesBase,
      "FASE ATUAL: Anamnese familiar em andamento.",
      "Arquivo de referência: sources/documentos/ANAMNESE PARA PSICOTERAPIA FAMILIAR.txt",
      "Leia sessoes/onboarding-familiar.md para ver de onde parou.",
      "Retome de onde a família ficou. Pergunte a próxima pergunta pendente.",
      "",
      `MENSAGEM DA FAMÍLIA: ${payloadText}`,
    ].join("\n");
  }

  return `[evento whatsapp]${payloadText ? `\n${payloadText}` : ""}`;
}
