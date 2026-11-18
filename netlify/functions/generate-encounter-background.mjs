// Netlify Background Function: POST /.netlify/functions/generate-encounter-background
//
// Netlify recognizes the -background suffix, answers 202 at once and lets this run for
// up to 15 minutes, so slow models aren't cut off by the ~30-second limit for ordinary
// functions (same design as Critter Codex's generate-artwork-background.mjs).
//
// Body: the same request generate-encounter.mjs takes, plus the job's { id, secret }
// (created first through encounter-job.mjs). The result — exactly what
// generate-encounter.mjs answers, status and body — is saved in the job for the browser
// to collect. The API token is used for this one call only: never stored or logged.
import generateEncounter from "./generate-encounter.mjs";
import { jobKey, jobStore, validJobId } from "./encounter-job.mjs";

/** OpenAI gets up to 5 minutes here (the job itself may run 15). */
export const BACKGROUND_OPENAI_TIMEOUT_MS = 5 * 60 * 1000;

/** `deps` exists for tests (store, fetch, timeoutMs); Netlify passes only (request, context). */
export default async function handler(request, _context, deps = {}) {
  if (request.method !== "POST") return;
  let id, secret, store, key, created;
  try {
    const raw = await request.text();
    const payload = JSON.parse(raw);
    ({ id, secret } = payload);
    if (!validJobId(id) || !validJobId(secret)) return;
    store = deps.store || jobStore();
    key = jobKey(id);
    const current = await store.get(key, { type: "json" });
    if (!current || current.secret !== secret || current.state !== "pending") return;
    created = current.created;
    const { id: _id, secret: _secret, ...generation } = payload;
    const response = await generateEncounter(
      new Request("https://localhost/.netlify/functions/generate-encounter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(generation) }),
      undefined,
      { fetch: deps.fetch, timeoutMs: deps.timeoutMs || BACKGROUND_OPENAI_TIMEOUT_MS },
    );
    const body = await response.json();
    const latest = await store.get(key, { type: "json" });
    if (!latest || latest.secret !== secret || latest.state === "canceled") return;
    await store.setJSON(key, { secret, state: "done", created, status: response.status, body });
  } catch (error) {
    // Never log the request: it holds the token.
    console.error("generate-encounter-background failed: " + (error instanceof Error ? error.name : "unknown error"));
    try {
      if (store && key) {
        const latest = await store.get(key, { type: "json" });
        if (latest && latest.secret === secret && latest.state === "pending")
          await store.setJSON(key, { secret, state: "done", created, status: 500, body: { error: { code: "server", message: "Background generation failed. Try again." } } });
      }
    } catch { /* nothing more to do */ }
  }
}
