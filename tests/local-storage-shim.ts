// A minimal in-memory localStorage for modules that use it, imported first by tests.
const data = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => data.has(k) ? data.get(k)! : null,
  setItem: (k: string, v: string) => { data.set(k, String(v)); },
  removeItem: (k: string) => { data.delete(k); },
  clear: () => data.clear(),
  key: (i: number) => [...data.keys()][i] ?? null,
  get length() { return data.size; },
};
