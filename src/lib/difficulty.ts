// Encounter difficulty from the SRD 5.2.1 "Combat Encounters" rules:
// each character contributes an XP budget by level, and monsters cost XP by CR.

/** XP by challenge rating (normal XP; some monsters are worth more in their lair). */
export const XP_BY_CR: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900,
  "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000,
  "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};
// Sorted explicitly: object key order puts integer keys ("0", "1"…) before "1/8".
const CR_ORDER = Object.keys(XP_BY_CR).sort((a, b) => XP_BY_CR[a] - XP_BY_CR[b]);

/** XP Budget per Character: [Low, Moderate, High], index = level - 1. */
const BUDGET_PER_CHARACTER: ReadonlyArray<readonly [number, number, number]> = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];

export type Rating = "none" | "low" | "moderate" | "high" | "beyond";

export interface DifficultyMonster { name: string; cr: string; count: number }

export interface Difficulty {
  totalXp: number;
  budget: { low: number; moderate: number; high: number };
  rating: Rating;
  /** Highest CR one more monster could have and keep the encounter within High; null if none fits. */
  maxAdditionalCr: string | null;
  averageLevel: number;
  warnings: string[];
}

/** Normalizes CR text ("0.25", " 1/4 ") to a table key, or null if unknown. */
export function crKey(cr: string): string | null {
  const t = cr.trim();
  if (t in XP_BY_CR) return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const fractions: Record<string, string> = { "0.125": "1/8", "0.25": "1/4", "0.5": "1/2" };
  const key = fractions[String(n)] ?? String(n);
  return key in XP_BY_CR ? key : null;
}

export function monsterXp(cr: string): number | null {
  const key = crKey(cr);
  return key === null ? null : XP_BY_CR[key];
}

const crNumber = (key: string) => key.includes("/") ? 1 / Number(key.split("/")[1]) : Number(key);

/** Returns null when there are no characters to build a budget from. */
export function encounterDifficulty(levels: number[], monsters: DifficultyMonster[]): Difficulty | null {
  const valid = levels.filter(l => Number.isInteger(l) && l >= 1 && l <= 20);
  if (valid.length === 0) return null;
  const budget = { low: 0, moderate: 0, high: 0 };
  for (const level of valid) {
    const [low, moderate, high] = BUDGET_PER_CHARACTER[level - 1];
    budget.low += low; budget.moderate += moderate; budget.high += high;
  }

  let totalXp = 0;
  const unknown: string[] = [];
  for (const m of monsters) {
    const xp = monsterXp(m.cr);
    if (xp === null) unknown.push(m.name);
    else totalXp += xp * m.count;
  }

  const rating: Rating = totalXp === 0 ? "none" : totalXp <= budget.low ? "low"
    : totalXp <= budget.moderate ? "moderate" : totalXp <= budget.high ? "high" : "beyond";

  const remaining = budget.high - totalXp;
  let maxAdditionalCr: string | null = null;
  for (const key of CR_ORDER) if (XP_BY_CR[key] <= remaining) maxAdditionalCr = key;

  const averageLevel = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  const warnings: string[] = [];
  const tooStrong = monsters.filter(m => { const k = crKey(m.cr); return k !== null && crNumber(k) > averageLevel; });
  if (tooStrong.length) warnings.push(
    tooStrong.map(m => m.name + " (CR " + m.cr + ")").join(", ") + (tooStrong.length === 1 ? " has" : " have")
    + " a CR above the party's average level (" + averageLevel + ") and may be able to take out a character in a single action.");
  const creatures = monsters.reduce((n, m) => n + m.count, 0);
  if (creatures > valid.length * 2) warnings.push(creatures + " monsters is more than two per character, which can be hard to run and overwhelming for the party.");
  if (monsters.length > 3) warnings.push(monsters.length + " different stat blocks can be hard to keep track of during combat.");
  if (unknown.length) warnings.push("Not counted (unreadable CR): " + unknown.join(", ") + ".");

  return { totalXp, budget, rating, maxAdditionalCr, averageLevel, warnings };
}
