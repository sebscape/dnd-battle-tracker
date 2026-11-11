// Client for the read-only storage bridge hosted by Critter Codex.
// Protocol: see DESIGN.md, "Bridge messages (version 1)".

const PROTOCOL = "dnd-bridge";
export const BRIDGE_URL = import.meta.env.DEV
  ? "http://localhost:5173/bridge.html"
  : "https://critter-codex.c2ma.com/bridge.html";
const TIMEOUT_MS = 5000;

interface BridgeReply { protocol: string; id: string; ok: boolean; result?: unknown; error?: string }
export interface BridgeHello {
  bridgeVersion: number;
  schemaVersion: string;
  storage: { customMonsterCount: number; artworkCount: number; localStorageKeys: string[] };
}

export class BridgeClient {
  private counter = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private readonly origin: string;
  private readonly onMessage = (event: MessageEvent) => {
    if (event.origin !== this.origin || event.source !== this.frame.contentWindow) return;
    const msg = event.data as BridgeReply;
    if (!msg || msg.protocol !== PROTOCOL || !this.pending.has(msg.id)) return;
    const entry = this.pending.get(msg.id)!;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || "Bridge error"));
  };

  private readonly frame: HTMLIFrameElement;

  private constructor(frame: HTMLIFrameElement, url: string) {
    this.frame = frame;
    this.origin = new URL(url).origin;
    window.addEventListener("message", this.onMessage);
  }

  /** Loads the bridge in a hidden iframe. Rejects if it doesn't load or answer `hello` in time. */
  static async connect(url = BRIDGE_URL): Promise<{ client: BridgeClient; hello: BridgeHello }> {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = "Critter Codex bridge";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Bridge did not load.")), TIMEOUT_MS);
      frame.onload = () => { clearTimeout(timer); resolve(); };
    });
    document.body.appendChild(frame);
    const client = new BridgeClient(frame, url);
    try {
      await loaded;
      const hello = await client.request<BridgeHello>("hello");
      return { client, hello };
    } catch (e) {
      client.close();
      throw e;
    }
  }

  request<T>(type: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = "req-" + (++this.counter);
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Bridge did not answer."));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer });
      this.frame.contentWindow?.postMessage({ protocol: PROTOCOL, id, type, payload }, this.origin);
    });
  }

  close() {
    window.removeEventListener("message", this.onMessage);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error("Bridge closed.")); }
    this.pending.clear();
    this.frame.remove();
  }
}
