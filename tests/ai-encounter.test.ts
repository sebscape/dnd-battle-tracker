import { test } from "node:test";
import assert from "node:assert/strict";
import { AiError, CATALOG_MAX, FUNCTION_URL, buildRequest, compactCatalog, fieldsToReplace, redact, requestEncounter, toEncounterPatch, validateAiEncounter, AI_DEFAULTS } from "../src/lib/aiEncounter.ts";
import { newEncounter } from "../src/models/battle.ts";
import { byId, catalog, direWolf, dragon, goodAnswer, monster, ogre, wolf } from "./fixtures.ts";

test("a valid answer is accepted and mapped to catalog monsters", () => {
  const v = validateAiEncounter(goodAnswer(), byId);
  assert.ok(v.ok);
  assert.deepEqual(v.picks.map(p => [p.monster.name, p.count]), [["Wolf", 3], ["Dire Wolf", 1]]);
});

test("unknown monster IDs are rejected, never substituted", () => {
  const a = goodAnswer();
  a.monsters.push({ monster_id: "11111111-2222-4333-8444-555555555555", count: 2 });
  const v = validateAiEncounter(a, byId);
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.errors.join(" ") : "", /Unknown monster ID.*11111111-2222.*No substitutes/);
});

test("counts must be positive integers within limits", () => {
  for (const count of [0, -1, 1.5, "3", 100]) {
    const a = goodAnswer() as any;
    a.monsters[0].count = count;
    assert.equal(validateAiEncounter(a, byId).ok, false, "count " + String(count));
  }
});

test("duplicate monster entries are merged", () => {
  const a = goodAnswer();
  a.monsters.push({ monster_id: wolf.id, count: 2 });
  const v = validateAiEncounter(a, byId);
  assert.ok(v.ok && v.picks.find(p => p.monster.id === wolf.id)!.count === 5);
});

test("missing, empty, malformed or overlong fields are rejected", () => {
  const cases: [string, (a: any) => void][] = [
    ["not an object", () => {}],
    ["missing name", a => { delete a.encounter_name; }],
    ["empty read-aloud", a => { a.read_aloud = "  "; }],
    ["overlong tactics", a => { a.dm_tactics = "x".repeat(5000); }],
    ["bad DC", a => { a.avoiding_combat[0].dc = 99; }],
    ["option missing text", a => { delete a.avoiding_combat[0].failure; }],
    ["no monsters", a => { a.monsters = []; }],
    ["monsters not an array", a => { a.monsters = {}; }],
  ];
  for (const [label, mutate] of cases) {
    const a = goodAnswer() as any;
    mutate(a);
    assert.equal(validateAiEncounter(label === "not an object" ? "nope" : a, byId).ok, false, label);
  }
  // Treasure may be empty ("none").
  const a = goodAnswer(); a.treasure = "";
  assert.ok(validateAiEncounter(a, byId).ok);
});

test("applying maps every field and keeps monster combat stats in the catalog", () => {
  const v = validateAiEncounter(goodAnswer(), byId);
  assert.ok(v.ok);
  const patch = toEncounterPatch(v.encounter, v.picks);
  assert.equal(patch.name, "Hungry Eyes in the Darkness");
  assert.deepEqual(patch.monsters, [
    { monster_id: wolf.id, monster_name: "Wolf", count: 3, group_initiative: false },
    { monster_id: direWolf.id, monster_name: "Dire Wolf", count: 1, group_initiative: false },
  ]);
  assert.equal(patch.avoiding_combat![0].dc, 12);
  assert.equal(patch.treasure, "Nothing but pelts.");
  // The catalog record itself is untouched.
  assert.equal(wolf.hit_points, 11);
});

test("fieldsToReplace lists what would be overwritten", () => {
  const e = newEncounter();
  assert.deepEqual(fieldsToReplace(e), []);
  assert.deepEqual(fieldsToReplace({ ...e, monsters: [{ monster_id: ogre.id, monster_name: "Ogre", count: 1, group_initiative: false }], treasure: "gold" }), ["monsters", "treasure"]);
});

test("the catalog sent leaves out monsters too strong for the High budget, deterministically", () => {
  const rows = compactCatalog(catalog, { maxXp: 1000 });
  assert.deepEqual(rows.map(r => r.name), ["Dire Wolf", "Ogre", "Wolf"]);
  assert.deepEqual(compactCatalog([...catalog].reverse(), { maxXp: 1000 }), rows);
  assert.ok(!rows.some(r => r.id === dragon.id));
  assert.deepEqual(rows.find(r => r.id === wolf.id)!.environments, ["Forest", "Hill"]);
});

