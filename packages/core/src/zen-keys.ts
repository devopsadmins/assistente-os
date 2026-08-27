/** Subconjunto de config que carrega as chaves Zen — parcial para facilitar teste. */
export interface ZenKeySource {
  zenApiKeys?: string[];
  zenApiKey?: string;
}

/**
 * Rodízio de chaves do OpenCode Zen.
 *
 * Um deploy pode registrar até 7 chaves gratuitas do Zen. Em vez de amarrar
 * cada soul a uma chave (decisão de posse que ficou adiada), distribuímos o
 * consumo por chamada em round-robin — espalha a carga e adia o limite de
 * qualquer chave individual.
 *
 * Origem das chaves, em ordem de precedência:
 *   1. `ZEN_API_KEYS` — lista separada por vírgula e/ou quebra de linha
 *   2. `ZEN_API_KEY_1` .. `ZEN_API_KEY_7` — uma por variável
 *   3. `ZEN_API_KEY` — chave única (compat com o formato antigo)
 */
const MAX_NUMBERED_KEYS = 7;

/** Lê as chaves Zen do ambiente, aplicando a precedência documentada acima. */
export function parseZenApiKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromList = splitKeys(env.ZEN_API_KEYS);
  if (fromList.length > 0) return dedupe(fromList);

  const numbered: string[] = [];
  for (let i = 1; i <= MAX_NUMBERED_KEYS; i++) {
    const v = env[`ZEN_API_KEY_${i}`]?.trim();
    if (v) numbered.push(v);
  }
  if (numbered.length > 0) return dedupe(numbered);

  const single = env.ZEN_API_KEY?.trim();
  return single ? [single] : [];
}

function splitKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function dedupe(keys: string[]): string[] {
  return [...new Set(keys)];
}

/**
 * Chaves Zen efetivas de um config: `zenApiKeys` quando presente, senão
 * `[zenApiKey]`, senão `[]`. Aceita um config parcial para facilitar teste.
 */
export function resolveZenApiKeys(
  config: ZenKeySource,
): string[] {
  if (config.zenApiKeys && config.zenApiKeys.length > 0) return config.zenApiKeys;
  return config.zenApiKey ? [config.zenApiKey] : [];
}

/** Cursor do round-robin — por processo, compartilhado por todos os consumidores. */
let rotationIndex = 0;

/** Só para testes: zera o cursor do rodízio. */
export function __resetZenRotation(): void {
  rotationIndex = 0;
}

/**
 * Próxima chave Zen no rodízio. `undefined` quando nenhuma chave está
 * configurada (o consumidor deve cair de volta pro Ollama). Com uma única
 * chave, devolve sempre a mesma.
 */
export function nextZenApiKey(
  config: ZenKeySource,
): string | undefined {
  const keys = resolveZenApiKeys(config);
  if (keys.length === 0) return undefined;
  const key = keys[rotationIndex % keys.length];
  rotationIndex = (rotationIndex + 1) % keys.length;
  return key;
}
