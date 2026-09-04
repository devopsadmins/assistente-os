import { getAdoConnection } from "@assistente-os/core";
import { GitRepository, GitPullRequest, GitPullRequestSearchCriteria } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces.js";
import { WorkItem, WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import { BuildDefinitionReference } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
import { authorizeTool } from "../index.js";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const ADO_TOOLS: Tool[] = [
  {
    name: "ado_list_projects",
    description: "Lista todos os projetos da organização Azure DevOps.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
      },
      required: ["soul"],
    },
  },
  {
    name: "ado_list_repositories",
    description: "Lista repositórios de um projeto Azure DevOps.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
      },
      required: ["soul", "project"],
    },
  },
  {
    name: "ado_list_work_items",
    description: "Lista work items de um projeto (usa WIQL).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        wiql: { type: "string", description: "Query WIQL opcional" },
        top: { type: "number", description: "Limite de resultados", default: 50 },
      },
      required: ["soul", "project"],
    },
  },
  {
    name: "ado_create_work_item",
    description: "Cria um work item no Azure DevOps.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        type: { type: "string", description: "Tipo do work item (ex: 'Bug', 'User Story', 'Task')", default: "Task" },
        title: { type: "string", description: "Título do work item" },
        description: { type: "string", description: "Descrição (Markdown)" },
        assignedTo: { type: "string", description: "Email do assignee" },
        tags: { type: "string", description: "Tags separadas por vírgula" },
        areaPath: { type: "string", description: "Area path" },
        iterationPath: { type: "string", description: "Iteration path" },
      },
      required: ["soul", "project", "title"],
    },
  },
  {
    name: "ado_get_work_item",
    description: "Obtém detalhes de um work item específico.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        id: { type: "number", description: "ID do work item" },
        project: { type: "string", description: "Nome ou ID do projeto (opcional)" },
      },
      required: ["soul", "id"],
    },
  },
  {
    name: "ado_update_work_item",
    description: "Atualiza campos de um work item.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        id: { type: "number", description: "ID do work item" },
        fields: { type: "object", description: "Campos a atualizar (ex: { 'System.State': 'Active', 'System.Title': 'Novo título' })" },
      },
      required: ["soul", "id", "fields"],
    },
  },
  {
    name: "ado_list_pipelines",
    description: "Lista pipelines de um projeto.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
      },
      required: ["soul", "project"],
    },
  },
  {
    name: "ado_run_pipeline",
    description: "Executa um pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        pipelineId: { type: "number", description: "ID do pipeline" },
        variables: { type: "object", description: "Variáveis do pipeline" },
        branch: { type: "string", description: "Branch para rodar (padrão: default)" },
      },
      required: ["soul", "project", "pipelineId"],
    },
  },
  {
    name: "ado_list_pull_requests",
    description: "Lista pull requests de um repositório.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        repositoryId: { type: "string", description: "Nome ou ID do repositório" },
        status: { type: "string", description: "Status: 'active', 'completed', 'abandoned', 'all'", default: "active" },
        top: { type: "number", description: "Limite de resultados", default: 50 },
      },
      required: ["soul", "project", "repositoryId"],
    },
  },
  {
    name: "ado_create_pull_request",
    description: "Cria um pull request.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        repositoryId: { type: "string", description: "Nome ou ID do repositório" },
        sourceRefName: { type: "string", description: "Branch de origem (ex: 'refs/heads/feature')" },
        targetRefName: { type: "string", description: "Branch de destino (ex: 'refs/heads/main')" },
        title: { type: "string", description: "Título do PR" },
        description: { type: "string", description: "Descrição do PR" },
        isDraft: { type: "boolean", description: "Se é draft", default: false },
        workItemIds: { type: "array", items: { type: "number" }, description: "IDs de work items para linkar" },
        reviewers: { type: "array", items: { type: "string" }, description: "Emails dos reviewers" },
      },
      required: ["soul", "project", "repositoryId", "sourceRefName", "targetRefName", "title"],
    },
  },
];

