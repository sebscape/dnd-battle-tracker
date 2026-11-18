import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { ENCOUNTER_SCHEMA, OPENAI_URL } from "../netlify/functions/generate-encounter.mjs";

const IDS = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"];
const body = (extra = {}) => ({
  token: "sk-test-1234567890", model: "gpt-6.1-terra", instructions: "Be a DM.", situation: "Camping by a road.",
  party: [{ name: "Ana", level: 3 }, { name: "Bo", level: 3 }], difficulty: "moderate",
  budget: { low: 300, moderate: 450, high: 800 }, environment: "Forest",
  catalog: [
    { id: IDS[0], name: "Wolf", cr: "1/4", xp: 50, type: "Beast", size: "Medium", environments: ["Forest"] },
    { id: IDS[1], name: "Dire Wolf", cr: "1", xp: 200, type: "Beast", size: "Large", environments: [] },
  ], ...extra,
});
const answer = (extra = {}) => ({
  encounter_name: "Eyes in the Dark", read_aloud: "Eyes gleam. So what do you do?", motivation: "Hunger.",
  avoiding_combat: [{ action: "Offer food", check: "Wisdom (Animal Handling)", dc: 12, success: "They leave.", failure: "They attack." }],
  dm_tactics: "Surround.", treasure: "", monsters: [{ monster_id: IDS[0], count: 4 }], ...extra,
});
const openai = (status, json) => async () => new Response(JSON.stringify(json), { status });
const ok = enc => openai(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: typeof enc === "string" ? enc : JSON.stringify(enc) }] }] });
const call = (b, fetch, extra = {}) => handler(new Request("http://x/.netlify/functions/generate-encounter", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) }), undefined, { fetch, ...extra });
const err = async r => (await r.json()).error;

test("success: strict schema request to OpenAI, token only in the Authorization header", async () => {
  let sent;
  const r = await call(body(), async (url, init) => { sent = { url, init, json: JSON.parse(init.body) }; return ok(answer())(); });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).encounter, answer());
  assert.equal(sent.url, OPENAI_URL);
  assert.equal(sent.init.headers.Authorization, "Bearer sk-test-1234567890");
  assert.ok(!sent.init.body.includes("sk-test"));
  assert.equal(sent.json.text.format.type, "json_schema");
  assert.equal(sent.json.text.format.strict, true);
  assert.equal(sent.json.store, false);
  assert.match(sent.json.input, /00000000-0000-4000-8000-000000000101 \| Wolf \| 1\/4 \| 50/);
  assert.match(sent.json.input, /between 300 and 450 XP/);
});

test("the schema follows strict-mode rules everywhere", () => {
  const walk = node => {
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === "array") walk(node.items);
  };
  walk(ENCOUNTER_SCHEMA);
});

test("OpenAI errors are mapped and never echo the key", async () => {
  const cases = [
    [401, { error: { message: "Incorrect API key provided: sk-test****7890." } }, 401, "invalid_token"],
    [429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } }, 402, "insufficient_quota"],
    [429, { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } }, 429, "rate_limited"],
    [404, { error: { code: "model_not_found", message: "The model does not exist" } }, 400, "unsupported_model"],
    [400, { error: { message: "Invalid schema for response_format 'encounter'", param: "text.format.schema" } }, 400, "unsupported_model"],
    [500, { error: { message: "server error" } }, 502, "server"],
  ];
  for (const [status, json, want, code] of cases) {
    const r = await call(body(), openai(status, json));
    const e = await err(r);
    assert.equal(r.status, want, code);
    assert.equal(e.code, code);
    assert.ok(!e.message.includes("sk-test"), code);
  }
});

test("refusals, incomplete, malformed and unknown-monster answers are rejected", async () => {
  let r = await call(body(), openai(200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }] }));
  assert.equal(r.status, 422); assert.equal((await err(r)).code, "refused");
  r = await call(body(), openai(200, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }));
  assert.equal(r.status, 502); assert.match((await err(r)).message, /cut off/);
  r = await call(body(), ok("{not json"));
  assert.equal((await err(r)).code, "invalid_response");
  r = await call(body(), ok(answer({ monsters: [{ monster_id: "11111111-1111-4111-8111-111111111111", count: 2 }] })));
  assert.match((await err(r)).message, /isn't in your catalog \("11111111/);
  r = await call(body(), ok(answer({ monsters: [{ monster_id: IDS[0], count: 0 }] })));
  assert.equal((await err(r)).code, "invalid_response");
  r = await call(body(), ok(answer({ read_aloud: "" })));
  assert.equal((await err(r)).code, "invalid_response");
});

test("bad requests are refused before calling OpenAI", async () => {
  const never = async () => { throw new Error("should not call OpenAI"); };
  for (const b of [body({ token: "" }), body({ token: "not-a-key" }), body({ model: "bad model" }), body({ situation: "" }),
    body({ party: [] }), body({ catalog: [] }), body({ catalog: [{ id: "x" }] }), body({ difficulty: "deadly" }), "not json"]) {
    const r = await call(b, never);
    assert.equal(r.status, 400);
  }
  const big = await call(body({ situation: "x".repeat(300 * 1024) }), never);
  assert.equal(big.status, 413);
  const get = await handler(new Request("http://x/", { method: "GET" }), undefined, { fetch: never });
  assert.equal(get.status, 405);
});

test("a slow OpenAI answer becomes a clear timeout", async () => {
  const slow = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const r = await call(body(), slow, { timeoutMs: 50 });
  assert.equal(r.status, 504);
  assert.equal((await err(r)).code, "timeout");
});

test("an option that needs no roll (DC 0, no check) is accepted", async () => {
  const r = await call(body(), ok(answer({ avoiding_combat: [{ action: "Chat with the merchant", check: "", dc: 0, success: "They trade news.", failure: "They move on." }] })));
  assert.equal(r.status, 200);
});

test("rejections name the item and field, and return the AI's answer for inspection", async () => {
  const bad = answer({ avoiding_combat: [answer().avoiding_combat[0], { action: "Talk", check: "Charisma (Persuasion)", dc: "none", success: "Ok.", failure: "No." }] });
  const r = await call(body(), ok(bad));
  const e = await err(r);
  assert.equal(e.code, "invalid_response");
  assert.equal(e.message, 'Way to avoid combat 2: DC must be a whole number from 0 to 40 (got "none").');
  assert.deepEqual(JSON.parse(e.answer), bad);
  const r2 = await call(body(), ok(answer({ monsters: [] })));
  assert.match((await err(r2)).message, /^Monsters: the answer chose no monsters/);
  const r3 = await call(body(), ok(answer({ read_aloud: "" })));
  assert.equal((await err(r3)).message, "Read-aloud: empty.");
});
