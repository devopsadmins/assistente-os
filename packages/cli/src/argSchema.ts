/**
 * SPEC-EP2 Frente 2 (Fatia 3, 2026-09-05): a CLI recebe `process.argv`
 * (sempre strings — o problema de "tipo errado" das Fatias 1/2 não existe
 * aqui) e cada subcomando validava presença/forma manualmente
 * (`if (!args[0]) { console.log(uso); return; }`), inconsistente no exit
 * code (algumas faltas de argumento saíam com código 0), e alguns valores
 * "enum-like" nem eram validados — caíam num fallback silencioso (ex.: `os
 * agenda list <filtro-com-typo>` mostrava "pending" sem avisar que o filtro
 * era inválido). Este módulo padroniza os dois casos com Zod: em falha,
 * imprime a mensagem em stderr, marca `process.exitCode = 1` e devolve
 * `null` — o call site decide `return` (não redesenha o parser de flags,
 * só centraliza a validação e o exit code).
 */
import { z } from "zod";

/** Argumento posicional obrigatório (não vazio após trim). */
export function requireArg(value: string | undefined, usage: string): string | null {
  const result = z.string().trim().min(1).safeParse(value);
  if (!result.success) {
    console.error(usage);
    process.exitCode = 1;
    return null;
  }
  return result.data;
}

/** Valor restrito a um conjunto fechado — rejeita em vez de cair num default silencioso. */
export function parseEnumArg<T extends readonly [string, ...string[]]>(
  value: string | undefined,
  options: T,
  usage: string,
): T[number] | null {
  const result = z.enum(options as unknown as [string, ...string[]]).safeParse(value);
  if (!result.success) {
    console.error(`${usage} — recebido "${value ?? ""}", válidos: ${options.join("|")}`);
    process.exitCode = 1;
    return null;
  }
  return result.data;
}

/** Porta TCP a partir de um argv opcional; `undefined` cai no fallback (comportamento inalterado). */
export function parsePort(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  const result = z.coerce.number().int().min(1).max(65535).safeParse(value);
  if (!result.success) {
    console.error(`porta inválida: "${value}" (esperado um inteiro entre 1 e 65535)`);
    process.exitCode = 1;
    return null;
  }
  return result.data;
}

/** Data em qualquer formato que `Date.parse` reconheça (ISO 8601 recomendado). */
export function parseDateArg(value: string, flagName: string): string | null {
  const result = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "data inválida" }).safeParse(value);
  if (!result.success) {
    console.error(`${flagName}: data inválida — "${value}" (use ISO 8601, ex. 2026-09-05)`);
    process.exitCode = 1;
    return null;
  }
  return result.data;
}
