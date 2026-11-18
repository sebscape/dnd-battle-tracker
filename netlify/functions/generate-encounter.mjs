// Netlify Function: POST /.netlify/functions/generate-encounter
//
// Generates an encounter with the OpenAI Responses API and a strict JSON Schema.
// The caller sends the user's own OpenAI token in the HTTPS request body. It is used
// for this one request only: never stored, logged, echoed back or put in a URL.
//
// Synchronous on purpose: an encounter is a few hundred words, which normally takes
// well under Netlify's ~30-second limit for synchronous functions. The OpenAI call is
// cut off at OPENAI_TIMEOUT_MS so the browser gets a clear error rather than a bare 504.
//
// Errors are always JSON: { error: { code, message } }. Codes match AiErrorCode in
// src/lib/aiEncounter.ts, which also has the client-side type of the schema below.

export const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 26000;
const MAX_BODY_BYTES = 200 * 1024;
const MAX_OUTPUT_TOKENS = 8000;

/** Keep in step with LIMITS in src/lib/aiEncounter.ts. */
export const LIMITS = {
  encounter_name: 120, read_aloud: 5000, motivation: 3000, dm_tactics: 4000, treasure: 3000,
  option_text: 1000, options_max: 10, monsters_max: 12, count_max: 99,
  instructions: 20000, situation: 4000, catalog_max: 400, party_max: 12,
};

const text = description => ({ type: "string", description });

/**
 * Strict Structured Outputs schema. Strict mode requires every property to be listed in
 * `required` and `additionalProperties: false`, and doesn't support length limits, so
 * lengths, DC ranges and monster IDs are checked in code (here and in the browser).
 */
export const ENCOUNTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["encounter_name", "read_aloud", "motivation", "avoiding_combat", "dm_tactics", "treasure", "monsters"],
  properties: {
    encounter_name: text("A short, evocative name for the encounter."),
    read_aloud: text("Boxed text for the DM to read aloud: only what the characters can perceive. Ends with the closing words the instructions ask for."),
    motivation: text("Why the opponents are here, what drew them to the party, and why confrontation might occur."),
    avoiding_combat: {
      type: "array",
      description: "Ways the characters might avoid combat.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "check", "dc", "success", "failure"],
        properties: {
          action: text("What the characters do, e.g. 'Offer food'."),
          check: text("The ability check, e.g. 'Wisdom (Animal Handling)'. An empty string if no roll is needed."),
          dc: { type: "integer", description: "Difficulty class, usually 10 to 25. 0 if no roll is needed." },
          success: text("What happens on a success."),
          failure: text("What happens on a failure."),
        },
      },
    },
    dm_tactics: text("How the opponents fight and react, for the DM."),
    treasure: text("Treasure appropriate to the creatures and setting; may say there is none."),
    monsters: {
      type: "array",
      description: "Every person or creature the characters meet, hostile or not, chosen only from the supplied catalog (e.g. a traveling merchant as a Commoner), so the DM has a stat block for each.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["monster_id", "count"],
        properties: {
          monster_id: text("The exact monster_id (UUID) of a catalog entry."),
          count: { type: "integer", description: "How many of this monster, at least 1." },
        },
      },
    },
  },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const fail = (status, code, message) => json({ error: { code, message } }, status);
const MAX_ANSWER_ECHO = 30000;
/** OpenAI's own messages can quote part of the key ("Incorrect API key provided: sk-ab***yz"). */
const redact = s => String(s).replace(/sk-[A-Za-z0-9_*.-]{4,}/g, "sk-…").slice(0, 400);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStr = (v, max, min = 1) => typeof v === "string" && v.trim().length >= min && v.length <= max;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const clean = (s, max) => String(s).replace(/[\r\n|]+/g, " ").trim().slice(0, max);

