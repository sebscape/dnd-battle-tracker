import "./local-storage-shim.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as cred from "../src/lib/credentials.ts";
import { CRITTER_CODEX_FIXTURE as F } from "./fixtures.ts";

const PASSWORD = "correct horse battery";
beforeEach(() => { localStorage.clear(); cred.lock(); });

test("saving encrypts the token; the plaintext and password are never stored", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  const stored = localStorage.getItem(cred.TOKEN_KEY)!;
  assert.ok(!stored.includes("sk-test") && !stored.includes(PASSWORD));
  assert.ok(cred.isEncryptedToken(JSON.parse(stored)));
  assert.equal(cred.getState().status, "locked");
  assert.equal(cred.getToken(), null);
});

test("saving follows Critter Codex's rules: token required, password ≥ 12 characters and confirmed", async () => {
  await assert.rejects(cred.saveToken(" ", PASSWORD, PASSWORD), /Enter an API token/);
  await assert.rejects(cred.saveToken("sk-x", "short", "short"), /at least 12/);
  await assert.rejects(cred.saveToken("sk-x", PASSWORD, PASSWORD + "!"), /do not match/);
  assert.equal(cred.getState().status, "missing");
});

test("uses the same encryption format as Critter Codex", async () => {
  // Encrypted by Critter Codex's own encryptToken (src/artworkSettings.ts).
  assert.equal(await cred.decryptToken(F.encrypted as cred.EncryptedToken, F.password), F.token);
});

test("an incorrect password does not unlock the token", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  await assert.rejects(cred.unlock("wrong password"), cred.IncorrectPasswordError);
  assert.equal(cred.getToken(), null);
  assert.equal(cred.getState().status, "locked");
  await assert.rejects(cred.unlock(""), cred.IncorrectPasswordError);
});

test("one unlock is shared by every AI feature in the app, and so is locking", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  // Two features subscribed to the same store (encounter generation and any future AI feature).
  const seenA: string[] = [], seenB: string[] = [];
  const offA = cred.subscribe(() => seenA.push(cred.getState().status));
  const offB = cred.subscribe(() => seenB.push(cred.getState().status));
  await cred.unlock(PASSWORD);
  assert.equal(cred.getToken(), "sk-test-own-token-1");
  assert.equal(seenA.at(-1), "unlocked");
  assert.equal(seenB.at(-1), "unlocked");
  cred.lock();
  assert.equal(cred.getToken(), null);
  assert.equal(seenA.at(-1), "locked");
  assert.equal(seenB.at(-1), "locked");
  offA(); offB();
});

test("decrypting locally is not the same as OpenAI accepting the token", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  await cred.unlock(PASSWORD);
  assert.deepEqual(cred.getState(), { status: "unlocked", openai: "unchecked" });
  cred.reportOpenAiResult(false);
  assert.deepEqual(cred.getState(), { status: "unlocked", openai: "rejected" });
  cred.reportOpenAiResult(true);
  assert.deepEqual(cred.getState(), { status: "unlocked", openai: "accepted" });
});

test("replacing the token locks it, and the new token and password are used", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  await cred.unlock(PASSWORD);
  await cred.saveToken("sk-test-own-token-2", "a brand new password", "a brand new password");
  assert.equal(cred.getToken(), null);
  await assert.rejects(cred.unlock(PASSWORD), cred.IncorrectPasswordError);
  await cred.unlock("a brand new password");
  assert.equal(cred.getToken(), "sk-test-own-token-2");
});

test("removing the token forgets it", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  await cred.unlock(PASSWORD);
  cred.removeToken();
  assert.equal(cred.getToken(), null);
  assert.equal(cred.getState().status, "missing");
  await assert.rejects(cred.unlock(PASSWORD), cred.NoTokenError);
});

test("errors never contain the token", async () => {
  await cred.saveToken("sk-test-own-token-1", PASSWORD, PASSWORD);
  try { await cred.unlock("wrong"); } catch (e) { assert.ok(!String((e as Error).message).includes("sk-")); }
});
