/**
 * Códigos de erro estáveis usados pelas políticas de execução e criação de
 * souls (ver docs/PLANO-CRIACAO-SOULS.md §8). Só os pontos de borda (ex.
 * `authorizeTool` em packages/tools) lançam `AssistenteOsError` — funções de
 * política puras como `authorizeExecution`/`validateSoulSpec` retornam
 * resultados discriminados em vez de lançar.
 */

export type StableErrorCode =
  | "E_AUTHZ"
  | "E_CONNECTOR"
  | "E_BUDGET"
  | "E_STALE_HASH"
  | "E_VALIDATION"
  | "E_CONFLICT"
  | "E_INDEX"
  | "E_POLICY_APPROVAL";

export class AssistenteOsError extends Error {
  readonly code: StableErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: StableErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AssistenteOsError";
    this.code = code;
    this.details = details;
  }
}

export function isAssistenteOsError(err: unknown): err is AssistenteOsError {
  return err instanceof AssistenteOsError && typeof err.code === "string";
}
