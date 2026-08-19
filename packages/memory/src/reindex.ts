import { Pool } from "@assistente-os/core";
import { getEmbedder } from "./embedder-provider.js";
import { indexSoul } from "./advanced-rag.js";

export async function runReindex(pool: Pool) {
  try {
    const { rows } = await pool.query('SELECT DISTINCT soul_id FROM chunks');
    for (const { soul_id } of rows) {
      await pool.query('DELETE FROM chunks WHERE soul_id = $1', [soul_id]);
      await indexSoul(pool, soul_id, process.env.HOME_PATH || "/home/user/assistant-os");
      console.log(`✓ Soul ${soul_id} re-indexado com Xenova`);
    }
  } catch (err) {
    console.error("Erro na re-indexação:", err);
    throw err;
  }
}