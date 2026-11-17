// "Generate with AI": types, settings, the compact monster catalog sent to the
// model, validation of what comes back, and mapping it onto an encounter.
//
// The request goes through the Netlify function netlify/functions/generate-encounter.mjs,
// which holds the strict JSON Schema sent to OpenAI. AiEncounter below is the
// matching client-side type; LIMITS must stay in step with that file.
import { useEffect, useState } from "react";
import type { AvoidOption, Encounter, EncounterMonster } from "../models/battle";
import type { Monster } from "../models/monster";
import { encounterDifficulty, monsterXp } from "./difficulty";
import { crValue } from "./format";
import { environmentsOf } from "./generate";

// ---------- Settings (Settings tab → AI Encounter Generation) ----------

export const AI_SETTINGS_KEY = "dnd-battle-tracker-ai-v1";

export const DEFAULT_INSTRUCTIONS = `You are an experienced Dungeons & Dragons 5E Dungeon Master creating encounters on the fly.

Given the party composition, character levels, desired difficulty, available monster catalog, and the DM's description of the situation, create an engaging, believable encounter.

Return an encounter name, a list of monsters, a dramatic Read-Aloud description, the opponents' motivations, possible ways to avoid combat, suggested skill checks and difficulty classes, tactical guidance, and appropriate treasure.

The Read-Aloud must describe what the characters can see, hear, or otherwise perceive. It should establish the situation without revealing secret DM information and end with the exact words 'So what do you do'.

Explain what attracted the opponents to the party and why confrontation might occur.

Provide meaningful opportunities for the PCs to avoid combat through negotiation, stealth, intimidation, bribery, retreat, or other appropriate actions. Include suggested ability checks, DCs, and outcomes for success and failure.

Select monsters exclusively from the supplied catalog. Use valid monster UUIDs and reasonable quantities.

Make the encounter appropriate for the selected party and difficulty.

Include treasure appropriate to the creatures, setting, and encounter.

Return only valid JSON matching the supplied schema.`;

/** Current OpenAI text models (Nov 2026 pricing page). Any model with Structured Outputs works; the field is free text. */
export const SUGGESTED_MODELS = ["gpt-6.1-terra", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"];
export const DEFAULT_MODEL = "gpt-6.1-terra";
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const MAX_INSTRUCTIONS = 20000;
export const MAX_SITUATION = 4000;

export interface AiSettings { instructions: string; model: string }
export const AI_DEFAULTS: AiSettings = { instructions: DEFAULT_INSTRUCTIONS, model: DEFAULT_MODEL };

export function loadAiSettings(): AiSettings {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? "null");
    if (v && typeof v === "object") {
      const s = v as Partial<AiSettings>;
      return {
        instructions: typeof s.instructions === "string" && s.instructions.trim() ? s.instructions : AI_DEFAULTS.instructions,
        model: typeof s.model === "string" && MODEL_PATTERN.test(s.model) ? s.model : AI_DEFAULTS.model,
      };
    }
  } catch { /* defaults */ }
  return AI_DEFAULTS;
}

const settingsListeners = new Set<() => void>();
export function saveAiSettings(s: AiSettings) {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s));
  settingsListeners.forEach(l => l());
}
/** The saved settings, updated when Settings saves them. */
export function useAiSettings(): AiSettings {
  const [s, setS] = useState(loadAiSettings);
  useEffect(() => { const l = () => setS(loadAiSettings()); settingsListeners.add(l); return () => { settingsListeners.delete(l); }; }, []);
  return s;
}

// ---------- The response (client-side type of the server's JSON Schema) ----------

export interface AiMonsterPick { monster_id: string; count: number }
export interface AiEncounter {
  encounter_name: string;
  read_aloud: string;
  motivation: string;
  avoiding_combat: AvoidOption[];
  dm_tactics: string;
  treasure: string;
  monsters: AiMonsterPick[];
}

