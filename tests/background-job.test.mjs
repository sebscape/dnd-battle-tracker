import { test } from "node:test";
import assert from "node:assert/strict";
import jobHandler from "../netlify/functions/encounter-job.mjs";
import backgroundHandler from "../netlify/functions/generate-encounter-background.mjs";
import { memoryStore } from "./memory-store.mjs";

const ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SECRET = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const MONSTER = "00000000-0000-4000-8000-000000000101";
const job = (store, method, secret = SECRET, id = ID) =>
  jobHandler(new Request("http://x/.netlify/functions/encounter-job?id=" + id, { method, headers: { "X-Encounter-Job-Secret": secret } }), undefined, { store });
const generation = {
  token: "sk-test-1234567890", model: "gpt-6.1-terra", instructions: "Be a DM.", situation: "Camping.",
  party: [{ name: "Ana", level: 3 }], difficulty: "moderate", budget: { low: 150, moderate: 225, high: 400 }, environment: "",
  catalog: [{ id: MONSTER, name: "Wolf", cr: "1/4", xp: 50, type: "Beast", size: "Medium", environments: [] }],
};
const answer = { encounter_name: "Eyes", read_aloud: "Eyes gleam. So what do you do", motivation: "Hunger.", avoiding_combat: [],
  dm_tactics: "Surround.", treasure: "", monsters: [{ monster_id: MONSTER, count: 3 }] };
const openaiOk = async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] }), { status: 200 });
const runBackground = (store, fetch, extra = {}) => backgroundHandler(new Request("http://x/", { method: "POST", body: JSON.stringify({ ...generation, id: ID, secret: SECRET, ...extra }) }), undefined, { store, fetch });

test("job lifecycle: create, wait, done, collect, remove — the token is never stored", async () => {
  const store = memoryStore();
  assert.equal((await job(store, "POST")).status, 201);
  assert.equal((await job(store, "POST")).status, 409);
  assert.equal((await (await job(store, "GET")).json()).state, "pending");
  await runBackground(store, openaiOk);
  assert.ok(![...store.data.values()].some(v => v.includes("sk-test")), "token must not be stored");
  const done = await (await job(store, "GET")).json();
  assert.equal(done.state, "done");
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.encounter, answer);
  assert.match(done.body.conversation.input, /## Monster catalog/);
  assert.equal((await job(store, "DELETE")).status, 200);
  assert.equal(store.data.size, 0, "a collected result is removed");
});

test("the wrong secret can't read or cancel a job", async () => {
  const store = memoryStore();
  await job(store, "POST");
  const other = "cccccccc-3333-4333-8333-cccccccccccc";
  assert.equal((await job(store, "GET", other)).status, 404);
  assert.equal((await job(store, "DELETE", other)).status, 404);
  assert.equal((await job(store, "GET", "not-a-uuid")).status, 400);
});

test("a background run won't start without a matching pending job, and stops if canceled", async () => {
  const store = memoryStore();
  let called = 0;
  const counting = async () => { called++; return openaiOk(); };
  await runBackground(store, counting);
  assert.equal(called, 0, "no job → no OpenAI call");
  await job(store, "POST");
  await job(store, "DELETE");                       // canceled while pending
  await runBackground(store, counting);
  assert.equal(called, 0, "canceled job → no OpenAI call");
  assert.equal(JSON.parse(store.data.get("job-" + ID)).state, "canceled");
});

test("a cancel that arrives during the OpenAI call discards the result", async () => {
  const store = memoryStore();
  await job(store, "POST");
  const slow = async () => { await job(store, "DELETE"); return openaiOk(); };
  await runBackground(store, slow);
  assert.equal(JSON.parse(store.data.get("job-" + ID)).state, "canceled");
});

test("errors are saved in the job just as the direct call returns them", async () => {
  const store = memoryStore();
  await job(store, "POST");
  await runBackground(store, async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-test****7890" } }), { status: 401 }));
  const r = await (await job(store, "GET")).json();
  assert.equal(r.state, "done");
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "invalid_token");
  assert.ok(!JSON.stringify(r).includes("sk-test"));
});
