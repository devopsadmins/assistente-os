import {
  browserNavigate,
  browserClick,
  browserExtractText,
  browserScreenshot,
  browserClose,
  getAccessibilityTree,
  captureAuditedScreenshot,
  executeDynamicFix,
} from "@assistente-os/daemon";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const BROWSER_TOOLS: Tool[] = [
  {
    name: "browser_navigate",
    description: "Abre uma URL em um navegador headless. Retorna título e status HTTP. Cada tarefa tem uma sessão isolada.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa para navegar" },
        taskId: { type: "string", description: "ID da tarefa (opcional, default: 'default')" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Clica em um elemento CSS na página do navegador da tarefa.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Seletor CSS do elemento" },
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
      },
      required: ["selector"],
    },
  },
  {
    name: "browser_extract_text",
    description: "Extrai texto estruturado da página. Use 'table' ou 'tables' para extrair tabelas como JSON/Markdown. Use 'body' ou omita para texto completo.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Seletor CSS ('body', 'table', 'tables', ou qualquer seletor)", default: "body" },
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: "Captura screenshot da página como PNG (base64). Útil para auditoria multimodal.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
        fullPage: { type: "boolean", description: "Screenshot da página inteira (default: false)", default: false },
      },
    },
  },
  {
    name: "browser_close",
    description: "Fecha a sessão do navegador da tarefa e libera recursos.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
      },
    },
  },
  {
    name: "browser_get_accessibility_tree",
    description: "Retorna a árvore de acessibilidade (AccessibilityNode) da página ativa — navegação semântica resiliente a variações de CSS/IDs.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional, default: 'default')" },
      },
    },
  },
  {
    name: "browser_execute_fix",
    description: "Injeta um trecho de JavaScript na página ativa para contornar um bloqueio (overlay, popup, z-index). Scripts bem-sucedidos ficam em cache e a estratégia é registrada em licoes.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa" },
        scriptContent: { type: "string", description: "código JavaScript a executar no contexto da página" },
        reason: { type: "string", description: "motivo/objetivo da injeção" },
      },
      required: ["taskId", "scriptContent", "reason"],
    },
  },
  {
    name: "browser_audited_screenshot",
    description: "Captura screenshot da página ativa com timestamp, hash SHA-256 e metadata para auditoria/relatórios.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional, default: 'default')" },
        fullPage: { type: "boolean", description: "Screenshot da página inteira (default: false)", default: false },
        metadata: { type: "object", description: "metadata adicional a anexar ao registro de auditoria" },
      },
    },
  },
];

export const BROWSER_HANDLERS: Record<string, ToolHandler> = {
  browser_navigate: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const url = typeof args.url === "string" && args.url.trim() ? args.url.trim() : null;
    if (!url) throw new Error("parâmetro url é obrigatório");
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    ctx.authorizeAgentSoul("browser_navigate");
    return await browserNavigate(url, taskId);
  },

  browser_click: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const selector = typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : null;
    if (!selector) throw new Error("parâmetro selector é obrigatório");
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    ctx.authorizeAgentSoul("browser_click");
    return await browserClick(selector, taskId);
  },

  browser_extract_text: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const selector = typeof args.selector === "string" ? args.selector.trim() : "body";
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    ctx.authorizeAgentSoul("browser_extract_text");
    return await browserExtractText(selector, taskId);
  },

  browser_screenshot: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    const fullPage = typeof args.fullPage === "boolean" ? args.fullPage : false;
    ctx.authorizeAgentSoul("browser_screenshot");
    return await browserScreenshot(taskId, fullPage);
  },

  browser_close: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    ctx.authorizeAgentSoul("browser_close");
    return await browserClose(taskId);
  },

  browser_get_accessibility_tree: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    ctx.authorizeAgentSoul("browser_get_accessibility_tree");
    return await getAccessibilityTree(taskId);
  },

  browser_execute_fix: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
    const scriptContent = typeof args.scriptContent === "string" && args.scriptContent.trim() ? args.scriptContent.trim() : null;
    const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : null;
    if (!taskId || !scriptContent || !reason) {
      throw new Error("parâmetros taskId, scriptContent e reason são obrigatórios");
    }
    ctx.authorizeAgentSoul("browser_execute_fix");
    return await executeDynamicFix(taskId, scriptContent, reason);
  },

  browser_audited_screenshot: async (ctx: ToolContext, args: Record<string, unknown>) => {
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
    const fullPage = typeof args.fullPage === "boolean" ? args.fullPage : false;
    const metadata = args.metadata && typeof args.metadata === "object" ? args.metadata as Record<string, unknown> : undefined;
    ctx.authorizeAgentSoul("browser_audited_screenshot");
    return await captureAuditedScreenshot(taskId, metadata, fullPage);
  },
};
