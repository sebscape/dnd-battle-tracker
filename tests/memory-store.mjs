// An in-memory stand-in for a Netlify Blobs store (get / setJSON / delete), for tests.
export function memoryStore() {
  const data = new Map();
  return {
    data,
    async get(key, opts) { const v = data.get(key); return v === undefined ? null : opts && opts.type === "json" ? JSON.parse(v) : v; },
    async setJSON(key, value) { data.set(key, JSON.stringify(value)); },
    async delete(key) { data.delete(key); },
  };
}