test("when the catalog is too big, the chosen environment comes first", () => {
  const many = Array.from({ length: CATALOG_MAX + 50 }, (_, i) => monster("Filler " + i, "1/8"));
  const forest = monster("Forest Sprite", "1/8", { tags: ["Forest"] });
  const rows = compactCatalog([...many, forest], { maxXp: 1000, environment: "Forest" });
  assert.equal(rows.length, CATALOG_MAX);
  assert.ok(rows.some(r => r.id === forest.id));
});

test("buildRequest explains what's missing", () => {
  const base = { settings: AI_DEFAULTS, situation: "Camp by the road", party: [{ name: "Ana", level: 3 }], difficulty: "moderate" as const, monsters: catalog };
  assert.ok("request" in buildRequest(base));
  assert.match((buildRequest({ ...base, situation: " " }) as any).error, /situation/);
  assert.match((buildRequest({ ...base, party: [] }) as any).error, /party/);
  assert.match((buildRequest({ ...base, monsters: [] }) as any).error, /No monsters/);
  assert.match((buildRequest({ ...base, settings: { ...AI_DEFAULTS, model: "bad model!" } }) as any).error, /model/);
});

function request() {
  const r = buildRequest({ settings: AI_DEFAULTS, situation: "Camp", party: [{ name: "Ana", level: 3 }], difficulty: "moderate", monsters: catalog });
  assert.ok("request" in r);
  return r.request;
}

test("the token is sent in the POST body, never in the URL", async () => {
  let seen: { url: string; body: any } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ encounter: goodAnswer() }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await requestEncounter(request(), "sk-secret-123456", new AbortController().signal, fakeFetch);
  assert.deepEqual(out.encounter, goodAnswer());
  assert.equal(seen!.url, FUNCTION_URL);
  assert.ok(!seen!.url.includes("sk-"));
  assert.equal(seen!.body.token, "sk-secret-123456");
});

test("cancel: a late answer is discarded", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const fakeFetch = (async () => {
    await new Promise<void>(r => { release = r; });
    return new Response(JSON.stringify({ encounter: goodAnswer() }), { status: 200 });
  }) as unknown as typeof fetch;
  const pending = requestEncounter(request(), "sk-x-123456", controller.signal, fakeFetch);
  controller.abort();
  release();
  await assert.rejects(pending, (e: unknown) => e instanceof AiError && e.code === "canceled");
});

test("server errors become readable messages without secrets or HTML", async () => {
  const respond = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  const sig = new AbortController().signal;
  await assert.rejects(requestEncounter(request(), "sk-x-123456", sig, respond(401, JSON.stringify({ error: { code: "invalid_token", message: "Incorrect API key provided: sk-abcd****wxyz" } }))),
    (e: any) => e.code === "invalid_token" && !e.message.includes("abcd"));
  await assert.rejects(requestEncounter(request(), "sk-x-123456", sig, respond(504, "<html><body>Gateway Timeout</body></html>")),
    (e: any) => e.code === "timeout" && !e.message.includes("<"));
  await assert.rejects(requestEncounter(request(), "sk-x-123456", sig, respond(500, "<html>oops</html>")),
    (e: any) => e.code === "server" && !e.message.includes("<"));
  await assert.rejects(requestEncounter(request(), "sk-x-123456", sig, (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch),
    (e: any) => e.code === "network");
});

test("redact hides API keys", () => {
  assert.equal(redact("bad key sk-proj-ABCDEF123456 here"), "bad key sk-… here");
});

test("an option that needs no roll is accepted; a bad DC names the option", () => {
  const a = goodAnswer() as any;
  a.avoiding_combat.push({ action: "Chat", check: "", dc: 0, success: "They share news.", failure: "They leave." });
  assert.ok(validateAiEncounter(a, byId).ok);
  a.avoiding_combat[1].dc = "none";
  const v = validateAiEncounter(a, byId);
  assert.ok(!v.ok && v.errors.join(" ").includes('Way to avoid combat 2: DC must be a whole number from 0 to 40 (got "none")'));
});

test("a rejected answer from the server carries the AI's answer, redacted", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ error: { code: "invalid_response", message: "Read-aloud: empty.", answer: '{"note":"sk-proj-ABCDEF123456"}' } }), { status: 502 })) as unknown as typeof fetch;
  await assert.rejects(requestEncounter(request(), "sk-x-123456", new AbortController().signal, fakeFetch),
    (e: any) => e.code === "invalid_response" && e.answer === '{"note":"sk-…"}');
});