/** Length limits (characters). Keep in step with netlify/functions/generate-encounter.mjs. */
export const LIMITS = {
  encounter_name: 120, read_aloud: 5000, motivation: 3000, dm_tactics: 4000, treasure: 3000,
  option_text: 1000, options_max: 10, monsters_max: 12, count_max: 99, total_max: 99,
} as const;

export interface ValidPick { monster: Monster; count: number }
export type Validation = { ok: true; encounter: AiEncounter; picks: ValidPick[] } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Checks a response against the schema and the local catalog. Never substitutes monsters: unknown IDs are errors. */
export function validateAiEncounter(raw: unknown, byId: ReadonlyMap<string, Monster>): Validation {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["The response wasn't a JSON object."] };
  const text = (key: keyof typeof LIMITS, label: string, allowEmpty = false): string => {
    const v = raw[key];
    if (typeof v !== "string") { errors.push(label + " is missing."); return ""; }
    const t = v.trim();
    if (!t && !allowEmpty) errors.push(label + " is empty.");
    if (t.length > LIMITS[key]) errors.push(label + " is too long (" + t.length + " characters; limit " + LIMITS[key] + ").");
    return t;
  };
  const encounter_name = text("encounter_name", "Encounter name");
  const read_aloud = text("read_aloud", "Read-aloud text");
  const motivation = text("motivation", "Opponent motivation");
  const dm_tactics = text("dm_tactics", "DM tactics");
  const treasure = text("treasure", "Treasure", true);

  const avoiding_combat: AvoidOption[] = [];
  if (!Array.isArray(raw.avoiding_combat)) errors.push("Ways to avoid combat are missing.");
  else {
    if (raw.avoiding_combat.length > LIMITS.options_max) errors.push("Too many ways to avoid combat (" + raw.avoiding_combat.length + "; limit " + LIMITS.options_max + ").");
    raw.avoiding_combat.slice(0, LIMITS.options_max).forEach((o, i) => {
      const n = "Way to avoid combat " + (i + 1);
      if (!isObj(o)) { errors.push(n + " is malformed."); return; }
      const f = (k: string) => typeof o[k] === "string" && (o[k] as string).trim() && (o[k] as string).length <= LIMITS.option_text ? (o[k] as string).trim() : null;
      const [action, check, success, failure] = ["action", "check", "success", "failure"].map(f);
      const dc = o.dc;
      if (!action || !check || !success || !failure) { errors.push(n + " is missing text or has text that is too long."); return; }
      if (typeof dc !== "number" || !Number.isInteger(dc) || dc < 1 || dc > 40) { errors.push(n + " has an invalid DC."); return; }
      avoiding_combat.push({ action, check, dc, success, failure });
    });
  }

  const picks: ValidPick[] = [];
  const monsters: AiMonsterPick[] = [];
  if (!Array.isArray(raw.monsters)) errors.push("The monster list is missing.");
  else if (raw.monsters.length === 0) errors.push("The response contains no monsters.");
  else if (raw.monsters.length > LIMITS.monsters_max) errors.push("Too many different monsters (" + raw.monsters.length + "; limit " + LIMITS.monsters_max + ").");
  else {
    const unknown: string[] = [];
    for (const [i, m] of raw.monsters.entries()) {
      if (!isObj(m) || typeof m.monster_id !== "string") { errors.push("Monster " + (i + 1) + " is malformed."); continue; }
      const count = m.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > LIMITS.count_max) { errors.push("Monster " + (i + 1) + " has an invalid count (" + String(count) + ")."); continue; }
      const monster = byId.get(m.monster_id);
      if (!monster) { unknown.push(m.monster_id.slice(0, 60)); continue; }
      // The same monster listed twice is merged into one entry.
      const existing = picks.find(p => p.monster.id === monster.id);
      if (existing) existing.count += count; else picks.push({ monster, count });
    }
    if (unknown.length) errors.push("Unknown monster ID" + (unknown.length === 1 ? "" : "s") + " not in your catalog: " + unknown.join(", ") + ". No substitutes were chosen.");
    const total = picks.reduce((n, p) => n + p.count, 0);
    if (picks.some(p => p.count > LIMITS.count_max)) errors.push("A monster appears more than " + LIMITS.count_max + " times.");
    if (total > LIMITS.total_max) errors.push("Too many monsters in total (" + total + "; limit " + LIMITS.total_max + ").");
    for (const p of picks) monsters.push({ monster_id: p.monster.id, count: p.count });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, encounter: { encounter_name, read_aloud, motivation, avoiding_combat, dm_tactics, treasure, monsters }, picks };
}

