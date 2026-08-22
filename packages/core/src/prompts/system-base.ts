/**
 * Diretriz de output concisa (FinOps): prefixo estável injetado no system
 * prompt de todas as souls por buildPrompt() (packages/daemon/src/context.ts).
 * Sem flag de configuração — incondicional pra todas as execuções.
 */
export const CONCISE_OUTPUT_DIRECTIVE =
  "## Diretriz de Output (FinOps)\n" +
  "- Sem preâmbulos ('Claro!', 'Aqui está...') nem encerramentos genéricos.\n" +
  "- Resposta técnica direta: diffs concisos, listas acionáveis.\n" +
  "- Preserve a janela de contexto: nada de repetir o pedido do usuário.";