/** Validates the browser's request. Returns an error message, or null. */
export function checkRequest(b) {
  if (!b || typeof b !== "object") return "Invalid request.";
  if (typeof b.token !== "string" || !b.token.startsWith("sk-") || b.token.length > 512 || /\s/.test(b.token)) return "A valid OpenAI API token is required.";
  if (typeof b.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(b.model)) return "Invalid model name.";
  if (!isStr(b.instructions, LIMITS.instructions)) return "The encounter instructions are missing or too long.";
  if (!isStr(b.situation, LIMITS.situation)) return "The situation is missing or too long.";
  if (!["low", "moderate", "high"].includes(b.difficulty)) return "Invalid difficulty.";
  const bud = b.budget;
  if (!bud || !["low", "moderate", "high"].every(k => isInt(bud[k], 1, 10_000_000))) return "Invalid XP budget.";
  if (typeof b.environment !== "string" || b.environment.length > 40) return "Invalid environment.";
  if (!Array.isArray(b.party) || b.party.length < 1 || b.party.length > LIMITS.party_max
    || !b.party.every(p => p && isStr(p.name, 80) && isInt(p.level, 1, 20))) return "Invalid party.";
  if (!Array.isArray(b.catalog) || b.catalog.length < 1 || b.catalog.length > LIMITS.catalog_max
    || !b.catalog.every(m => m && typeof m.id === "string" && UUID.test(m.id) && isStr(m.name, 120) && isStr(m.cr, 8)
      && isInt(m.xp, 0, 1_000_000) && isStr(m.type, 60) && isStr(m.size, 30)
      && Array.isArray(m.environments) && m.environments.length <= 12 && m.environments.every(e => isStr(e, 30)))) return "Invalid monster catalog.";
  return null;
}

/** The user message: everything the model needs, in plain text. */
export function buildInput(b) {
  const floor = b.difficulty === "high" ? b.budget.moderate : b.difficulty === "moderate" ? b.budget.low : Math.floor(b.budget.low / 2);
  const target = b.budget[b.difficulty];
  return [
    "## The DM's description of the situation",
    b.situation.trim(),
    "",
    "## Party (" + b.party.length + " characters)",
    ...b.party.map(p => "- " + clean(p.name, 80) + ", level " + p.level),
    "",
    "## Desired difficulty: " + b.difficulty,
    "Using the SRD 5.2.1 XP budget, this party's budgets are Low " + b.budget.low + " XP, Moderate " + b.budget.moderate + " XP, High " + b.budget.high + " XP.",
    "If the encounter may turn into a fight, choose monsters whose total XP (XP × count, added up) is between " + floor + " and " + target + " XP. Use at most two monsters per character unless the situation calls for a swarm of weak creatures. A peaceful encounter may come in under this budget.",
    b.environment ? "\n## Environment\n" + clean(b.environment, 40) : "",
    "",
    "## Monster catalog",
    "List EVERY person or creature in the encounter in `monsters`, even those who are friendly or need no roll to deal with, so the DM has a stat block if the characters attack. Pick the closest catalog entry for each (for example, a merchant or farmer as a Commoner, soldiers as Guards). Never describe a person or creature in the encounter without listing it.",
    "Use ONLY monster_id values from this list, copied exactly. Columns: monster_id | name | CR | XP each | size and type | environments",
    ...b.catalog.map(m => [m.id, clean(m.name, 120), m.cr, m.xp, clean(m.size + " " + m.type, 90), m.environments.map(e => clean(e, 30)).join(", ") || "any"].join(" | ")),
  ].join("\n");
}

const shown = v => v === undefined ? "nothing" : JSON.stringify(v).slice(0, 60);
/** Describes a text field's problem, or null when it's fine. */
function textProblem(v, max, allowEmpty) {
  if (typeof v !== "string") return "missing (got " + shown(v) + ")";
  if (!allowEmpty && !v.trim()) return "empty";
  if (v.length > max) return "too long (" + v.length + " characters; limit " + max + ")";
  return null;
}
const LABEL = { encounter_name: "Encounter name", read_aloud: "Read-aloud", motivation: "Motivation", dm_tactics: "DM tactics", treasure: "Treasure" };

/**
 * Shape and length check of the model's JSON (monster IDs are checked against the catalog
 * sent). Returns a message naming the exact item and field that failed, or null.
 * Keep in step with validateAiEncounter in src/lib/aiEncounter.ts.
 */
