export interface Embedder {
  /** Gera vetor para um texto. Retorna null se indisponível (degradação p/ literal). */
  embed(text: string): Promise<number[] | null>;
  /** Dimensão esperada dos vetores (para validar). */
  dims(): number;
}

/** Embedder "literal": nunca gera vetor. Config `embedding: "literal"` do SLC-OS. */
export class LiteralEmbedder implements Embedder {
  dims(): number {
    return 0;
  }

  async embed(_text: string): Promise<number[] | null> {
    return null;
  }
}

/** Cosseno entre dois vetores (0..1); 0 se algum estiver vazio. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
