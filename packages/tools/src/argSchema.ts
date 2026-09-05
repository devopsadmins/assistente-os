/**
 * SPEC-EP2 Frente 2 (Fatia 2, 2026-09-05): cada `Tool.inputSchema` já
 * descreve a forma esperada dos argumentos (usado por `tools/list` pro
 * cliente MCP) — mas nada validava `args` contra ele em `tools/call`; um
 * campo de tipo errado era ignorado em silêncio pelos `typeof x === "string"
 * ? x : default` de cada handler, nunca rejeitado. Em vez de duplicar um
 * schema Zod por tool (~50+ tools em 13 famílias), este módulo converte o
 * `inputSchema` JSON-Schema-like já declarado num schema Zod na hora —
 * fonte única de verdade, sem duas cópias podendo divergir.
 *
 * Escopo deliberadamente pequeno: os `inputSchema` deste monorepo só usam
 * `type` (string/number/integer/boolean/array/object), `enum` e `required` —
 * sem `oneOf`/`anyOf`/nested objects com properties própria. Se algum tool
 * novo precisar de algo mais rico, é hora de dar a ele um schema Zod
 * explícito em vez de esticar este conversor genérico.
 */
import { z, type ZodTypeAny } from "zod";
import type { Tool } from "./index.js";

type JsonSchemaProp = {
  type?: string;
  enum?: readonly string[];
  items?: JsonSchemaProp;
};

function jsonSchemaPropToZod(prop: JsonSchemaProp): ZodTypeAny {
  if (prop.enum && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(prop.items ? jsonSchemaPropToZod(prop.items) : z.unknown());
    case "object":
      return z.record(z.unknown());
    default:
      return z.unknown();
  }
}

/** Constrói um schema Zod a partir do `inputSchema` MCP já declarado na tool. */
export function buildArgsSchema(tool: Tool): ZodTypeAny {
  const required = new Set(tool.inputSchema.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    const propSchema = jsonSchemaPropToZod(prop as JsonSchemaProp);
    shape[key] = required.has(key) ? propSchema : propSchema.optional();
  }
  return z.object(shape);
}

/**
 * Valida `args` contra o `inputSchema` da tool. Só checa forma (tipo +
 * obrigatoriedade) — propriedades extras não declaradas são toleradas
 * (mesma permissividade que JSON-Schema sem `additionalProperties: false`),
 * e em sucesso os `args` originais seguem intactos pro handler (nenhuma
 * coerção/default aplicada aqui — isso continua sendo trabalho do handler,
 * inalterado).
 */
export function validateToolArgs(tool: Tool, args: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  const schema = buildArgsSchema(tool);
  const result = schema.safeParse(args);
  if (result.success) return { ok: true };
  const detail = result.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
  return { ok: false, message: `argumentos inválidos para '${tool.name}' — ${detail}` };
}
