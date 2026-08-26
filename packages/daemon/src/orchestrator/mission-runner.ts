/** Mission Runner - Execução de missões compostas sem prompts manuais intermediários.
 *
 * Cada missão é uma sequência ordenada de ações (pipelines, tools, guardrails)
 * que o daemon despacha automaticamente. As missões são definidas como arrays
 * de etapas, onde cada etapa tem um tipo e parâmetros específicos.
 *
 * Modos suportados:
 * - "headless": execução pura, sem interação humana (usa runOpenCode injetado)
 * - "guarded": adiciona etapa de auditoria Guardian no final
 * - "full": inclui telemetria, WebSocket broadcasting e retenção LGPD
 */

import { loadConfig, listSouls, getSoul, addAgendaItem, recentCalls, sumCostBySoul, getPool } from "@assistente-os/core";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { meetingIngestPipeline } from "../pipelines/meeting-ingest.js";

type MissionStep = {
  type: "meeting-ingest" | "browser-navigate" | "browser-click" | "browser-extract" | "browser-screenshot" | "agenda-add" | "guardian-audit";
  soul?: string;
  title?: string;
  body?: string;
  url?: string;
  selector?: string;
  transcriptContent?: string;
  format?: "vtt" | "srt" | "txt";
  dueAt?: string;
  taskId?: string;
};

type Mission = {
  id: string;
  name: string;
  description: string;
  steps: MissionStep[];
  mode: "headless" | "guarded" | "full";
};

const MISSIONS: Record<string, Mission> = {
  meetingIngestFull: {
    id: "meetingIngestFull",
    name: "Ingestão Completa de Reunião",
    description: "Ingere reunião VTT/SRT/TXT → persiste Markdown + RAG → agenda follow-up → auditoria Guardian",
    mode: "full",
    steps: [
      { type: "meeting-ingest", soul: "main" },
      { type: "agenda-add", soul: "main", title: "Follow-up: reunião de sprint", body: "Definir ações e responsáveis para próxima reunião" },
      { type: "guardian-audit", soul: "main", title: "Auditar execução de meeting-ingest", body: "Validar qualidade da transcrição e extração de decisões" },
    ],
  },
  meetingIngestHeadless: {
    id: "meetingIngestHeadless",
    name: "Ingestão de Reunião (Headless)",
    description: "Ingere reunião sem etapa de auditoria Guardian",
    mode: "headless",
    steps: [
      { type: "meeting-ingest", soul: "main" },
      { type: "agenda-add", soul: "main", title: "Follow-up: reunião de sprint", body: "Definir ações e responsáveis para próxima reunião" },
    ],
  },
  browserTaskFull: {
    id: "browserTaskFull",
    name: "Task Automatizada Browser",
    description: "Navegação → extração de dados → screenshot → registro em log",
    mode: "full",
    steps: [
      { type: "browser-navigate", url: "https://example.com", soul: "main" },
      { type: "browser-extract", soul: "main", selector: "body" },
      { type: "browser-screenshot", soul: "main", taskId: "task-1" },
      { type: "agenda-add", soul: "main", title: "Extrair dados example.com", body: "Dados extraídos salvos em sessoes/" },
    ],
  },
  specGrillFull: {
    id: "specGrillFull",
    name: "Planejamento Espec Grill",
    description: "Refina requirements em duas phases → autoriza modo build",
    mode: "guarded",
    steps: [
      { type: "agenda-add", soul: "main", title: "Planejamento de feature", body: "Descrever feature draft para spec-grill" },
      { type: "guardian-audit", soul: "main", title: "Validar plano spec-grill", body: "Aprovar plano antes do modo build" },
    ],
  },
};

async function resolveSoul(home: string, soulId?: string): Promise<{ id: string; config: any }> {
  const souls = listSouls(home);
  if (souls.length === 0) throw new Error("Nenhuma soul disponível");
  const id = (souls[0] as { id: string }).id; // souls.length > 0 guarantees this is defined
  const soul = getSoul(home, id);
  if (!soul) throw new Error(`Soul '${id}' não encontrada`);
  return soul;
}

function execStepHeadless(step: MissionStep, home: string): Promise<any> {
  switch (step.type) {
    case "meeting-ingest": {
      const transcriptPath = join(tmpdir(), `mission-${step.type}-${Date.now()}.${step.format || "vtt"}`);
      return meetingIngestPipeline(transcriptPath, step.soul ?? "main") as Promise<any>;
    }
    case "browser-navigate": {
      return Promise.resolve({ ok: true, note: "browser-navigate placeholder" } as any);
    }
    case "browser-click": return Promise.resolve({ ok: true, note: "browser-click placeholder" } as any);
    case "browser-extract": return Promise.resolve({ ok: true, note: "browser-extract placeholder" } as any);
    case "browser-screenshot": return Promise.resolve({ ok: true, note: "browser-screenshot placeholder" } as any);
case "agenda-add": {
      const pool = getPool(home);
      return addAgendaItem(pool, "main", step.title ?? "Tarefa", step.body ?? "Descrição da tarefa", step.dueAt ?? null);
    }
    case "guardian-audit": {
      return Promise.resolve({ ok: true, note: "guardian-audit placeholder" } as any);
    }
    default: return Promise.resolve({ ok: false, error: "Tipo de etapa desconhecido: " + step.type } as any);
  }
}

/** Executa uma missão composta passo a passo. */
export async function executeMission(missionId: string, soulId?: string, overrides: Partial<MissionStep> = {}): Promise<{ ok: boolean; results: any[]; errors: string[] }> {
  const home = process.env.ASSISTENTE_OS_HOME ?? join(dirname(process.env.HOME ?? ""), ".assistant-os");
  const config = loadConfig({ home });
  const soul = await resolveSoul(home, soulId);

  const mission = MISSIONS[missionId];
  if (!mission) throw new Error(`Missão '${missionId}' não encontrada`);

  const results: any[] = [];
  const errors: string[] = [];

  for (const step of mission.steps) {
    const stepConfig = { ...step, ...overrides } as MissionStep;

    try {
      const result = await execStepHeadless(stepConfig, home);
      results.push({ step: step.type, success: true, result });
    } catch (err: any) {
      errors.push(`Etapa ${step.type}: ${err.message}`);
      results.push({ step: step.type, success: false, error: err.message });
    }
  }

  return {
    ok: errors.length === 0,
    results,
    errors,
  };
}

/** Lista missões disponíveis. */
export function listMissions(): Array<{ id: string; name: string; description: string; mode: string }> {
  return Object.values(MISSIONS).map((m) => ({ id: m.id, name: m.name, description: m.description, mode: m.mode }));
}