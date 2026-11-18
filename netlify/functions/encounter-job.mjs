// Netlify Function: /.netlify/functions/encounter-job?id=<job id>
// Header X-Encounter-Job-Secret: <job secret> (both random UUIDs made by the browser).
//
// Status record for one background encounter generation (same design as Critter
// Codex's artwork-job.mjs). POST creates a pending job, GET reads it, DELETE cancels
// it or, after the browser has the result, removes it. The stored result is what
// generate-encounter.mjs answered (the encounter, or an error, plus the conversation
// record); it never contains the API token.
import { getStore } from "@netlify/blobs";

export const STORE_NAME = "encounter-generation-jobs";
export const JOB_LIMIT_MS = 15 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validJobId = v => typeof v === "string" && UUID.test(v);
export const jobKey = id => "job-" + id;
export const jobStore = () => getStore({ name: STORE_NAME, consistency: "strong" });

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const fail = (status, message) => json({ error: { code: "server", message } }, status);

/** `deps.store` exists for tests; Netlify passes only (request, context). */
export default async function handler(request, _context, deps = {}) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    const secret = request.headers.get("X-Encounter-Job-Secret");
    if (!validJobId(id) || !validJobId(secret)) return fail(400, "Invalid job credentials.");
    const store = deps.store || jobStore();
    const key = jobKey(id);
    const job = await store.get(key, { type: "json" });
    if (request.method === "POST") {
      if (job) return fail(409, "Job already exists.");
      await store.setJSON(key, { secret, state: "pending", created: Date.now() });
      return json({ state: "pending" }, 201);
    }
    if (!job || job.secret !== secret) return fail(404, "Job not found.");
    if (request.method === "DELETE") {
      // Canceled while pending (the background run sees this and stops); otherwise the
      // browser already has the result, so the record is removed.
      if (job.state === "pending") await store.setJSON(key, { secret, state: "canceled", created: job.created });
      else await store.delete(key);
      return json({ state: "canceled" });
    }
    if (request.method !== "GET") return fail(405, "Method not allowed.");
    if (job.state === "pending" && Date.now() - job.created > JOB_LIMIT_MS)
      return json({ state: "error", status: 504, body: { error: { code: "timeout", message: "Generation exceeded Netlify's 15-minute limit for background work." } } });
    if (job.state === "done") return json({ state: "done", status: job.status, body: job.body });
    return json({ state: job.state });
  } catch {
    return fail(500, "Job status unavailable.");
  }
}

export const config = { path: "/.netlify/functions/encounter-job" };
