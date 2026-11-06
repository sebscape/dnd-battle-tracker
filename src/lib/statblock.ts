// Reads SRD 5.2.1 stat block text into rollable pieces. Anything that doesn't
// match the standard wording is left as plain text for the DM.
import type { Monster, NamedFeature } from "../models/monster";
import type { DiceExpr } from "./dice";
import { parseDice } from "./dice";

export const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;
export type Ability = typeof ABILITIES[number];
const ABILITY_KEY: Record<Ability, "str" | "dex" | "con" | "int" | "wis" | "cha"> =
  { Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha" };
const ABBREV: Record<string, Ability> = { Str: "Strength", Dex: "Dexterity", Con: "Constitution", Int: "Intelligence", Wis: "Wisdom", Cha: "Charisma" };

export const DAMAGE_TYPES = ["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"] as const;
export type DamageType = typeof DAMAGE_TYPES[number];

export interface DamagePart { average: number; dice: DiceExpr | null; type: DamageType }
export interface ParsedAttack { kind: string; bonus: number; damage: DamagePart[] }
export interface ParsedSave { ability: Ability; dc: number; failureDamage: DamagePart[]; halfOnSuccess: boolean }
export interface ParsedFeature { feature: NamedFeature; attack?: ParsedAttack; save?: ParsedSave }

const ATTACK = /^(Melee or Ranged|Melee|Ranged) Attack Roll: ([+\-–−])(\d+)/;
const DICE_DAMAGE = /(\d+) \((\d+d\d+(?:\s*[+\-–−]\s*\d+)?)\) ([A-Z][a-z]+) damage/g;
const SAVING_THROWS = /\b(Str|Dex|Con|Int|Wis|Cha) ([+\-–−])(\d+)/g;
const FLAT_DAMAGE = /\b(\d+) ([A-Z][a-z]+) damage/g;
const SAVE = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw: DC (\d+)/;

const isDamageType = (t: string): t is DamageType => (DAMAGE_TYPES as readonly string[]).includes(t);

/** Damage parts in a piece of text, e.g. "6 (1d6 + 3) Slashing damage plus 3 (1d6) Poison damage". */
export function parseDamage(text: string): DamagePart[] {
  const parts: DamagePart[] = [];
  for (const m of text.matchAll(DICE_DAMAGE)) {
    if (isDamageType(m[3])) parts.push({ average: Number(m[1]), dice: parseDice(m[2]), type: m[3] });
  }
  if (parts.length) return parts;
  for (const m of text.matchAll(FLAT_DAMAGE)) {
    if (isDamageType(m[2])) parts.push({ average: Number(m[1]), dice: null, type: m[2] });
  }
  return parts;
}

export function parseFeature(feature: NamedFeature): ParsedFeature {
  const text = feature.description;
  const result: ParsedFeature = { feature };
  const saveMatch = SAVE.exec(text);
  const attack = ATTACK.exec(text);
  if (attack) {
    const hit = text.indexOf("Hit:");
    // Damage belongs to the hit until any follow-up saving throw.
    const hitText = hit >= 0 ? text.slice(hit, saveMatch && saveMatch.index > hit ? saveMatch.index : undefined) : "";
    result.attack = { kind: attack[1], bonus: (attack[2] === "+" ? 1 : -1) * Number(attack[3]), damage: parseDamage(hitText) };
  }
  if (saveMatch) {
    const after = text.slice(saveMatch.index);
    const fail = after.indexOf("Failure:");
    const success = after.indexOf("Success:", fail + 1);
    const failText = fail >= 0 ? after.slice(fail, success > fail ? success : undefined) : "";
    result.save = {
      ability: saveMatch[1] as Ability,
      dc: Number(saveMatch[2]),
      failureDamage: parseDamage(failText),
      halfOnSuccess: /Success: Half damage/.test(after),
    };
  }
  return result;
}

/** A monster's saving throw bonus: the listed bonus if proficient, otherwise its ability modifier. */
export function saveBonus(monster: Monster, ability: Ability): number {
  const listed = parseSavingThrows(monster.saving_throws);
  if (listed[ability] !== undefined) return listed[ability]!;
  const score = monster.abilities?.[ABILITY_KEY[ability]];
  return score === undefined ? 0 : Math.floor((score - 10) / 2);
}

export function parseSavingThrows(text: string | undefined): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  if (!text) return out;
  for (const m of text.matchAll(SAVING_THROWS)) {
    out[ABBREV[m[1]]] = (m[2] === "+" ? 1 : -1) * Number(m[3]);
  }
  return out;
}

export interface DamageTraits { types: DamageType[]; /** Text with qualifiers the app can't apply automatically. */ unclear: string | null }

export function parseDamageTraits(text: string | undefined): DamageTraits {
  if (!text) return { types: [], unclear: null };
  const types = DAMAGE_TYPES.filter(t => new RegExp("\\b" + t + "\\b").test(text));
  const leftover = DAMAGE_TYPES.reduce((s, t) => s.replace(new RegExp("\\b" + t + "\\b", "g"), ""), text).replace(/[,;\s]|\band\b/g, "");
  // Qualified text ("…from weapons wielded by…") is shown to the DM, not applied.
  return leftover ? { types: [], unclear: text } : { types, unclear: null };
}

export interface DamageResult { amount: number; note: string }

/** Applies immunity, resistance (halved, rounded down) and vulnerability (doubled). */
export function adjustDamage(monster: Monster, amount: number, type: DamageType | ""): DamageResult {
  if (!type) return { amount, note: "" };
  if (parseDamageTraits(monster.damage_immunities).types.includes(type)) return { amount: 0, note: "immune to " + type };
  let result = amount;
  const notes: string[] = [];
  if (parseDamageTraits(monster.damage_resistances).types.includes(type)) { result = Math.floor(result / 2); notes.push("resistant to " + type); }
  if (parseDamageTraits(monster.damage_vulnerabilities).types.includes(type)) { result *= 2; notes.push("vulnerable to " + type); }
  return { amount: result, note: notes.join(", ") };
}

/** Conditions a monster is immune to, from its stat block. */
export function conditionImmunities(monster: Monster): string[] {
  return (monster.condition_immunities ?? "").split(/,\s*/).map(s => s.trim()).filter(Boolean);
}
