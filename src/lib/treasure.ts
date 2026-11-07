// Treasure found after a battle: gear listed in SRD stat blocks, the treasure
// the DM planned for the encounter, and optional coins from a table the DM
// enters in Settings (e.g. from their own Dungeon Master's Guide). The app
// ships no treasure table of its own: the SRD 5.2.1 doesn't include one.
import { useEffect, useRef, useState } from "react";
import type { Battle, LootItem } from "../models/combat";
import type { Monster } from "../models/monster";
import { parseDice, rollDice } from "./dice";
import { crValue } from "./format";

export const COINS = ["CP", "SP", "EP", "GP", "PP"] as const;
export type Coin = typeof COINS[number];

export interface CoinRow {
  id: string;
  /** Challenge ratings, e.g. "0" to "4". */
  min_cr: string;
  max_cr: string;
  /** e.g. "3d6" */
  dice: string;
  multiplier: number;
  coin: Coin;
}

export interface TreasureSettings {
  rows: CoinRow[];
  /** Beasts, Plants and Oozes usually carry nothing. */
  skip_mindless: boolean;
}

const KEY = "dnd-battle-tracker-treasure-v1";
const DEFAULTS: TreasureSettings = { rows: [], skip_mindless: true };
const NO_TREASURE_TYPES = /^(Beast|Plant|Ooze)\b/i;

function isRow(v: unknown): v is CoinRow {
  const r = v as Partial<CoinRow>;
  return !!r && typeof r.id === "string" && typeof r.min_cr === "string" && typeof r.max_cr === "string" && typeof r.dice === "string"
    && typeof r.multiplier === "number" && (COINS as readonly string[]).includes(r.coin as string);
}

function load(): TreasureSettings {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<TreasureSettings> | null;
    if (d && typeof d === "object") return { rows: Array.isArray(d.rows) ? d.rows.filter(isRow) : [], skip_mindless: d.skip_mindless !== false };
  } catch { /* defaults */ }
  return DEFAULTS;
}

/** The DM's coin table, kept in this browser. */
export function useTreasureSettings() {
  const [settings, setSettings] = useState<TreasureSettings>(load);
  const [error, setError] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try { localStorage.setItem(KEY, JSON.stringify(settings)); setError(""); }
    catch { setError("Saving the treasure settings failed."); }
  }, [settings]);
  return [settings, setSettings, error] as const;
}

/** A row is usable when its CR range and dice can be read. */
export function rowProblem(r: CoinRow): string {
  if (Number.isNaN(crValue(r.min_cr)) || Number.isNaN(crValue(r.max_cr))) return "CR range must be numbers like 0, 1/4 or 5.";
  if (crValue(r.min_cr) > crValue(r.max_cr)) return "The lowest CR is higher than the highest.";
  if (!parseDice(r.dice)) return "Dice must look like 3d6 or 2d8 + 5.";
  if (!(r.multiplier > 0)) return "The multiplier must be at least 1.";
  return "";
}

/** Rolls coins for one monster from the first matching row, e.g. "12 GP (3d6)". */
export function rollCoins(settings: TreasureSettings, m: Monster): string | null {
  if (settings.skip_mindless && NO_TREASURE_TYPES.test(m.type)) return null;
  const cr = crValue(m.challenge_rating);
  const row = settings.rows.find(r => !rowProblem(r) && cr >= crValue(r.min_cr) && cr <= crValue(r.max_cr));
  if (!row) return null;
  const r = rollDice(parseDice(row.dice)!);
  const amount = Math.max(0, r.total) * row.multiplier;
  return amount.toLocaleString("en-US") + " " + row.coin + " (" + row.dice + (row.multiplier !== 1 ? " × " + row.multiplier : "") + ")";
}

/** Everything the party could find: per defeated monster (gear, coins) and the planned treasure. */
export function findLoot(b: Battle, byId: Map<string, Monster>, settings: TreasureSettings): LootItem[] {
  const items: LootItem[] = [];
  for (const c of b.combatants) {
    if (c.kind !== "monster" || !c.out || !c.monster_id) continue;
    const m = byId.get(c.monster_id);
    if (!m) continue;
    for (const gear of (m.gear ?? "").split(/,\s*/).map(s => s.trim()).filter(Boolean)) {
      items.push({ id: crypto.randomUUID(), source: c.name, text: gear, taken: true });
    }
    const coins = rollCoins(settings, m);
    if (coins) items.push({ id: crypto.randomUUID(), source: c.name, text: coins, taken: true });
  }
  if (b.treasure_note) items.push({ id: crypto.randomUUID(), source: "Planned treasure", text: b.treasure_note, taken: true });
  return items;
}
