import { FallbackEmbedder } from "./embedder-fallback.js";

let instance: FallbackEmbedder | null = null;

export interface FallbackEmbedderInterface {
  dims(): number;
}

export function getEmbedder(): FallbackEmbedder & FallbackEmbedderInterface {
  if (!instance) {
    instance = new FallbackEmbedder();
  }
  return instance;
}