export const ADO_HANDLERS: Record<string, ToolHandler> = {
  ado_list_projects: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_list_projects");
    const connection = await getAdoConnection(ctx.config);
    const coreApi = await connection.getCoreApi();
    const projects = await coreApi.getProjects();
    return projects.map((p: TeamProjectReference) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      state: p.state,
      description: p.description,
      lastUpdateTime: p.lastUpdateTime,
    }));
  },

  ado_list_repositories: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_list_repositories");
    const project = typeof args.project === "string" ? args.project : null;
    if (!project) throw new Error("parâmetro project é obrigatório");
    const connection = await getAdoConnection(ctx.config);
    const gitApi = await connection.getGitApi();
    const repos = await gitApi.getRepositories(project);
    return repos.map((r: GitRepository) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      project: r.project?.name,
      defaultBranch: r.defaultBranch,
      size: r.size,
      remoteUrl: r.remoteUrl,
    }));
  },

  ado_list_work_items: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_list_work_items");
    const project = typeof args.project === "string" ? args.project : null;
    if (!project) throw new Error("parâmetro project é obrigatório");
    const wiql = typeof args.wiql === "string" ? args.wiql : null;
    const top = typeof args.top === "number" ? Math.min(200, Math.max(1, args.top)) : 50;
    const connection = await getAdoConnection(ctx.config);
    const witApi = await connection.getWorkItemTrackingApi();

    let query = wiql;
    if (!query) {
      query = `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.Tags], [System.AreaPath], [System.IterationPath], [System.CreatedDate], [System.ChangedDate] FROM WorkItems WHERE [System.TeamProject] = '${project}' ORDER BY [System.ChangedDate] DESC`;
    }

    const result = await witApi.queryByWiql({ query }, { project }, undefined, top);
    if (!result.workItems || result.workItems.length === 0) return [];

    const ids = result.workItems.slice(0, top).map(wi => wi.id!);
    const workItems = await witApi.getWorkItems(ids, undefined, undefined, WorkItemExpand.All, undefined, project);
    return workItems.map((wi: WorkItem) => ({
      id: wi.id,
      title: wi.fields?.["System.Title"],
      state: wi.fields?.["System.State"],
      type: wi.fields?.["System.WorkItemType"],
      assignedTo: wi.fields?.["System.AssignedTo"]?.displayName || wi.fields?.["System.AssignedTo"]?.uniqueName,
      tags: wi.fields?.["System.Tags"],
      areaPath: wi.fields?.["System.AreaPath"],
      iterationPath: wi.fields?.["System.IterationPath"],
      createdDate: wi.fields?.["System.CreatedDate"],
      changedDate: wi.fields?.["System.ChangedDate"],
      url: wi.url,
    }));
  },

  ado_create_work_item: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_create_work_item");
    const project = typeof args.project === "string" ? args.project : null;
    const type = typeof args.type === "string" ? args.type : "Task";
    const title = typeof args.title === "string" ? args.title : null;
    const description = typeof args.description === "string" ? args.description : "";
    const assignedTo = typeof args.assignedTo === "string" ? args.assignedTo : undefined;
    const tags = typeof args.tags === "string" ? args.tags : undefined;
    const areaPath = typeof args.areaPath === "string" ? args.areaPath : undefined;
    const iterationPath = typeof args.iterationPath === "string" ? args.iterationPath : undefined;

    if (!project || !title) throw new Error("project e title são obrigatórios");

    const connection = await getAdoConnection(ctx.config);
    const witApi = await connection.getWorkItemTrackingApi();

    const patchOps: { op: Operation; path: string; value: unknown }[] = [
      { op: Operation.Add, path: "/fields/System.Title", value: title },
    ];

    if (description) patchOps.push({ op: Operation.Add, path: "/fields/System.Description", value: description });
    if (assignedTo) patchOps.push({ op: Operation.Add, path: "/fields/System.AssignedTo", value: assignedTo });
    if (tags) patchOps.push({ op: Operation.Add, path: "/fields/System.Tags", value: tags });
    if (areaPath) patchOps.push({ op: Operation.Add, path: "/fields/System.AreaPath", value: areaPath });
    if (iterationPath) patchOps.push({ op: Operation.Add, path: "/fields/System.IterationPath", value: iterationPath });

    const workItem = await witApi.createWorkItem({}, patchOps, project, type);
    return {
      id: workItem.id,
      title: workItem.fields?.["System.Title"],
      state: workItem.fields?.["System.State"],
      type: workItem.fields?.["System.WorkItemType"],
      url: workItem.url,
    };
  },

  ado_get_work_item: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_get_work_item");
    const id = typeof args.id === "number" ? args.id : null;
    const project = typeof args.project === "string" ? args.project : undefined;
    if (!id) throw new Error("parâmetro id é obrigatório");

    const connection = await getAdoConnection(ctx.config);
    const witApi = await connection.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(id, undefined, undefined, WorkItemExpand.All, project);

    return {
      id: workItem.id,
      title: workItem.fields?.["System.Title"],
      state: workItem.fields?.["System.State"],
      type: workItem.fields?.["System.WorkItemType"],
      assignedTo: workItem.fields?.["System.AssignedTo"]?.displayName || workItem.fields?.["System.AssignedTo"]?.uniqueName,
      description: workItem.fields?.["System.Description"],
      tags: workItem.fields?.["System.Tags"],
      areaPath: workItem.fields?.["System.AreaPath"],
      iterationPath: workItem.fields?.["System.IterationPath"],
      createdDate: workItem.fields?.["System.CreatedDate"],
      changedDate: workItem.fields?.["System.ChangedDate"],
      url: workItem.url,
    };
  },

  ado_update_work_item: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_update_work_item");
    const id = typeof args.id === "number" ? args.id : null;
    const fields = args.fields as Record<string, unknown> | null;
    if (!id || !fields) throw new Error("id e fields são obrigatórios");

    const connection = await getAdoConnection(ctx.config);
    const witApi = await connection.getWorkItemTrackingApi();

    const patchOps: { op: Operation; path: string; value: unknown }[] = Object.entries(fields).map(([key, value]) => ({
      op: Operation.Add,
      path: key.startsWith("/") ? key : `/fields/${key}`,
      value,
    }));

    const workItem = await witApi.updateWorkItem(null, patchOps, id);
    return {
      id: workItem.id,
      title: workItem.fields?.["System.Title"],
      state: workItem.fields?.["System.State"],
      type: workItem.fields?.["System.WorkItemType"],
      url: workItem.url,
    };
  },

  ado_list_pipelines: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_list_pipelines");
    const project = typeof args.project === "string" ? args.project : null;
    if (!project) throw new Error("parâmetro project é obrigatório");

    const connection = await getAdoConnection(ctx.config);
    const buildApi = await connection.getBuildApi();
    const pipelines = await buildApi.getDefinitions(project);

    return pipelines.map((p: BuildDefinitionReference) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      path: p.path,
      type: p.type,
      queueStatus: p.queueStatus,
      revision: p.revision,
    }));
  },

  ado_run_pipeline: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_run_pipeline");
    const project = typeof args.project === "string" ? args.project : null;
    const pipelineId = typeof args.pipelineId === "number" ? args.pipelineId : null;
    const variables = args.variables as Record<string, string> | undefined;
    const branch = typeof args.branch === "string" ? args.branch : undefined;

    if (!project || !pipelineId) throw new Error("project e pipelineId são obrigatórios");

    const connection = await getAdoConnection(ctx.config);
    const buildApi = await connection.getBuildApi();

    const buildParams: any = {
      definition: { id: pipelineId },
    };

    if (branch) buildParams.sourceBranch = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
    if (variables) buildParams.parameters = JSON.stringify(variables);

    const build = await buildApi.queueBuild(buildParams, project);
    return {
      id: build.id,
      buildNumber: build.buildNumber,
      status: build.status,
      result: build.result,
      url: build.url,
      queueTime: build.queueTime,
      startTime: build.startTime,
      finishTime: build.finishTime,
    };
  },

  ado_list_pull_requests: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_list_pull_requests");
    const project = typeof args.project === "string" ? args.project : null;
    const repositoryId = typeof args.repositoryId === "string" ? args.repositoryId : null;
    const status = typeof args.status === "string" ? args.status : "active";
    const top = typeof args.top === "number" ? Math.min(100, Math.max(1, args.top)) : 50;

    if (!project || !repositoryId) throw new Error("project e repositoryId são obrigatórios");

    const connection = await getAdoConnection(ctx.config);
    const gitApi = await connection.getGitApi();

    const searchCriteria: GitPullRequestSearchCriteria = {
      status: status as any,
    };

    const prs = await gitApi.getPullRequests(repositoryId, searchCriteria, project, undefined, undefined, top);
    return prs.map((pr: GitPullRequest) => ({
      id: pr.pullRequestId,
      title: pr.title,
      description: pr.description,
      status: pr.status,
      sourceRefName: pr.sourceRefName,
      targetRefName: pr.targetRefName,
      createdBy: pr.createdBy?.displayName,
      createdDate: pr.creationDate,
      url: pr.url,
      isDraft: pr.isDraft,
      reviewers: pr.reviewers?.map(r => r.displayName),
      workItemRefs: pr.workItemRefs?.map(w => w.id),
    }));
  },

  ado_create_pull_request: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "ado_create_pull_request");
    const project = typeof args.project === "string" ? args.project : null;
    const repositoryId = typeof args.repositoryId === "string" ? args.repositoryId : null;
    const sourceRefName = typeof args.sourceRefName === "string" ? args.sourceRefName : null;
    const targetRefName = typeof args.targetRefName === "string" ? args.targetRefName : null;
    const title = typeof args.title === "string" ? args.title : null;
    const description = typeof args.description === "string" ? args.description : "";
    const isDraft = typeof args.isDraft === "boolean" ? args.isDraft : false;
    const workItemIds = Array.isArray(args.workItemIds) ? args.workItemIds : [];
    const reviewers = Array.isArray(args.reviewers) ? args.reviewers : [];

    if (!project || !repositoryId || !sourceRefName || !targetRefName || !title) {
      throw new Error("project, repositoryId, sourceRefName, targetRefName e title são obrigatórios");
    }

    const connection = await getAdoConnection(ctx.config);
    const gitApi = await connection.getGitApi();

    const pr = await gitApi.createPullRequest(
      {
        sourceRefName,
        targetRefName,
        title,
        description,
        isDraft,
        reviewers: reviewers.map(email => ({ reviewerUrl: undefined, displayName: email, uniqueName: email })),
        workItemRefs: workItemIds.map(id => ({ id })),
      },
      repositoryId,
      project
    );

    return {
      id: pr.pullRequestId,
      title: pr.title,
      description: pr.description,
      status: pr.status,
      sourceRefName: pr.sourceRefName,
      targetRefName: pr.targetRefName,
      createdBy: pr.createdBy?.displayName,
      createdDate: pr.creationDate,
      url: pr.url,
      isDraft: pr.isDraft,
    };
  },
};
