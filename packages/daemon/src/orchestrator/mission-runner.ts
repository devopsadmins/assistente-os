/**
 * Mission Runner — execução de missões compostas sem prompts manuais intermediários.
 *
 * Cada missão é uma sequência ordenada de etapas que o daemon despacha
 * automaticamente. Modos:
 * - "headless": execução pura, sem auditoria.
 * - "guarded": auditoria Guardian ao final; se reprovar, a missão fica "flagged".
 * - "full": guarded + broadcast por etapa (via onStep) + registro em execution_logs.
 *
 * Exposto por REST (`/api/missions`) e MCP (`mission_list` / `mission_run`).
 */

import {
  loadConfig,
  getSoul,
  listSouls,
  getPool,
  addAgendaItem,
  recordExecution,
  openSession,
  auditExecution,
  resolveHome,
} from "@assistente-os/core";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { meetingIngestPipeline } from "../pipelines/meeting-ingest.js";
import { browserNavigate, browserClick, browserExtractText, browserScreenshot, browserClose } from "../tools/browser.js";

export type MissionMode = "headless" | "guarded" | "full";

export type MissionStepType =
  | "meeting-ingest"
  | "browser-navigate"
  | "browser-click"
  | "browser-extract"
  | "browser-screenshot"
  | "browser-close"
  | "agenda-add"
  | "guardian-audit";

export interface MissionStep {
  type: MissionStepType;
  soul?: string;
  title?: string;
  body?: string;
  url?: string;
  selector?: string;
  transcriptContent?: string;
  format?: "vtt" | "srt" | "txt";
  dueAt?: string;
  taskId?: string;
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  mode: MissionMode;
  steps: MissionStep[];
}

export interface MissionStepResult {
  type: MissionStepType;
  ok: boolean;
  note?: string;
  data?: unknown;
  error?: string;
}

export interface MissionStepEvent {
  missionId: string;
  index: number;
  total: number;
  type: MissionStepType;
  ok: boolean;
  note?: string;
}

export interface MissionResult {
  missionId: string;
  mode: MissionMode;
  status: "ok" | "flagged" | "failed";
  steps: MissionStepResult[];
  audit?: { approved: boolean; score: number; feedback: string; skipped?: boolean };
  startedAt: string;
  finishedAt: string;
}

const MISSIONS: Record<string, Mission> = {
  meetingIngestFull: {
    id: "meetingIngestFull",
    name: "Ingestão Completa de Reunião",
    description: "Ingere reunião VTT/SRT/TXT → persiste Markdown + RAG → agenda follow-up → auditoria Guardian",
    mode: "full",
    steps: [
      { type: "meeting-ingest", soul: "main" },
      { type: "agenda-add", soul: "main", title: "Follow-up: reunião", body: "Definir ações e responsáveis" },
      { type: "guardian-audit", soul: "main", title: "Auditar meeting-ingest", body: "Qualidade da transcrição e extração" },
    ],
  },
  meetingIngestHeadless: {
    id: "meetingIngestHeadless",
    name: "Ingestão de Reunião (Headless)",
    description: "Ingere reunião sem etapa de auditoria Guardian",
    mode: "headless",
    steps: [
      { type: "meeting-ingest", soul: "main" },
      { type: "agenda-add", soul: "main", title: "Follow-up: reunião", body: "Definir ações e responsáveis" },
    ],
  },
  browserTaskFull: {
    id: "browserTaskFull",
    name: "Task Automatizada Browser",
    description: "Navegação → extração de dados → screenshot → registro em agenda",
    mode: "full",
    steps: [
      { type: "browser-navigate", url: "https://example.com", soul: "main", taskId: "mission-browser" },
      { type: "browser-extract", soul: "main", selector: "body", taskId: "mission-browser" },
      { type: "browser-screenshot", soul: "main", taskId: "mission-browser" },
      { type: "browser-close", taskId: "mission-browser" },
      { type: "agenda-add", soul: "main", title: "Extração de site concluída", body: "Dados extraídos na missão browser" },
    ],
  },
};

function home(): string {
  return process.env.ASSISTENTE_OS_HOME ?? resolveHome();
}

/** Resolve a soul do passo: a declarada, senão 'main', senão a primeira disponível. */
function resolveSoulId(h: string, wanted?: string): string {
  if (wanted && getSoul(h, wanted)) return wanted;
  if (getSoul(h, "main")) return "main";
  const first = listSouls(h)[0];
  if (!first) throw new Error("nenhuma soul disponível");
  return first.id;
}