// ---------- The compact catalog sent to the model ----------

export interface CatalogRow { id: string; name: string; cr: string; xp: number; type: string; size: string; environments: string[] }
/** Most monsters sent in one request (roughly 25–30 tokens each). */
export const CATALOG_MAX = 400;

/**
 * Deterministic selection: monsters with known XP that fit the High budget on their own
 * (a bigger one can't belong in the encounter). When more than CATALOG_MAX remain, monsters
 * from the chosen environment come first, then custom monsters, then the rest by CR (strongest
 * first, since weak ones are the least likely to be missed), then name.
 */
export function compactCatalog(monsters: Monster[], o: { maxXp: number; environment?: string }): CatalogRow[] {
  const rows = monsters.flatMap(m => {
    const xp = monsterXp(m.challenge_rating);
    if (xp === null || xp > o.maxXp) return [];
    return [{ m, row: { id: m.id, name: m.name, cr: m.challenge_rating, xp, type: m.type, size: m.size, environments: environmentsOf(m) } }];
  });
  if (rows.length <= CATALOG_MAX) return rows.map(r => r.row).sort((a, b) => a.name.localeCompare(b.name));
  const env = o.environment;
  const rank = (r: typeof rows[number]) => (env && r.row.environments.includes(env) ? 0 : 2) + (r.m.source.type === "homebrew" ? 0 : 1);
  return rows
    .sort((a, b) => rank(a) - rank(b) || crValue(b.m.challenge_rating) - crValue(a.m.challenge_rating) || a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id))
    .slice(0, CATALOG_MAX)
    .map(r => r.row)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Request ----------

export type TargetDifficulty = "low" | "moderate" | "high";
export interface GenerateRequest {
  model: string;
  instructions: string;
  situation: string;
  party: { name: string; level: number }[];
  difficulty: TargetDifficulty;
  budget: { low: number; moderate: number; high: number };
  environment: string;
  catalog: CatalogRow[];
}

/** Builds the request, or explains why one can't be made yet. */
export function buildRequest(o: {
  settings: AiSettings; situation: string; party: { name: string; level: number }[];
  difficulty: TargetDifficulty; environment?: string; monsters: Monster[];
}): { request: GenerateRequest } | { error: string } {
  const situation = o.situation.trim();
  if (!situation) return { error: "Describe the encounter situation first." };
  if (situation.length > MAX_SITUATION) return { error: "The situation is too long (" + situation.length + " characters; limit " + MAX_SITUATION + ")." };
  const diff = encounterDifficulty(o.party.map(p => p.level), []);
  if (!diff) return { error: "Select at least one party member — the encounter is sized to them." };
  if (!MODEL_PATTERN.test(o.settings.model)) return { error: "Choose a valid AI model in Settings → AI Encounter Generation." };
  if (o.settings.instructions.length > MAX_INSTRUCTIONS) return { error: "The encounter instructions in Settings are too long (limit " + MAX_INSTRUCTIONS + " characters)." };
  const catalog = compactCatalog(o.monsters, { maxXp: diff.budget.high, environment: o.environment });
  if (!catalog.length) return { error: "No monsters are available to choose from. Wait for the catalog to load, or check that it loaded without errors." };
  return { request: {
    model: o.settings.model, instructions: o.settings.instructions, situation,
    party: o.party.map(p => ({ name: (p.name || "Unnamed character").slice(0, 80), level: p.level })),
    difficulty: o.difficulty, budget: diff.budget, environment: o.environment ?? "", catalog,
  } };
}

