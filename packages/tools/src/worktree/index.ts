import { createWorktree, mergeLocally, destroyWorktree, listWorktrees, listMissions, runMission } from "@assistente-os/daemon";
import { isValidSoulId } from "@assistente-os/core";
import { Tool, ToolContext, ToolHandler, authorizeTool } from "../index.js";

export const WORKTREE_TOOLS: Tool[] = [
  {
    name: "worktree_create",
    description: "Cria worktree isolada para tarefa agêntica paralela.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        taskId: { type: "string", description: "id da tarefa" },
        baseBranch: { type: "string", description: "branch base (default: main)", default: "main" },
      },
      required: ["soul", "taskId"],
    },
  },
  {
    name: "worktree_merge_locally",
    description: "Valida testes e faz merge local da worktree na branch alvo.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        taskId: { type: "string", description: "id da tarefa" },
        targetBranch: { type: "string", description: "branch alvo (default: main)", default: "main" },
      },
      required: ["soul", "taskId"],
    },
  },
  {
    name: "worktree_destroy",
    description: "Destrói worktree e limpa referências git.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        taskId: { type: "string", description: "id da tarefa" },
      },
      required: ["soul", "taskId"],
    },
  },
  {
    name: "worktree_list",
    description: "Lista as worktrees de tarefa ativas (branch/HEAD reais via git worktree list).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mission_list",
    description: "Lista as missões compostas do Mission Runner (ORCA) — id, modo (headless/guarded/full) e nº de etapas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mission_run",
    description: "Executa uma missão composta do Mission Runner. Efeito externo (browser/agenda/ingest) — L3.",
    inputSchema: {
      type: "object",
      properties: {
        mission_id: { type: "string", description: "id da missão (ver mission_list)" },
        soul: { type: "string", description: "soul para sobrescrever a das etapas (opcional)" },
      },
      required: ["mission_id"],
    },
  },
];

export const WORKTREE_HANDLERS: Record<string, ToolHandler> = {
  worktree_create: async (ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "worktree_create");
    const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
    const baseBranch = typeof args.baseBranch === "string" && args.baseBranch.trim() ? args.baseBranch.trim() : "main";
    if (!taskId) throw new Error("parâmetro taskId é obrigatório");
    return await createWorktree(taskId, baseBranch);
  },

  worktree_merge_locally: async (ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "worktree_merge_locally");
    const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
    const targetBranch = typeof args.targetBranch === "string" && args.targetBranch.trim() ? args.targetBranch.trim() : "main";
    if (!taskId) throw new Error("parâmetro taskId é obrigatório");
    return await mergeLocally(taskId, targetBranch);
  },

  worktree_destroy: async (ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "worktree_destroy");
    const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
    if (!taskId) throw new Error("parâmetro taskId é obrigatório");
    await destroyWorktree(taskId);
    return { ok: true };
  },

  worktree_list: async (ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> => {
    return { worktrees: await listWorktrees() };
  },

  mission_list: async (ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> => {
    return { missions: listMissions() };
  },

  mission_run: async (ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> => {
    ctx.authorizeAgentSoul("mission_run");
    const missionId = typeof args.mission_id === "string" && args.mission_id.trim() ? args.mission_id.trim() : null;
    if (!missionId) throw new Error("parâmetro mission_id é obrigatório");
    const soul = typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined;
    if (soul !== undefined && !isValidSoulId(soul)) throw new Error(`mission_run: soul inválida: ${soul}`);
    return await runMission(missionId, { soulOverride: soul });
  },
};
