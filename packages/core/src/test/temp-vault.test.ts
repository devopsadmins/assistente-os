import { test } from "node:test";
import assert from "node:assert/strict";
import {
  storeCredential,
  getCredential,
  getAllCredentials,
  purgeCredentials,
  purgeAll,
  listActiveTasks,
  registerTask,
} from "../security/temp-vault.js";

// Limpa o vault entre testes para isolar estado
function cleanVault() {
  purgeAll();
}

test("temp-vault: store e recupera credencial", () => {
  cleanVault();
  storeCredential("task-1", "token", "abc123");
  assert.equal(getCredential("task-1", "token"), "abc123");
  cleanVault();
});

test("temp-vault: sobrescreve credencial existente", () => {
  cleanVault();
  storeCredential("task-1", "token", "old-value");
  storeCredential("task-1", "token", "new-value");
  assert.equal(getCredential("task-1", "token"), "new-value");
  cleanVault();
});

test("temp-vault: purge remove todas as credenciais da task", () => {
  cleanVault();
  storeCredential("task-1", "token", "abc");
  storeCredential("task-1", "password", "secret");
  storeCredential("task-1", "session", "xyz");
  const result = purgeCredentials("task-1");
  assert.equal(result.purged, 3);
  assert.equal(result.taskId, "task-1");
  assert.equal(getCredential("task-1", "token"), undefined);
  assert.equal(getCredential("task-1", "password"), undefined);
  cleanVault();
});

test("temp-vault: purgeAll limpa todo o vault", () => {
  cleanVault();
  storeCredential("task-1", "a", "1");
  storeCredential("task-2", "b", "2");
  storeCredential("task-3", "c", "3");
  const total = purgeAll();
  assert.equal(total, 3);
  assert.equal(getCredential("task-1", "a"), undefined);
  assert.equal(getCredential("task-2", "b"), undefined);
  assert.equal(getCredential("task-3", "c"), undefined);
  cleanVault();
});

test("temp-vault: isolamento entre taskIds", () => {
  cleanVault();
  storeCredential("task-1", "token", "aaa");
  storeCredential("task-2", "token", "bbb");
  assert.equal(getCredential("task-1", "token"), "aaa");
  assert.equal(getCredential("task-2", "token"), "bbb");
  purgeCredentials("task-1");
  assert.equal(getCredential("task-1", "token"), undefined);
  assert.equal(getCredential("task-2", "token"), "bbb");
  cleanVault();
});

test("temp-vault: getAllCredentials retorna cópia", () => {
  cleanVault();
  storeCredential("task-1", "a", "1");
  storeCredential("task-1", "b", "2");
  const creds = getAllCredentials("task-1");
  assert.deepEqual(creds, { a: "1", b: "2" });
  // Mutating the returned object should not affect the vault
  if (creds) creds["a"] = "tampered";
  assert.equal(getCredential("task-1", "a"), "1");
  cleanVault();
});

test("temp-vault: getAllCredentials retorna undefined para task inexistente", () => {
  cleanVault();
  assert.equal(getAllCredentials("nonexistent"), undefined);
  cleanVault();
});

test("temp-vault: listActiveTasks retorna tasks ativas", () => {
  cleanVault();
  storeCredential("task-1", "token", "a");
  storeCredential("task-2", "pass", "b");
  registerTask("task-1", "soul-alpha");
  const tasks = listActiveTasks();
  assert.equal(tasks.length, 2);
  const t1 = tasks.find((t) => t.taskId === "task-1");
  assert.ok(t1);
  assert.equal(t1.soulId, "soul-alpha");
  assert.deepEqual(t1.keys, ["token"]);
  cleanVault();
});

test("temp-vault: purgeCredentials retorna purged=0 para task inexistente", () => {
  cleanVault();
  const result = purgeCredentials("nonexistent");
  assert.equal(result.purged, 0);
  assert.equal(result.taskId, "nonexistent");
  cleanVault();
});

test("temp-vault: storeCredential lança erro para inputs vazios", () => {
  cleanVault();
  assert.throws(() => storeCredential("", "key", "val"));
  assert.throws(() => storeCredential("task", "", "val"));
  cleanVault();
});