// ---------- Calling the function ----------

export const FUNCTION_URL = "/.netlify/functions/generate-encounter";
/** Give up a little after Netlify's ~30-second limit for synchronous functions. */
export const CLIENT_TIMEOUT_MS = 45000;

export type AiErrorCode =
  | "invalid_token" | "insufficient_quota" | "rate_limited" | "unsupported_model" | "timeout"
  | "network" | "invalid_response" | "refused" | "bad_request" | "server" | "canceled";
export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) { super(message); this.code = code; this.name = "AiError"; }
}

/** Redacts anything that looks like an OpenAI key from text shown to the user. */
export const redact = (text: string) => text.replace(/sk-[A-Za-z0-9_*.-]{4,}/g, "sk-…");

/**
 * Sends the request with the unlocked token. Resolves with the parsed JSON response
 * (not yet validated against the catalog). Rejects with AiError; canceled requests
 * reject with code "canceled" and must not change the interface.
 */
export async function requestEncounter(req: GenerateRequest, token: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CLIENT_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal.addEventListener("abort", onAbort);
  let response: Response;
  try {
    response = await fetchImpl(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The token travels in the HTTPS request body only, never in the URL.
      body: JSON.stringify({ ...req, token }),
      signal: timeout.signal,
    });
  } catch {
    if (signal.aborted) throw new AiError("canceled", "Canceled.");
    if (timeout.signal.aborted) throw new AiError("timeout", "No answer after " + CLIENT_TIMEOUT_MS / 1000 + " seconds. Try again, or choose a faster model in Settings.");
    throw new AiError("network", "Couldn't reach the Scrap Sheet server. Check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) throw new AiError("canceled", "Canceled.");
  const raw = await response.text().catch(() => "");
  if (signal.aborted) throw new AiError("canceled", "Canceled.");
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* not JSON: e.g. an HTML error page */ }
  if (!response.ok) {
    const err = isObj(body) && isObj(body.error) ? body.error : null;
    const code = err && typeof err.code === "string" ? err.code as AiErrorCode : null;
    const message = err && typeof err.message === "string" ? redact(err.message) : null;
    if (code && message) throw new AiError(code, message);
    if (response.status === 504 || response.status === 502) throw new AiError("timeout", "The server took too long to answer (Netlify allows about 30 seconds). Try again, or choose a faster model in Settings.");
    if (response.status === 404) throw new AiError("server", "The AI function isn't available on this site. If you're running locally, use npm run dev (not npm run preview).");
    throw new AiError("server", "Unexpected server response (HTTP " + response.status + "). Try again later.");
  }
  if (!isObj(body) || !("encounter" in body)) throw new AiError("invalid_response", "The server's answer wasn't in the expected format.");
  return body.encounter;
}

// ---------- Applying ----------

/** The encounter fields a generated result fills in (party, environment and notes are kept). */
export function toEncounterPatch(e: AiEncounter, picks: ValidPick[]): Partial<Encounter> {
  const monsters: EncounterMonster[] = picks.map(p => ({ monster_id: p.monster.id, monster_name: p.monster.name, count: p.count, group_initiative: false }));
  return {
    name: e.encounter_name, read_aloud: e.read_aloud, motivation: e.motivation,
    avoiding_combat: e.avoiding_combat.map(o => ({ ...o })), dm_tactics: e.dm_tactics,
    treasure: e.treasure || undefined, monsters,
  };
}

/** Names of the filled-in parts of an encounter that applying a result would replace. */
export function fieldsToReplace(e: Encounter): string[] {
  const out: string[] = [];
  if (e.monsters.length) out.push("monsters");
  if (e.read_aloud?.trim()) out.push("read-aloud");
  if (e.motivation?.trim()) out.push("motivation");
  if (e.avoiding_combat?.length) out.push("ways to avoid combat");
  if (e.dm_tactics?.trim()) out.push("DM tactics");
  if (e.treasure?.trim()) out.push("treasure");
  return out;
}