test("the server's record of the conversation is passed on, with key fragments removed", async () => {
  const conversation = { model: "m", instructions: "Be a DM.", input: "## Situation", output: '{"a":1}', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, openai_status: 200 };
  const ok = (async () => new Response(JSON.stringify({ encounter: goodAnswer(), conversation }), { status: 200 })) as unknown as typeof fetch;
  const out = await requestEncounter(request(), "sk-x-123456", new AbortController().signal, ok);
  assert.equal(out.exchange!.input, "## Situation");
  assert.equal(out.exchange!.usage!.output_tokens, 5);
  const bad = (async () => new Response(JSON.stringify({ error: { code: "invalid_token", message: "OpenAI rejected the API token" }, conversation: { input: "x", openai_status: 401, openai_error: "Incorrect API key provided: sk-abcd****wxyz" } }), { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(requestEncounter(request(), "sk-x-123456", new AbortController().signal, bad),
    (e: any) => e.exchange.openai_status === 401 && !e.exchange.openai_error.includes("abcd"));
});

test("background transport: creates a job, starts the background function, polls, collects and cleans up", async () => {
  const { memoryStore } = await import("./memory-store.mjs");
  const jobHandler = (await import("../netlify/functions/encounter-job.mjs")).default;
  const backgroundHandler = (await import("../netlify/functions/generate-encounter-background.mjs")).default;
  const store = memoryStore();
  const calls: string[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const openai = async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(goodAnswer()) }] }] }), { status: 200 });
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    const req = new Request("http://x" + url, init);
    calls.push((init.method || "GET") + " " + url.split("?")[0]);
    assert.ok(!url.includes("sk-"), "the token is never in a URL");
    if (url.startsWith("/.netlify/functions/encounter-job")) return jobHandler(req, undefined, { store });
    if (url === "/.netlify/functions/generate-encounter-background") {
      pending = backgroundHandler(req, undefined, { store, fetch: openai });   // Netlify answers 202 and runs it
      return new Response(null, { status: 202 });
    }
    throw new Error("unexpected " + url);
  }) as unknown as typeof fetch;
  const out = await requestEncounter(request(), "sk-x-123456", new AbortController().signal, fakeFetch, "background", 5);
  await pending;
  assert.deepEqual(out.encounter, goodAnswer());
  assert.match(out.exchange!.input!, /## Party/);
  assert.equal(calls[0], "POST /.netlify/functions/encounter-job");
  assert.equal(calls[1], "POST /.netlify/functions/generate-encounter-background");
  assert.ok(calls.includes("GET /.netlify/functions/encounter-job"));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(calls.at(-1), "DELETE /.netlify/functions/encounter-job");
  assert.equal(store.data.size, 0, "the finished job is removed");
});

test("background transport: Cancel stops polling and cancels the job", async () => {
  const { memoryStore } = await import("./memory-store.mjs");
  const jobHandler = (await import("../netlify/functions/encounter-job.mjs")).default;
  const store = memoryStore();
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    if (url.startsWith("/.netlify/functions/encounter-job")) return jobHandler(new Request("http://x" + url, init), undefined, { store });
    return new Response(null, { status: 202 });                                 // background never finishes
  }) as unknown as typeof fetch;
  const controller = new AbortController();
  const pending = requestEncounter(request(), "sk-x-123456", controller.signal, fakeFetch, "background", 20);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (e: unknown) => e instanceof AiError && e.code === "canceled");
  await new Promise(r => setTimeout(r, 10));
  assert.equal(JSON.parse([...store.data.values()][0]).state, "canceled");
});

test("a no-roll option may leave failure empty; a rolled one may not", () => {
  const a = goodAnswer() as any;
  a.avoiding_combat = [{ action: "Back away", check: "", dc: 0, success: "They let you go.", failure: "" }];
  assert.ok(validateAiEncounter(a, byId).ok);
  a.avoiding_combat[0] = { action: "Persuade", check: "Charisma (Persuasion)", dc: 12, success: "They step aside.", failure: "" };
  const v = validateAiEncounter(a, byId);
  assert.ok(!v.ok && v.errors.join(" ").includes("Way to avoid combat 1: failure is empty."));
});
