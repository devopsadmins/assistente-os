/**
 * Retrocompat: `CONCISE_OUTPUT_DIRECTIVE` agora vive no Prompt Garden
 * (`./garden/concise-output.ts`). Consumidores antigos continuam importando daqui.
 */
export { CONCISE_OUTPUT_DIRECTIVE, conciseOutput } from "./garden/concise-output.js";
