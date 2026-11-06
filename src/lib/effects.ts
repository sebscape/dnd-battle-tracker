// How conditions change d20 rolls, per the SRD 5.2.1 Rules Glossary, plus
// DM-defined effects (spells like Vicious Mockery or Guiding Bolt).
import type { ActiveCondition, Combatant, ConditionEffect } from "../models/combat";
import type { Advantage } from "./dice";
import type { Ability } from "./statblock";

export type RollKind = "attack" | "save";

interface Rule { own?: Partial<Record<"attack" | "dexSave", "advantage" | "disadvantage">>; against?: "advantage" | "disadvantage"; autoFailStrDex?: boolean; note?: string; againstNote?: string; incapacitated?: boolean }

/** Standard conditions. Notes are things the app can't judge (distance, sight). */
export const CONDITION_RULES: Record<string, Rule> = {
  Blinded: { own: { attack: "disadvantage" }, against: "advantage" },
  Frightened: { own: { attack: "disadvantage" }, note: "Frightened: Disadvantage only while the source of fear is in line of sight." },
  Grappled: { note: "Grappled: Disadvantage on attacks against anyone other than the grappler." },
  Incapacitated: { incapacitated: true },
  Invisible: { own: { attack: "advantage" }, against: "disadvantage", note: "Invisible: no Advantage against a creature that can see it.", againstNote: "Target is Invisible: no Disadvantage if the attacker can see it." },
  Paralyzed: { against: "advantage", autoFailStrDex: true, incapacitated: true, againstNote: "Target is Paralyzed: a hit from within 5 feet is a critical hit." },
  Petrified: { against: "advantage", autoFailStrDex: true, incapacitated: true },
  Poisoned: { own: { attack: "disadvantage" } },
  Prone: { own: { attack: "disadvantage" }, againstNote: "Target is Prone: Advantage if the attacker is within 5 feet, otherwise Disadvantage — set it with the buttons." },
  Restrained: { own: { attack: "disadvantage", dexSave: "disadvantage" }, against: "advantage" },
  Stunned: { against: "advantage", autoFailStrDex: true, incapacitated: true },
  Unconscious: { against: "advantage", autoFailStrDex: true, incapacitated: true, againstNote: "Target is Unconscious: a hit from within 5 feet is a critical hit." },
  Exhaustion: { note: "Exhaustion: subtract 2 × its Exhaustion level from every d20 roll." },
};

/** Plain-language summary of what a condition does automatically, for the condition picker. */
export function describeRule(name: string): string {
  const r = CONDITION_RULES[name];
  if (!r) return "";
  const parts: string[] = [];
  if (r.own?.attack) parts.push(cap(r.own.attack) + " on its attack rolls");
  if (r.own?.dexSave) parts.push(cap(r.own.dexSave) + " on Dexterity saves");
  if (r.against) parts.push("attacks against it have " + cap(r.against));
  if (r.autoFailStrDex) parts.push("automatically fails Strength and Dexterity saves");
  if (r.incapacitated) parts.push("can't take actions or reactions");
  return parts.length ? "Applied automatically: " + parts.join("; ") + "." : (r.note ? "Reminder only — " + r.note : "");
}