export function checkEncounter(e, catalogIds) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return "The answer wasn't a JSON object.";
  for (const k of ["encounter_name", "read_aloud", "motivation", "dm_tactics", "treasure"]) {
    const p = textProblem(e[k], LIMITS[k], k === "treasure");
    if (p) return LABEL[k] + ": " + p + ".";
  }
  if (!Array.isArray(e.avoiding_combat)) return "Ways to avoid combat: missing (got " + shown(e.avoiding_combat) + ").";
  if (e.avoiding_combat.length > LIMITS.options_max) return "Ways to avoid combat: too many (" + e.avoiding_combat.length + "; limit " + LIMITS.options_max + ").";
  for (const [i, o] of e.avoiding_combat.entries()) {
    const n = "Way to avoid combat " + (i + 1);
    if (!o || typeof o !== "object") return n + ": not an object.";
    for (const k of ["action", "success", "failure"]) { const p = textProblem(o[k], LIMITS.option_text, false); if (p) return n + ": " + k + " is " + p + "."; }
    const pc = textProblem(o.check, LIMITS.option_text, true); if (pc) return n + ": check is " + pc + ".";
    if (!isInt(o.dc, 0, 40)) return n + ": DC must be a whole number from 0 to 40 (got " + shown(o.dc) + ").";
  }
  if (!Array.isArray(e.monsters)) return "Monsters: missing (got " + shown(e.monsters) + ").";
  if (e.monsters.length < 1) return "Monsters: the answer chose no monsters. An encounter needs at least one creature (for a peaceful meeting, the people or creatures met).";
  if (e.monsters.length > LIMITS.monsters_max) return "Monsters: too many different monsters (" + e.monsters.length + "; limit " + LIMITS.monsters_max + ").";
  for (const [i, m] of e.monsters.entries()) {
    if (!m || typeof m.monster_id !== "string") return "Monster " + (i + 1) + ": monster_id is missing.";
    if (!isInt(m.count, 1, LIMITS.count_max)) return "Monster " + (i + 1) + ": count must be a whole number from 1 to " + LIMITS.count_max + " (got " + shown(m.count) + ").";
  }
  const unknown = e.monsters.filter(m => !catalogIds.has(m.monster_id));
  if (unknown.length) return "Monsters: the answer used " + (unknown.length === 1 ? "a monster ID that isn't" : unknown.length + " monster IDs that aren't") + " in your catalog (" + unknown.map(m => shown(m.monster_id)).join(", ") + "). No substitutes were chosen.";
  return null;
}

/** Maps an OpenAI error response to { status, code, message } without exposing the token. */
export function mapOpenAiError(status, body) {
  const err = body && body.error ? body.error : {};
  const code = typeof err.code === "string" ? err.code : "";
  const msg = typeof err.message === "string" ? redact(err.message) : "";
  if (status === 401) return { status: 401, code: "invalid_token", message: "OpenAI rejected the API token (it may be wrong, revoked or expired). Replace it in Settings → AI Encounter Generation." };
  if (status === 429 && (code === "insufficient_quota" || /quota|billing|credit/i.test(msg)))
    return { status: 402, code: "insufficient_quota", message: "Your OpenAI account is out of credit or over its spending limit. Check billing at platform.openai.com." };
  if (status === 429) return { status: 429, code: "rate_limited", message: "OpenAI is limiting requests right now. Wait a minute and try again." };
  if (status === 404 || code === "model_not_found" || (status === 400 && /model/i.test(String(err.param || "")) ))
    return { status: 400, code: "unsupported_model", message: "OpenAI doesn't offer that model to your account. Choose another in Settings → AI Encounter Generation." + (msg ? " (" + msg + ")" : "") };
  if (status === 400 && /json_schema|text\.format|response_format|structured/i.test(msg + " " + String(err.param || "")))
    return { status: 400, code: "unsupported_model", message: "That model doesn't support structured JSON output. Choose another in Settings → AI Encounter Generation." };
  if (status >= 500) return { status: 502, code: "server", message: "OpenAI had a problem answering. Try again in a moment." };
  return { status: 400, code: "bad_request", message: "OpenAI couldn't process the request" + (msg ? ": " + msg : ".") };
}

