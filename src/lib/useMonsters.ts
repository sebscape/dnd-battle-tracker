import { useEffect, useMemo, useState } from "react";
import type { Monster, MonsterCatalog } from "../models/monster";
import { isMonster } from "../models/monster";
import { BridgeClient } from "./bridge";

export type BridgeStatus = "connecting" | "connected" | "unavailable";

export interface MonsterData {
  published: Monster[];
  custom: Monster[];
  byId: Map<string, Monster>;
  artwork: Record<string, string>;
  loading: boolean;
  error: string;
  bridge: BridgeStatus;
}

/** Published monsters from this site's bundled catalog, plus custom monsters and artwork from the bridge if reachable. */
export function useMonsters(): MonsterData {
  const [published, setPublished] = useState<Monster[]>([]);
  const [custom, setCustom] = useState<Monster[]>([]);
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bridge, setBridge] = useState<BridgeStatus>("connecting");

  useEffect(() => {
    let active = true;
    fetch("/data/published-monsters.json")
      .then(r => { if (!r.ok) throw new Error("The monster catalog could not be loaded."); return r.json(); })
      .then((data: MonsterCatalog) => { if (active) setPublished(Array.isArray(data.monsters) ? data.monsters.filter(isMonster) : []); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let client: BridgeClient | null = null;
    (async () => {
      try {
        const connection = await BridgeClient.connect();
        client = connection.client;
        if (!active) { client.close(); return; }
        const { monsters } = await client.request<{ monsters: unknown[] }>("listCustomMonsters");
        const valid = Array.isArray(monsters) ? monsters.filter(isMonster).filter(m => m.source.type === "homebrew") : [];
        const { artwork: art } = await client.request<{ artwork: Record<string, string> }>("getArtwork", { monsterIds: null });
        if (!active) return;
        setCustom(valid);
        setArtwork(Object.fromEntries(Object.entries(art ?? {}).filter(([, url]) => typeof url === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(url))));
        setBridge("connected");
      } catch {
        if (active) setBridge("unavailable");
      } finally {
        client?.close();
      }
    })();
    return () => { active = false; };
  }, []);

  const byId = useMemo(() => new Map([...published, ...custom].map(m => [m.id, m])), [published, custom]);
  return { published, custom, byId, artwork, loading, error, bridge };
}