export function describeEffect(e: ConditionEffect, nextOnly?: boolean): string {
  if (e.on === "attacks_against") return (nextOnly ? "the next attack roll against it has " : "attacks against it have ") + cap(e.mode);
  const rolls = nextOnly ? { attacks: "next attack roll", saves: "next saving throw", all: "next d20 roll" } : { attacks: "attack rolls", saves: "saving throws", all: "d20 rolls" };
  return cap(e.mode) + " on its " + rolls[e.on];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface RollEffects {
  /** Mode after Advantage and Disadvantage cancel. */
  mode: Advantage;
  /** e.g. ["Disadvantage: Poisoned", "Advantage: target is Restrained"] */
  reasons: string[];
  /** Plain summary, e.g. "Disadvantage (Poisoned)"; empty when nothing applies. */
  summary: string;
  /** Set when the roll automatically fails (e.g. a Stunned creature's Dexterity save). */
  autoFail: string | null;
  /** Things the DM must judge. */
  reminders: string[];
  /** One-shot effects used up by this roll. */
  consumed: { combatantId: string; condition: ActiveCondition }[];
}

/** Works out Advantage/Disadvantage for a roll from the roller's and target's conditions. */
export function rollEffects(roller: Combatant, target: Combatant | null, kind: RollKind, ability?: Ability): RollEffects {
  const adv: string[] = [], dis: string[] = [], reminders: string[] = [];
  const consumed: RollEffects["consumed"] = [];
  let autoFail: string | null = null;
  const add = (mode: "advantage" | "disadvantage", reason: string) => (mode === "advantage" ? adv : dis).push(reason);

  for (const cond of roller.conditions) {
    const rule = CONDITION_RULES[cond.name];
    if (rule) {
      if (kind === "attack" && rule.own?.attack) add(rule.own.attack, cond.name);
      if (kind === "save" && ability === "Dexterity" && rule.own?.dexSave) add(rule.own.dexSave, cond.name);
      if (kind === "save" && rule.autoFailStrDex && (ability === "Strength" || ability === "Dexterity")) autoFail = cond.name;
      if (rule.note && (kind === "attack" || cond.name === "Exhaustion")) reminders.push(rule.note);
      if (rule.incapacitated && kind === "attack") reminders.push(cond.name + ": it can't take actions or reactions.");
    }
    const e = cond.effect;
    if (e && e.on !== "attacks_against" && (e.on === "all" || (e.on === "attacks" && kind === "attack") || (e.on === "saves" && kind === "save"))) {
      add(e.mode, cond.name);
      if (cond.next_roll_only) consumed.push({ combatantId: roller.id, condition: cond });
    }
  }

  if (kind === "attack" && target) {
    // A PC at 0 HP is Unconscious even if the condition wasn't added by hand.
    if (isDownPc(target) && !target.conditions.some(x => x.name === "Unconscious")) {
      add("advantage", "target is down (Unconscious)");
      reminders.push("Target is down: a hit from within 5 feet is a critical hit, and any hit causes a death save failure (two on a critical hit).");
    }
    for (const cond of target.conditions) {
      const rule = CONDITION_RULES[cond.name];
      if (rule?.against) add(rule.against, "target is " + cond.name);
      if (rule?.againstNote) reminders.push(rule.againstNote);
      const e = cond.effect;
      if (e?.on === "attacks_against") {
        add(e.mode, "target has " + cond.name);
        if (cond.next_roll_only) consumed.push({ combatantId: target.id, condition: cond });
      }
    }
  }

  // Advantage and Disadvantage on the same roll cancel, however many of each.
  const mode: Advantage = adv.length && dis.length ? "normal" : adv.length ? "advantage" : dis.length ? "disadvantage" : "normal";
  const reasons = [...adv.map(r => "Advantage: " + r), ...dis.map(r => "Disadvantage: " + r)];
  if (adv.length && dis.length) reasons.push("they cancel out");
  const summary = adv.length && dis.length ? "Normal: Advantage (" + adv.join(", ") + ") and Disadvantage (" + dis.join(", ") + ") cancel out"
    : adv.length ? "Advantage (" + adv.join(", ") + ")" : dis.length ? "Disadvantage (" + dis.join(", ") + ")" : "";
  return { mode, reasons, summary, autoFail, reminders: [...new Set(reminders)], consumed };
}

/** A PC at 0 HP who isn't dead yet. */
export const isDownPc = (c: Combatant) => c.kind === "pc" && c.out && (c.death_saves?.failures ?? 0) < 3;

export type BadgeKind = "adv-against" | "dis-against" | "mixed" | "prone" | "crit" | "own-dis" | "own-adv" | "no-actions" | "concentrating" | "death-saves" | "stable" | "dead";
/** label: what the badge shows; meaning: the unabbreviated meaning; detail: why it applies. */
export interface Badge { kind: BadgeKind; label: string; meaning: string; detail: string }

/** Unabbreviated meaning of each badge, also used for the badge key. */
export const BADGE_KEY: { kind: BadgeKind; label: string; meaning: string }[] = [
  { kind: "adv-against", label: "Adv", meaning: "Attacks against it have Advantage" },
  { kind: "dis-against", label: "Dis", meaning: "Attacks against it have Disadvantage" },
  { kind: "mixed", label: "Adv/Dis", meaning: "Attacks against it: Advantage and Disadvantage cancel out" },
  { kind: "prone", label: "Prone", meaning: "Prone: Advantage for attackers within 5 feet, Disadvantage from farther away" },
  { kind: "crit", label: "Crit", meaning: "Any hit from within 5 feet is a critical hit" },
  { kind: "own-dis", label: "Atk▼", meaning: "Its own attack rolls have Disadvantage" },
  { kind: "own-adv", label: "Atk▲", meaning: "Its own attack rolls have Advantage" },
  { kind: "no-actions", label: "No actions", meaning: "Can't take actions or reactions (no opportunity attacks)" },
  { kind: "concentrating", label: "Conc", meaning: "Concentrating on a spell" },
  { kind: "death-saves", label: "✓1 ✗2", meaning: "Death saving throws: successes ✓ and failures ✗" },
  { kind: "stable", label: "Stable", meaning: "Stable at 0 hit points" },
  { kind: "dead", label: "Dead", meaning: "Dead (three failed death saves)" },
];
const MEANING = Object.fromEntries(BADGE_KEY.map(k => [k.kind, k.meaning])) as Record<BadgeKind, string>;
const badge = (kind: BadgeKind, label: string, detail: string, meaning = MEANING[kind]): Badge => ({ kind, label, meaning, detail });

const NO_ATTACKER: Combatant = { id: "", kind: "monster", name: "", initiative: null, initiative_bonus: 0, armor_class: 0, conditions: [], out: false };
const tidy = (r: string) => r.replace(/^(Advantage|Disadvantage): /, "").replace(/^target (is|has) /, "");
const because = (xs: string[]) => "Because: " + xs.map(x => x[0].toUpperCase() + x.slice(1)).join(", ") + ".";

/** Short status badges for the initiative list: what matters when choosing a target. */
export function statusBadges(c: Combatant): Badge[] {
  const badges: Badge[] = [];
  const has = (name: string) => c.conditions.some(x => x.name === name);
  const ds = c.death_saves ?? { successes: 0, failures: 0 };

  if (c.kind === "pc" && c.out) {
    if (ds.failures >= 3) return [badge("dead", "Dead", "")];
    if (ds.successes >= 3) badges.push(badge("stable", "Stable", "Three successful death saves. Taking damage makes them start over, and counts as a failure."));
    else badges.push(badge("death-saves", "✓" + ds.successes + " ✗" + ds.failures, "",
      "Death saving throws: " + ds.successes + " success" + (ds.successes === 1 ? "" : "es") + ", " + ds.failures + " failure" + (ds.failures === 1 ? "" : "s")));
  }
  if (c.kind === "monster" && c.out) return badges;

  // How attacks against it are rolled (attacker's own conditions aside).
  const against = rollEffects(NO_ATTACKER, c, "attack");
  const adv = against.reasons.filter(r => r.startsWith("Advantage: ")).map(tidy);
  const dis = against.reasons.filter(r => r.startsWith("Disadvantage: ")).map(tidy);
  if (against.mode === "advantage") badges.push(badge("adv-against", "Adv", because(adv)));
  if (against.mode === "disadvantage") badges.push(badge("dis-against", "Dis", because(dis)));
  if (against.mode === "normal" && adv.length && dis.length) badges.push(badge("mixed", "Adv/Dis", "Advantage: " + adv.join(", ") + ". Disadvantage: " + dis.join(", ") + "."));
  if (has("Prone")) badges.push(badge("prone", "Prone", "The app can't tell distance — set Advantage or Disadvantage on the attacker's Next d20 buttons."));
  if (has("Paralyzed") || has("Unconscious") || isDownPc(c)) badges.push(badge("crit", "Crit",
    because([...(has("Paralyzed") ? ["Paralyzed"] : []), ...(has("Unconscious") ? ["Unconscious"] : []), ...(isDownPc(c) && !has("Unconscious") ? ["down (Unconscious)"] : [])])));

  // Its own attacks.
  const own = rollEffects(c, null, "attack");
  const ownWhy = own.reasons.map(tidy).filter(r => r !== "they cancel out");
  if (!c.out && own.mode === "disadvantage") badges.push(badge("own-dis", "Atk▼", because(ownWhy)));
  if (!c.out && own.mode === "advantage") badges.push(badge("own-adv", "Atk▲", because(ownWhy)));

  const noAct = c.conditions.filter(x => CONDITION_RULES[x.name]?.incapacitated || x.name === "Incapacitated").map(x => x.name);
  if (noAct.length && !c.out) badges.push(badge("no-actions", "No actions", because(noAct)));
  if (has("Concentrating")) badges.push(badge("concentrating", "Conc", "Taking damage forces a Constitution saving throw (DC 10 or half the damage, whichever is higher, up to 30) to keep the spell."));
  return badges;
}

/** Petrified creatures have Resistance to all damage. */
export const resistsAllDamage = (c: Combatant) => c.conditions.some(x => x.name === "Petrified");
