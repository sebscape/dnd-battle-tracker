// Random encounters that fit the party: monsters from the chosen environment,
// within the SRD 5.2.1 XP budget for the chosen difficulty, no monster above the
// max CR, and at most two creatures per character (SRD guidance).
import type { Monster } from "../models/monster";
import { encounterDifficulty, monsterXp } from "./difficulty";
import { crValue } from "./format";
import { rollDie } from "./dice";

export const ENVIRONMENTS = ["Arctic", "Coastal", "Desert", "Forest", "Grassland", "Hill", "Mountain", "Swamp", "Underdark", "Underwater", "Urban", "Planar"] as const;
export type Environment = typeof ENVIRONMENTS[number];
export type Difficulty = "low" | "moderate" | "high";
export type Kinds = "any" | "one" | "two";

export interface GenerateOptions {
  pool: Monster[];
  levels: number[];
  environment: Environment | "";
  difficulty: Difficulty;
  maxCr: number;
  kinds: Kinds;
}
export interface Picked { monster: Monster; count: number }
export type GenerateResult = { picks: Picked[]; totalXp: number; target: number } | { error: string };

export const environmentsOf = (m: Monster): string[] => m.tags.filter(t => (ENVIRONMENTS as readonly string[]).includes(t));

/** Suggested max CR for one monster: the party's average level (the SRD warns that higher CRs can drop a character in one action). */
export function suggestedMaxCr(levels: number[]): number {
  return levels.length ? Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)) : 1;
}

const random = (n: number) => rollDie(n) - 1;
const pickOne = <T,>(xs: T[]): T => xs[random(xs.length)];

/** Monsters that could appear: right environment, CR within the cap, and known XP. */
export function candidatePool(o: Pick<GenerateOptions, "pool" | "environment" | "maxCr">): Monster[] {
  return o.pool.filter(m => {
    const xp = monsterXp(m.challenge_rating);
    return xp !== null && crValue(m.challenge_rating) <= o.maxCr && (!o.environment || environmentsOf(m).includes(o.environment));
  });
}

export function generateEncounter(o: GenerateOptions): GenerateResult {
  const diff = encounterDifficulty(o.levels, []);
  if (!diff) return { error: "Select at least one party member — the encounter is sized to them." };
  const target = diff.budget[o.difficulty];
  // Aim between the next-lower difficulty's budget and this one's.
  const floor = o.difficulty === "high" ? diff.budget.moderate : o.difficulty === "moderate" ? diff.budget.low : Math.floor(diff.budget.low / 2);
  const maxCreatures = Math.max(1, o.levels.length * 2);
  const pool = candidatePool(o).filter(m => monsterXp(m.challenge_rating)! <= target);
  if (!pool.length) return { error: "No monsters " + (o.environment ? "in " + o.environment + " " : "") + "fit: try a higher max CR, another difficulty or another environment." };
  const xp = (m: Monster) => monsterXp(m.challenge_rating)!;

  let best: { picks: Picked[]; totalXp: number } | null = null;
  const score = (t: number) => t > target ? Infinity : target - t;
  for (let attempt = 0; attempt < 300; attempt++) {
    const kinds = o.kinds === "one" ? 1 : o.kinds === "two" ? 2 : random(3) === 0 ? 1 : 2;
    // The main monster: worth at least a quarter of the budget when one exists.
    const strong = pool.filter(m => xp(m) >= target / 4);
    const lead = pickOne(strong.length ? strong : pool);
    const picks: Picked[] = [];
    if (kinds === 1) {
      const most = Math.min(maxCreatures, Math.floor(target / xp(lead)));
      const least = Math.min(most, Math.max(1, Math.ceil(floor / xp(lead))));
      picks.push({ monster: lead, count: least + random(most - least + 1) });
    } else {
      // A leader with followers: often the same creature type (a goblin boss and goblins), weaker than the leader.
      const leadCount = 1;
      const left = target - xp(lead) * leadCount;
      const followers = pool.filter(m => m.id !== lead.id && xp(m) <= left && xp(m) < xp(lead));
      const sameType = followers.filter(m => m.type === lead.type);
      const pool2 = sameType.length && random(10) < 6 ? sameType : followers;
      if (!pool2.length) continue;
      const f = pickOne(pool2);
      const most = Math.min(maxCreatures - leadCount, Math.floor(left / xp(f)));
      if (most < 1) continue;
      const least = Math.min(most, Math.max(1, Math.ceil((floor - xp(lead)) / xp(f))));
      picks.push({ monster: lead, count: leadCount }, { monster: f, count: least + random(most - least + 1) });
    }
    const totalXp = picks.reduce((n, p) => n + xp(p.monster) * p.count, 0);
    if (!best || score(totalXp) < score(best.totalXp)) best = { picks, totalXp };
    if (totalXp >= floor && totalXp <= target) return { picks, totalXp, target };
  }
  return best && best.totalXp <= target ? { ...best, target } : { error: "Couldn't build an encounter in budget from these monsters — try another setting." };
}
