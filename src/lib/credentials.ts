// Scrap Sheet's own OpenAI API token, shared by every AI feature in this app.
//
// Same workflow and encryption as Critter Codex's artwork token (its
// src/artworkSettings.ts), but stored separately so each app works on its own:
// - Settings → AI Encounter Generation saves the token encrypted in this browser
//   (PBKDF2-SHA-256, 310,000 iterations → AES-256-GCM) under TOKEN_KEY.
// - The encryption password is never stored. The plaintext token lives only in this
//   module's memory until the page is closed or the user locks it.
// - All AI features in this app share this one unlock state: unlocking or locking
//   anywhere applies everywhere (subscribe/useCredentials). Saving, replacing or
//   removing the token locks it.
// - "Unlocked" means the password decrypted the token locally. Whether OpenAI accepts
//   the token is tracked separately (`openai`), from the result of real requests.
// - Never put the token in logs, error messages or URLs.
import { useSyncExternalStore } from "react";

export const TOKEN_KEY = "dnd-battle-tracker-api-token-v1";
export const MIN_PASSWORD = 12;

export interface EncryptedToken { algorithm: "AES-256-GCM"; kdf: "PBKDF2-SHA-256"; iterations: number; salt: string; iv: string; ciphertext: string }

export type OpenAiCheck = "unchecked" | "accepted" | "rejected";
export type CredentialState =
  | { status: "missing" }                 // no token saved in this browser
  | { status: "locked" }
  | { status: "unlocked"; openai: OpenAiCheck };

export class IncorrectPasswordError extends Error {
  constructor() { super("Incorrect encryption password. Try again."); this.name = "IncorrectPasswordError"; }
}
export class NoTokenError extends Error {
  constructor() { super("No OpenAI API token is saved yet. Add one in Settings → AI Encounter Generation."); this.name = "NoTokenError"; }
}

const ITERATIONS = 310000;
const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
const bufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fromBase64 = (value: string): ArrayBuffer => bufferOf(Uint8Array.from(atob(value), c => c.charCodeAt(0)));

async function derive(password: string, salt: ArrayBuffer, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bufferOf(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function isEncryptedToken(v: unknown): v is EncryptedToken {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<EncryptedToken>;
  return t.algorithm === "AES-256-GCM" && t.kdf === "PBKDF2-SHA-256" && t.iterations === ITERATIONS
    && typeof t.salt === "string" && typeof t.iv === "string" && typeof t.ciphertext === "string";
}

export async function encryptToken(token: string, password: string): Promise<EncryptedToken> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, bufferOf(salt), ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferOf(iv) }, key, bufferOf(new TextEncoder().encode(token)));
  return { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Decrypts locally. A wrong password fails AES-GCM authentication → IncorrectPasswordError. */
export async function decryptToken(encrypted: EncryptedToken, password: string): Promise<string> {
  if (!isEncryptedToken(encrypted)) throw new Error("The saved token uses unsupported encryption settings.");
  const key = await derive(password, fromBase64(encrypted.salt), encrypted.iterations);
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(encrypted.iv) }, key, fromBase64(encrypted.ciphertext)));
  } catch {
    throw new IncorrectPasswordError();
  }
}

// ---- Storage ----
export function loadEncryptedToken(): EncryptedToken | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null");
    return isEncryptedToken(v) ? v : null;
  } catch { return null; }
}

/** Encrypts and saves a new or replacement token (locks any unlocked one). Throws with a readable message. */
export async function saveToken(token: string, password: string, confirmation: string): Promise<void> {
  const t = token.trim();
  if (!t) throw new Error("Enter an API token.");
  if (/\s/.test(t) || t.length > 512) throw new Error("That doesn't look like an API token.");
  if (password.length < MIN_PASSWORD) throw new Error("Use an encryption password of at least " + MIN_PASSWORD + " characters.");
  if (password !== confirmation) throw new Error("Encryption passwords do not match.");
  const encrypted = await encryptToken(t, password);
  localStorage.setItem(TOKEN_KEY, JSON.stringify(encrypted));
  plaintext = null;
  emit();
}

/** Deletes the saved token (and forgets an unlocked one). */
export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
  plaintext = null;
  emit();
}

// ---- The one shared unlock state ----
let plaintext: string | null = null;
let openai: OpenAiCheck = "unchecked";
const listeners = new Set<() => void>();
let state: CredentialState = computeState();
function computeState(): CredentialState {
  if (plaintext) return { status: "unlocked", openai };
  return loadEncryptedToken() ? { status: "locked" } : { status: "missing" };
}
function emit() { state = computeState(); listeners.forEach(l => l()); }

// Another tab saving or removing the token updates this one.
if (typeof window !== "undefined") window.addEventListener("storage", e => { if (e.key === TOKEN_KEY || e.key === null) emit(); });

export function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const getState = (): CredentialState => state;

/** Decrypts the saved token with the password. Wrong password → IncorrectPasswordError, and nothing is unlocked. */
export async function unlock(password: string): Promise<void> {
  const encrypted = loadEncryptedToken();
  if (!encrypted) { emit(); throw new NoTokenError(); }
  if (!password) throw new IncorrectPasswordError();
  plaintext = await decryptToken(encrypted, password);
  openai = "unchecked";
  emit();
}

/** Forgets the plaintext token everywhere in this app. */
export function lock() { plaintext = null; emit(); }

/** The plaintext token for an outgoing request, or null when locked. */
export const getToken = (): string | null => plaintext;

/** Records what OpenAI said about the token on a real request. */
export function reportOpenAiResult(accepted: boolean) {
  if (!plaintext) return;
  openai = accepted ? "accepted" : "rejected";
  emit();
}

/** React hook: the shared credential state, re-rendering on unlock/lock anywhere. */
export function useCredentials(): CredentialState {
  return useSyncExternalStore(subscribe, getState, getState);
}
