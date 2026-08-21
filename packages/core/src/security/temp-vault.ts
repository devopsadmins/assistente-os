/**
 * Vault de Credenciais Temporárias em Memória (Zero-Persistence Security)
 *
 * Armazena credenciais efêmeras exclusivamente em memória volátil durante
 * o ciclo de vida de uma tarefa (TaskContext). Senhas e tokens de sessão
 * NUNCA são persistidos no PostgreSQL, nos logs ou nos arquivos Markdown.
 *
 * purgeCredentials() é obrigatório no encerramento (sucesso ou erro).
 * Um hook de process.exit garante limpeza de segurança como safety net.
 */

// ── Tipos ──────────────────────────────────────────────────────────────

export interface CredentialStore {
  taskId: string;
  soulId: string;
  keys: string[];
  createdAt: string;
}

export interface PurgeResult {
  purged: number;
  taskId: string;
}

// ── Vault ──────────────────────────────────────────────────────────────

const vault = new Map<string, Map<string, string>>();
const metadata = new Map<string, { soulId: string; createdAt: string }>();

/** Limites de capacidade — evitam crescimento sem bound se purgeCredentials() nunca for chamado. */
const MAX_TASKS = 500;
const MAX_KEYS_PER_TASK = 200;

/**
 * Armazena uma credencial em memória volátil, associada a uma tarefa.
 * Se já existir uma credencial com a mesma key, sobrescreve.
 * Lança erro se o vault atingir o limite de capacidade (tarefas ou keys por tarefa).
 */
export function storeCredential(taskId: string, key: string, value: string): void {
  if (!taskId || !key) throw new Error("taskId e key são obrigatórios");
  let bucket = vault.get(taskId);
  if (!bucket) {
    if (vault.size >= MAX_TASKS) {
      throw new Error(`temp-vault cheio: limite de ${MAX_TASKS} tarefas ativas atingido`);
    }
    bucket = new Map();
    vault.set(taskId, bucket);
  }
  if (!bucket.has(key) && bucket.size >= MAX_KEYS_PER_TASK) {
    throw new Error(`temp-vault cheio: limite de ${MAX_KEYS_PER_TASK} credenciais por tarefa atingido`);
  }
  bucket.set(key, value);
  if (!metadata.has(taskId)) {
    metadata.set(taskId, { soulId: "", createdAt: new Date().toISOString() });
  }
}

/**
 * Registra metadados da tarefa (soulId) no vault.
 */
export function registerTask(taskId: string, soulId: string): void {
  const existing = metadata.get(taskId);
  if (existing) {
    existing.soulId = soulId;
  } else {
    metadata.set(taskId, { soulId, createdAt: new Date().toISOString() });
  }
}

/**
 * Recupera uma credencial por taskId + key.
 * Retorna undefined se não existir.
 */
export function getCredential(taskId: string, key: string): string | undefined {
  return vault.get(taskId)?.get(key);
}

/**
 * Retorna cópia shallow de todas as credenciais de uma tarefa.
 * O Map interno NÃO é exposto — previne mutação acidental.
 */
export function getAllCredentials(taskId: string): Record<string, string> | undefined {
  const bucket = vault.get(taskId);
  if (!bucket || bucket.size === 0) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of bucket) {
    result[k] = v;
  }
  return result;
}

/**
 * Lista todas as tarefas com credenciais armazenadas.
 */
export function listActiveTasks(): CredentialStore[] {
  const stores: CredentialStore[] = [];
  for (const [taskId, bucket] of vault) {
    const meta = metadata.get(taskId);
    stores.push({
      taskId,
      soulId: meta?.soulId ?? "",
      keys: Array.from(bucket.keys()),
      createdAt: meta?.createdAt ?? "",
    });
  }
  return stores;
}

/**
 * Remove todas as credenciais de uma tarefa específica.
 * Faz overwrite defensivo com "×" antes de deletar (defense-in-depth).
 */
export function purgeCredentials(taskId: string): PurgeResult {
  const bucket = vault.get(taskId);
  if (!bucket) return { purged: 0, taskId };

  const count = bucket.size;
  // Overwrite defensivo: sobrescreve valores antes de deletar
  for (const key of bucket.keys()) {
    bucket.set(key, "×".repeat(32));
  }
  bucket.clear();
  vault.delete(taskId);
  metadata.delete(taskId);

  return { purged: count, taskId };
}

/**
 * Limpa TODO o vault. Chamado em process.exit como safety net.
 */
export function purgeAll(): number {
  let total = 0;
  for (const [taskId] of vault) {
    total += purgeCredentials(taskId).purged;
  }
  return total;
}

// ── Safety Net ─────────────────────────────────────────────────────────

let hookInstalled = false;

/**
 * Instala o hook de process.exit para limpeza automática.
 * Idempotente — pode ser chamado múltiplas vezes.
 */
export function installSafetyHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  process.on("exit", () => {
    const purged = purgeAll();
    if (purged > 0) {
      // eslint-disable-next-line no-console
      console.error(`[temp-vault] Safety net: ${purged} credenciais purgadas no exit`);
    }
  });
}

// Instala automaticamente no primeiro import
installSafetyHook();
