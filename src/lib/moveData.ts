// One-time move of saved data from this app's old web address to its new one.
// Browser storage belongs to one address, so after the rename the new address starts
// empty. The new site loads public/move-data.html from the OLD address in a hidden
// iframe (same technique as the storage bridge) and copies everything across.
// Remove this, MoveData.tsx and public/move-data.html once the old address redirects.

export const NEW_ORIGIN = "https://scrap-sheet.c2ma.com";
export const OLD_ORIGIN = import.meta.env.DEV ? "http://localhost:5184" : "https://dnd-battle-tracker.c2ma.com";
export const OLD_HOST = new URL(OLD_ORIGIN).host;
export const NEW_HOST = new URL(NEW_ORIGIN).host;
// Must match public/move-data.html.
const PREFIX = "dnd-battle-tracker";
interface StoreDef { db: string; version: number; store: string; keyPath: string; label: [string, string] }
const STORES: StoreDef[] = [];
/** How to describe each saved item: "list" counts array entries, "rows" is shown when its `rows` list has entries, "present" when set at all. */
const LABELS: Record<string, { kind: "list" | "rows" | "present"; label: [string, string] }> = {
  "dnd-battle-tracker-party-v1": {"kind": "list", "label": ["party member", "party members"]},
  "dnd-battle-tracker-encounters-v1": {"kind": "list", "label": ["encounter", "encounters"]},
  "dnd-battle-tracker-history-v1": {"kind": "list", "label": ["finished battle", "finished battles"]},
  "dnd-battle-tracker-treasure-v1": {"kind": "rows", "label": ["treasure settings", "treasure settings"]},
};

const PROTOCOL = "dnd-move";
interface Reply { protocol: string; id: string; ok: boolean; result?: unknown; error?: string }

export class OldSite {
  private counter = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private constructor(private readonly frame: HTMLIFrameElement) { window.addEventListener("message", this.onMessage); }
  private readonly onMessage = (event: MessageEvent) => {
    if (event.origin !== OLD_ORIGIN || event.source !== this.frame.contentWindow) return;
    const msg = event.data as Reply;
    const entry = msg && msg.protocol === PROTOCOL ? this.pending.get(msg.id) : undefined;
    if (!entry) return;
    this.pending.delete(msg.id); clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result); else entry.reject(new Error(msg.error || "The old site reported an error."));
  };
  static async connect(): Promise<OldSite> {
    const frame = document.createElement("iframe");
    frame.src = OLD_ORIGIN + "/move-data.html";
    frame.title = "Old site data";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The old site did not load.")), 8000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
    });
    document.body.appendChild(frame);
    const site = new OldSite(frame);
    try { await loaded; await site.request("hello", undefined, 5000); return site; }
    catch (e) { site.close(); throw new Error("Could not reach " + OLD_HOST + ". " + (e instanceof Error ? e.message : "")); }
  }
  request<T>(type: string, payload?: unknown, timeoutMs = 60000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = "move-" + (++this.counter);
      const timer = window.setTimeout(() => { this.pending.delete(id); reject(new Error("The old site did not answer.")); }, timeoutMs);
      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer });
      this.frame.contentWindow?.postMessage({ protocol: PROTOCOL, id, type, payload }, OLD_ORIGIN);
    });
  }
  close() {
    window.removeEventListener("message", this.onMessage);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error("Closed.")); }
    this.pending.clear(); this.frame.remove();
  }
}

export interface Found { items: Record<string, string>; keys: IDBValidKey[][]; lines: string[] }

const plural = (n: number, [one, many]: [string, string]) => n + " " + (n === 1 ? one : many);
function describe(items: Record<string, string | null>, storeCounts: number[]): string[] {
  const lines: string[] = [];
  for (const [key, def] of Object.entries(LABELS)) {
    const raw = items[key];
    if (raw == null) continue;
    if (def.kind === "present") { lines.push(def.label[0]); continue; }
    try {
      const data: unknown = JSON.parse(raw);
      if (def.kind === "rows") { if (Array.isArray((data as { rows?: unknown })?.rows) && (data as { rows: unknown[] }).rows.length) lines.push(def.label[0]); }
      else if (Array.isArray(data) && data.length) lines.push(plural(data.length, def.label));
    } catch { /* unreadable: not listed */ }
  }
  STORES.forEach((s, i) => { if (storeCounts[i]) lines.push(plural(storeCounts[i], s.label)); });
  return lines;
}

/** Everything saved at the old address (values for small items, keys only for images). */
export async function readOldSite(site: OldSite): Promise<Found> {
  const { items } = await site.request<{ items: Record<string, string> }>("getLocalStorage");
  const keys: IDBValidKey[][] = [];
  for (const s of STORES) keys.push((await site.request<{ keys: IDBValidKey[] }>("listKeys", { db: s.db, store: s.store })).keys);
  return { items, keys, lines: describe(items, keys.map(k => k.length)) };
}

function openLocal(s: StoreDef, create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const req = create ? indexedDB.open(s.db, s.version) : indexedDB.open(s.db);
    req.onupgradeneeded = () => {
      if (!create) { req.transaction?.abort(); return; }
      if (!req.result.objectStoreNames.contains(s.store)) req.result.createObjectStore(s.store, { keyPath: s.keyPath });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { if (!create && req.error?.name === "AbortError") resolve(null); else reject(req.error); };
  });
}

/** What this address already holds, in the same wording. */
export async function describeThisSite(): Promise<string[]> {
  const items: Record<string, string | null> = {};
  for (const key of Object.keys(LABELS)) items[key] = localStorage.getItem(key);
  const counts: number[] = [];
  for (const s of STORES) {
    const db = await openLocal(s, false).catch(() => null);
    if (!db || !db.objectStoreNames.contains(s.store)) { db?.close(); counts.push(0); continue; }
    counts.push(await new Promise<number>(resolve => { const r = db.transaction(s.store, "readonly").objectStore(s.store).count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0); }));
    db.close();
  }
  return describe(items, counts);
}

/** True when nothing has been saved at this address yet. */
export const thisSiteIsEmpty = (): boolean => {
  try { return describe(Object.fromEntries(Object.keys(LABELS).map(k => [k, localStorage.getItem(k)])), []).length === 0; } catch { return false; }
};

/** Copies everything found to this address. Saved items with the same name are replaced; images are added or replaced one by one. */
export async function copyToThisSite(site: OldSite, found: Found, onProgress: (done: number, total: number) => void): Promise<void> {
  const total = found.keys.reduce((n, k) => n + k.length, 0) + 1;
  let done = 0;
  for (let i = 0; i < STORES.length; i++) {
    if (!found.keys[i].length) continue;
    const s = STORES[i];
    const db = (await openLocal(s, true))!;
    try {
      for (const key of found.keys[i]) {
        const { record } = await site.request<{ record: unknown }>("getRecord", { db: s.db, store: s.store, key });
        if (record != null) await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(s.store, "readwrite"); tx.objectStore(s.store).put(record);
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
        onProgress(++done, total);
      }
    } finally { db.close(); }
  }
  // Small items last, so a failure while copying images leaves this site's lists untouched.
  for (const [key, value] of Object.entries(found.items)) if (key.startsWith(PREFIX)) localStorage.setItem(key, value);
  onProgress(total, total);
}
