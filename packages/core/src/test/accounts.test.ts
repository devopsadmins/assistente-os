import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAccount,
  verifyLogin,
  createAccountSession,
  resolveAccountSession,
  deleteAccountSession,
  getAccountById,
} from "../accounts.js";
import { isAssistenteOsError } from "../errors.js";
import { createTestSchema } from "./pgTestHelper.js";

test("createAccount + verifyLogin: fluxo feliz", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "Cliente@Exemplo.com", "senha-forte-123");
    assert.equal(account.email, "cliente@exemplo.com"); // normalizado (lowercase/trim)

    const verified = await verifyLogin(testDb.pool, "cliente@exemplo.com", "senha-forte-123");
    assert.ok(verified);
    assert.equal(verified?.id, account.id);
  } finally {
    await testDb.cleanup();
  }
});

test("verifyLogin: senha errada ou e-mail inexistente devolvem null (sem distinguir os dois casos)", async () => {
  const testDb = await createTestSchema();
  try {
    await createAccount(testDb.pool, "cliente@exemplo.com", "senha-forte-123");
    assert.equal(await verifyLogin(testDb.pool, "cliente@exemplo.com", "senha-errada"), null);
    assert.equal(await verifyLogin(testDb.pool, "nao-existe@exemplo.com", "qualquer"), null);
  } finally {
    await testDb.cleanup();
  }
});

test("createAccount: e-mail duplicado rejeita com E_VALIDATION", async () => {
  const testDb = await createTestSchema();
  try {
    await createAccount(testDb.pool, "dup@exemplo.com", "senha-forte-123");
    await assert.rejects(
      () => createAccount(testDb.pool, "DUP@exemplo.com", "outra-senha-123"),
      (err: unknown) => isAssistenteOsError(err) && err.code === "E_VALIDATION",
    );
  } finally {
    await testDb.cleanup();
  }
});

test("createAccount: senha curta demais rejeita com E_VALIDATION", async () => {
  const testDb = await createTestSchema();
  try {
    await assert.rejects(
      () => createAccount(testDb.pool, "curta@exemplo.com", "1234567"),
      (err: unknown) => isAssistenteOsError(err) && err.code === "E_VALIDATION",
    );
  } finally {
    await testDb.cleanup();
  }
});

test("createAccountSession + resolveAccountSession: token válido resolve a conta certa", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "sessao@exemplo.com", "senha-forte-123");
    const session = await createAccountSession(testDb.pool, account.id);
    assert.match(session.token, /^[0-9a-f]{64}$/);

    const resolved = await resolveAccountSession(testDb.pool, session.token);
    assert.deepEqual(resolved, { accountId: account.id });
  } finally {
    await testDb.cleanup();
  }
});

test("resolveAccountSession: token inexistente ou vazio devolve null", async () => {
  const testDb = await createTestSchema();
  try {
    assert.equal(await resolveAccountSession(testDb.pool, "token-que-nunca-existiu"), null);
    assert.equal(await resolveAccountSession(testDb.pool, ""), null);
  } finally {
    await testDb.cleanup();
  }
});

test("deleteAccountSession: logout invalida o token imediatamente", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "logout@exemplo.com", "senha-forte-123");
    const session = await createAccountSession(testDb.pool, account.id);
    assert.ok(await resolveAccountSession(testDb.pool, session.token));

    await deleteAccountSession(testDb.pool, session.token);
    assert.equal(await resolveAccountSession(testDb.pool, session.token), null);
  } finally {
    await testDb.cleanup();
  }
});

test("getAccountById: devolve null para id inexistente", async () => {
  const testDb = await createTestSchema();
  try {
    assert.equal(await getAccountById(testDb.pool, 999_999), null);
  } finally {
    await testDb.cleanup();
  }
});