/** Pulls the JSON text (or a refusal) out of a Responses API result. */
export function extractOutput(result) {
  if (result && result.status === "incomplete") {
    const why = result.incomplete_details && result.incomplete_details.reason;
    return { error: why === "max_output_tokens" ? "The answer was cut off because it ran too long. Try again." : "The answer was incomplete" + (why ? " (" + why + ")" : "") + ". Try again." };
  }
  for (const item of Array.isArray(result && result.output) ? result.output : []) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c && c.type === "refusal") return { refusal: typeof c.refusal === "string" ? c.refusal.slice(0, 400) : "The model declined." };
      if (c && c.type === "output_text" && typeof c.text === "string") return { text: c.text };
    }
  }
  return { error: "The answer contained no text." };
}

/**
 * What was sent and received, returned with every answer after the request was accepted,
 * so the app can show the conversation (the spyglass). Never contains the token.
 */
function conversationOf(b, input, extra = {}) {
  return { model: b.model, instructions: b.instructions, input, ...extra };
}
const usageOf = r => r && r.usage && typeof r.usage === "object"
  ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, total_tokens: r.usage.total_tokens } : undefined;
const errorWith = (status, code, message, conversation, answer) =>
  json({ error: answer === undefined ? { code, message } : { code, message, answer }, conversation }, status);

/** `deps` exists for tests (a fake fetch, a short timeout); Netlify passes only (request, context). */
export default async function handler(request, _context, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const timeoutMs = deps.timeoutMs || OPENAI_TIMEOUT_MS;
  if (request.method !== "POST") return fail(405, "bad_request", "POST required.");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return fail(413, "bad_request", "The request is too large.");
  let b;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, "bad_request", "The request is too large.");
    b = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "The request wasn't valid JSON.");
  }
  const problem = checkRequest(b);
  if (problem) return fail(400, problem.includes("token") ? "invalid_token" : "bad_request", problem);

  const input = buildInput(b);
  const convo = extra => conversationOf(b, input, extra);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + b.token, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: b.model,
        instructions: b.instructions,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
        text: { format: { type: "json_schema", name: "encounter", strict: true, schema: ENCOUNTER_SCHEMA } },
      }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) return errorWith(504, "timeout", "OpenAI took longer than " + Math.round(timeoutMs / 1000) + " seconds. Try again, or choose a faster model in Settings → AI Encounter Generation.", convo());
    return errorWith(502, "network", "Couldn't reach OpenAI. Try again in a moment.", convo());
  } finally {
    clearTimeout(timer);
  }

  let result = null;
  try { result = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const e = mapOpenAiError(response.status, result);
    const raw = result && result.error && typeof result.error.message === "string" ? redact(result.error.message) : undefined;
    return errorWith(e.status, e.code, e.message, convo({ openai_status: response.status, openai_error: raw }));
  }
  if (!result) return errorWith(502, "invalid_response", "OpenAI's answer wasn't valid JSON.", convo({ openai_status: response.status }));
  const out = extractOutput(result);
  const seen = convo({ openai_status: response.status, status: result.status, usage: usageOf(result), output: out.text, refusal: out.refusal });
  if (out.refusal) return errorWith(422, "refused", "The model declined to write this encounter: " + out.refusal, seen);
  if (out.error) return errorWith(502, "invalid_response", out.error, seen);
  let encounter;
  try { encounter = JSON.parse(out.text); } catch { return errorWith(502, "invalid_response", "The model's answer wasn't valid JSON.", seen, out.text.slice(0, MAX_ANSWER_ECHO)); }
  const bad = checkEncounter(encounter, new Set(b.catalog.map(m => m.id)));
  if (bad) {
    // Shows up in Netlify's function log (or the npm run dev terminal). Never log the request: it holds the token.
    console.warn("generate-encounter: rejected the model's answer: " + bad);
    return errorWith(502, "invalid_response", bad, seen, JSON.stringify(encounter, null, 2).slice(0, MAX_ANSWER_ECHO));
  }
  return json({ encounter, conversation: seen });
}

export const config = { path: "/.netlify/functions/generate-encounter" };
