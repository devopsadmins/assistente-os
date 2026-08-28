/**
 * Prompt Garden — biblioteca versionada de prompts de pipeline/tool (T2.1 de
 * `docs/ARCHITECTURE-REVIEW.md`).
 *
 * Antes, cada prompt de extração/análise/auditoria era um literal solto no meio
 * do código do pipeline: sem versão, sem diff, sem forma padrão, sem entrar no
 * manifesto de execução. Aqui cada prompt é um `PromptSpec` com metadados
 * (papel / objetivo / regras / formato de saída / versão) + um `template` com
 * `{placeholders}` e um `render(vars)` que substitui e valida.
 *
 * O hash de cada spec entra no `buildExecutionManifest` (`prompts[]`), então
 * "qual versão de qual prompt rodou neste release" é auditável pelo hash.
 *
 * NÃO cobre: prompts de soul (`perfil.md`/`contexto.md`/`soul.md` — já
 * versionados por git e hasheados em `soulSystemPromptHash`) nem os
 * `ChatPromptTemplate` do LangChain em `packages/memory/src/prompt-templates.ts`.
 */
import { createHash } from "node:crypto";

export interface PromptMeta {
  /** id kebab-case, único no jardim. Também é a rota/telemetria quando aplicável. */
  id: string;
  /** Papel que o modelo assume. */
  papel: string;
  /** O que o prompt precisa produzir. */
  objetivo: string;
  /** Restrições duras (uma por item). */
  regras: readonly string[];
  /** Forma exata da saída esperada. */
  formatoSaida: string;
  /** Sobe a cada mudança semântica do template/metadados. */
  versao: number;
}

export interface PromptSpec<V extends Record<string, string | number> = Record<string, string | number>>
  extends PromptMeta {
  /** Texto do prompt. Interpola `{chave}` a partir de `vars`. `{{` / `}}` escapam chaves literais. */
  template: string;
  /** Substitui os `{placeholders}` e valida que toda variável referida foi fornecida. */
  render: (vars: V) => string;
}

/** Constrói o `render` a partir do `template` — um lugar só para a regra de interpolação. */
export function definePrompt<V extends Record<string, string | number>>(
  spec: PromptMeta & { template: string },
): PromptSpec<V> {
  const render = (vars: V): string =>
    spec.template
      .replace(/\{\{|\}\}|\{(\w+)\}/g, (match, key: string | undefined) => {
        if (match === "{{") return "{";
        if (match === "}}") return "}";
        if (!key || !(key in vars)) {
          throw new Error(`prompt "${spec.id}": variável {${key}} não fornecida`);
        }
        return String(vars[key as keyof V]);
      });
  return { ...spec, render };
}

/** String canônica e estável de um spec — base do hash no manifesto. */
export function promptCanonical(spec: PromptMeta & { template: string }): string {
  return JSON.stringify({
    id: spec.id,
    papel: spec.papel,
    objetivo: spec.objetivo,
    regras: spec.regras,
    formatoSaida: spec.formatoSaida,
    versao: spec.versao,
    template: spec.template,
  });
}

export function promptHash(spec: PromptMeta & { template: string }): string {
  return createHash("sha256").update(promptCanonical(spec)).digest("hex");
}