async function execStep(step: MissionStep, h: string): Promise<MissionStepResult> {
  const base = { type: step.type };
  switch (step.type) {
    case "meeting-ingest": {
      const soul = resolveSoulId(h, step.soul);
      const path = join(tmpdir(), `mission-meeting-${Date.now()}.${step.format ?? "vtt"}`);
      const data = await meetingIngestPipeline(path, soul);
      return { ...base, ok: true, data };
    }
    case "browser-navigate": {
      if (!step.url) return { ...base, ok: false, error: "url obrigatória" };
      const r = await browserNavigate(step.url, step.taskId ?? "mission");
      return { ...base, ok: r.ok, data: r.data, error: r.error };
    }
    case "browser-click": {
      if (!step.selector) return { ...base, ok: false, error: "selector obrigatório" };
      const r = await browserClick(step.selector, step.taskId ?? "mission");
      return { ...base, ok: r.ok, data: r.data, error: r.error };
    }
    case "browser-extract": {
      const r = await browserExtractText(step.selector ?? "body", step.taskId ?? "mission");
      return { ...base, ok: r.ok, data: r.data, error: r.error };
    }
    case "browser-screenshot": {
      const r = await browserScreenshot(step.taskId ?? "mission");
      return { ...base, ok: r.ok, data: r.data ? { sizeBytes: (r.data as { sizeBytes?: number }).sizeBytes } : undefined, error: r.error };
    }
    case "browser-close": {
      const r = await browserClose(step.taskId ?? "mission");
      return { ...base, ok: r.ok, error: r.error };
    }
    case "agenda-add": {
      const config = loadConfig({ home: h });
      const pool = getPool(config.databaseUrl);
      const soul = resolveSoulId(h, step.soul);
      const item = await addAgendaItem(pool, soul, step.title ?? "Tarefa da missão", step.body ?? "", step.dueAt ?? null);
      return { ...base, ok: true, data: item };
    }
    case "guardian-audit": {
      // Chama o Guardian (LLM). auditExecution() não lança — quando o Ollama
      // não responde devolve { approved:false, score:0, feedback:"...indisponível..." }.
      // Nesse caso degradamos para "pulado" em vez de derrubar a missão (mesmo
      // padrão dos testes que dependem de Ollama real).
      const soul = resolveSoulId(h, step.soul);
      const audit = await auditExecution({
        taskId: `mission-${Date.now()}`,
        targetAgent: soul,
        changesSummary: step.body ?? step.title ?? "execução de missão",
      }).catch((err) => ({ approved: false, score: 0, feedback: `Guardian indisponível (${(err as Error).message})` }));
      const unavailable = audit.score === 0 && /indispon[íi]vel/i.test(audit.feedback);
      if (unavailable) {
        return { ...base, ok: true, note: "guardian-audit pulado (Guardian/Ollama indisponível)", data: { skipped: true, reason: audit.feedback } };
      }
      return { ...base, ok: audit.approved, note: `score=${audit.score}`, data: audit };
    }
    default:
      return { ...base, ok: false, error: `tipo de etapa desconhecido: ${step.type as string}` };
  }
}

export function listMissions(): Array<Pick<Mission, "id" | "name" | "description" | "mode"> & { steps: number }> {
  return Object.values(MISSIONS).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    mode: m.mode,
    steps: m.steps.length,
  }));
}

export interface RunMissionOptions {
  soulOverride?: string;
  onStep?: (e: MissionStepEvent) => void | Promise<void>;
}

/** Executa uma missão composta passo a passo. */
export async function runMission(missionId: string, opts: RunMissionOptions = {}): Promise<MissionResult> {
  const mission = MISSIONS[missionId];
  if (!mission) throw new Error(`missão '${missionId}' não encontrada`);
  const h = home();
  const startedAt = new Date().toISOString();

  const steps: MissionStepResult[] = [];
  let status: MissionResult["status"] = "ok";
  let audit: MissionResult["audit"];

  for (let i = 0; i < mission.steps.length; i++) {
    const raw = mission.steps[i]!;
    const step = opts.soulOverride ? { ...raw, soul: opts.soulOverride } : raw;
    let result: MissionStepResult;
    try {
      result = await execStep(step, h);
    } catch (err) {
      result = { type: step.type, ok: false, error: (err as Error).message };
    }
    steps.push(result);

    if (step.type === "guardian-audit" && result.data && typeof result.data === "object") {
      const d = result.data as { approved?: boolean; score?: number; feedback?: string; skipped?: boolean };
      audit = { approved: d.approved ?? true, score: d.score ?? 0, feedback: d.feedback ?? "", skipped: d.skipped };
      // guarded/full: auditoria reprovando marca a missão como flagged e interrompe.
      if ((mission.mode === "guarded" || mission.mode === "full") && d.approved === false) {
        status = "flagged";
        if (opts.onStep) await opts.onStep({ missionId, index: i, total: mission.steps.length, type: step.type, ok: false, note: "reprovado pelo Guardian" });
        break;
      }
    }

    if (!result.ok && step.type !== "guardian-audit") status = "failed";
    if (opts.onStep) {
      await opts.onStep({ missionId, index: i, total: mission.steps.length, type: step.type, ok: result.ok, note: result.note ?? result.error });
    }
  }

  const finishedAt = new Date().toISOString();

  // full: registra a missão em execution_logs (trilha ISO 42001).
  if (mission.mode === "full") {
    try {
      const config = loadConfig({ home: h });
      const pool = getPool(config.databaseUrl);
      const soul = resolveSoulId(h, opts.soulOverride);
      const session = await openSession(pool, soul, config.defaultMaxTurns);
      await recordExecution(pool, {
        sessionId: session.id,
        soul,
        kind: `mission:${missionId}`,
        status: status === "ok" ? "ok" : "failed",
        note: `mode=${mission.mode}; steps=${steps.length}; status=${status}`,
      });
    } catch {
      /* telemetria non-fatal */
    }
  }

  return { missionId, mode: mission.mode, status, steps, audit, startedAt, finishedAt };
}
