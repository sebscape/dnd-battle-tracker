// Pure battle rules: creating a battle, turn order, hit points and conditions.
// Every function returns a new Battle; the caller keeps old ones for undo.
import type { ActiveCondition, Battle, Combatant, ConditionEffect, ConditionEnd, LootItem } from "../models/combat";
import { CONDITIONS } from "../models/combat";
import { describeEffect } from "./effects";
import type { Encounter, PartyMember } from "../models/battle";
import type { Monster } from "../models/monster";
import { describeD20, parseDice, rollD20, rollDice } from "./dice";

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function withLog(b: Battle, text: string): Battle {
  return { ...b, log: [...b.log, { id: uid(), round: b.round, text }], timestamp_modified: now() };
}

/** Rolled hit points from the stat block's hit dice (minimum 1); falls back to listed HP. */
export function rollHitPoints(m: Monster): number {
  const d = m.hit_dice ? parseDice(m.hit_dice) : null;
  return d ? Math.max(1, rollDice(d).total) : m.hit_points;
}

export function pcCombatant(p: PartyMember): Combatant {
  return { id: uid(), kind: "pc", name: p.name || "Unnamed character", party_member_id: p.id, initiative: null, initiative_bonus: p.initiative_bonus ?? 0,
    armor_class: p.armor_class, conditions: [], out: false };
}

/**
 * Party members in a battle follow the Party tab: name and AC come from the roster.
 * Returns the same battle object when nothing changed. PCs whose roster entry was
 * deleted keep the details they had.
 */
export function syncParty(b: Battle, party: PartyMember[]): Battle {
  let changed = false;
  const combatants = b.combatants.map(c => {
    const p = c.kind === "pc" && c.party_member_id ? party.find(x => x.id === c.party_member_id) : undefined;
    if (!p) return c;
    const name = p.name.trim() || "Unnamed character";
    if (c.name === name && c.armor_class === p.armor_class) return c;
    changed = true;
    return { ...c, name, armor_class: p.armor_class };
  });
  return changed ? { ...b, combatants } : b;
}

/** A PC's initiative bonus: from the party roster (read live, so later edits count), or entered when added by hand. */
export function pcInitiativeBonus(c: Combatant, party: PartyMember[]): number | undefined {
  if (c.kind !== "pc") return undefined;
  if (c.party_member_id) return party.find(p => p.id === c.party_member_id)?.initiative_bonus;
  return c.initiative_bonus_known ? c.initiative_bonus : undefined;
}

/** Rolls initiative for the given PCs (d20 + bonus) and logs the results. */
export function rollPcInitiative(b: Battle, ids: string[], party: PartyMember[]): Battle {
  const results: string[] = [];
  const combatants = b.combatants.map(c => {
    if (!ids.includes(c.id)) return c;
    const bonus = pcInitiativeBonus(c, party);
    if (bonus === undefined) return c;
    const r = rollD20(bonus);
    results.push(c.name + " " + r.total + " (" + describeD20(r) + ")");
    return { ...c, initiative: r.total, initiative_bonus: bonus };
  });
  if (!results.length) return b;
  return withLog({ ...b, combatants, timestamp_modified: now() }, "PC initiative rolled: " + results.join(", ") + ".");
}

/** Copies of a monster with rolled HP and initiative. Numbered when there's more than one. */
export function monsterCombatants(m: Monster, count: number, groupInitiative: boolean, existing: Combatant[] = []): Combatant[] {
  const taken = existing.filter(c => c.monster_id === m.id).length;
  const numbered = count > 1 || taken > 0;
  const group = groupInitiative && count > 1 ? uid() : undefined;
  const shared = group ? rollD20(m.initiative_bonus).total : null;
  return Array.from({ length: count }, (_, i) => {
    const hp = rollHitPoints(m);
    return { id: uid(), kind: "monster" as const, name: numbered ? m.name + " " + (taken + i + 1) : m.name, monster_id: m.id,
      initiative: shared ?? rollD20(m.initiative_bonus).total, initiative_bonus: m.initiative_bonus, init_group: group,
      armor_class: m.armor_class, hp, max_hp: hp, conditions: [], out: false };
  });
}

export function createBattle(name: string, encounter: Encounter | null, party: PartyMember[], byId: Map<string, Monster>): { battle: Battle; skipped: string[] } {
  const combatants: Combatant[] = [];
  const skipped: string[] = [];
  if (encounter) {
    for (const p of party) if (encounter.party_member_ids.includes(p.id)) combatants.push(pcCombatant(p));
    for (const em of encounter.monsters) {
      const m = byId.get(em.monster_id);
      if (m) combatants.push(...monsterCombatants(m, em.count, em.group_initiative, combatants));
      else skipped.push(em.monster_name);
    }
  }
  const t = now();
  let battle: Battle = { id: uid(), name, encounter_id: encounter?.id, started: false, ended: false, round: 0, active_id: null,
    combatants, log: [], ...(encounter?.treasure?.trim() ? { treasure_note: encounter.treasure.trim() } : {}), timestamp_created: t, timestamp_modified: t };
  battle = withLog(battle, "Battle set up" + (encounter ? " from \"" + encounter.name + "\"" : "") + ". Monster initiative and hit points rolled.");
  if (skipped.length) battle = withLog(battle, "Skipped unavailable monsters: " + skipped.join(", ") + ".");
  return { battle, skipped };
}

/** Initiative order: highest first; ties by initiative bonus, then name. Unset initiative goes last. */
export function turnOrder(b: Battle): Combatant[] {
  return [...b.combatants].sort((x, y) =>
    (y.initiative ?? -Infinity) - (x.initiative ?? -Infinity) || y.initiative_bonus - x.initiative_bonus || x.name.localeCompare(y.name));
}

const update = (b: Battle, id: string, patch: (c: Combatant) => Partial<Combatant>): Battle =>
  ({ ...b, combatants: b.combatants.map(c => c.id === id ? { ...c, ...patch(c) } : c), timestamp_modified: now() });

const named = (b: Battle, id: string) => b.combatants.find(c => c.id === id)?.name ?? "?";

/** Sets initiative; combatants in the same initiative group all change together. */
export function setInitiative(b: Battle, id: string, value: number | null): Battle {
  const target = b.combatants.find(c => c.id === id);
  if (!target) return b;
  const ids = target.init_group ? b.combatants.filter(c => c.init_group === target.init_group).map(c => c.id) : [id];
  return { ...b, combatants: b.combatants.map(c => ids.includes(c.id) ? { ...c, initiative: value } : c), timestamp_modified: now() };
}

export function rerollInitiative(b: Battle, id: string): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c) return b;
  const total = rollD20(c.initiative_bonus).total;
  return withLog(setInitiative(b, id, total), c.name + (c.init_group ? " (group)" : "") + " initiative: " + total + ".");
}

export function begin(b: Battle): Battle {
  const first = turnOrder(b).find(c => !(c.kind === "monster" && c.out)) ?? null;
  return withLog({ ...b, started: true, round: 1, active_id: first?.id ?? null }, "Round 1 begins." + (first ? " " + first.name + " acts first." : ""));
}

/** Ends the current turn (counting down its conditions) and moves to the next combatant who can act. */
const isStandard = (name: string) => (CONDITIONS as readonly string[]).includes(name);
const endedText = (who: string, cond: ActiveCondition) => who + (isStandard(cond.name) ? " is no longer " : " is no longer affected by ") + cond.name + ".";

/** Counts down conditions that end at the start or end of `turnOf`'s turn, removing and logging those that run out. */
function tick(b: Battle, turnOf: string, when: "start" | "end"): Battle {
  const ended: string[] = [];
  const combatants = b.combatants.map(c => {
    let changed = false;
    const conditions = c.conditions.flatMap(cond => {
      if (!cond.ends || cond.ends.of !== turnOf || cond.ends.when !== when) return [cond];
      changed = true;
      if (cond.ends.count <= 1) { ended.push(endedText(c.name, cond)); return []; }
      return [{ ...cond, ends: { ...cond.ends, count: cond.ends.count - 1 } }];
    });
    return changed ? { ...c, conditions } : c;
  });
  let out: Battle = { ...b, combatants };
  for (const text of ended) out = withLog(out, text);
  return out;
}

/** Ends the current turn (counting down conditions) and moves to the next combatant who can act. */
export function nextTurn(b: Battle): Battle {
  const order = turnOrder(b);
  if (!order.length) return b;
  let out = b;
  const current = b.active_id ? b.combatants.find(c => c.id === b.active_id) : null;
  if (current) {
    // Older saved conditions: rounds counted at the end of the affected creature's turn.
    const expired: ActiveCondition[] = [];
    const conditions = current.conditions.flatMap(cond => {
      if (cond.ends || cond.rounds === null) return [cond];
      if (cond.rounds <= 1) { expired.push(cond); return []; }
      return [{ ...cond, rounds: cond.rounds - 1 }];
    });
    out = update(out, current.id, () => ({ conditions }));
    for (const cond of expired) out = withLog(out, endedText(current.name, cond));
    out = tick(out, current.id, "end");
  }
  const start = Math.max(0, order.findIndex(c => c.id === b.active_id));
  // Defeated monsters are skipped; downed PCs still get a turn (death saving throws).
  for (let step = 1; step <= order.length; step++) {
    const idx = (start + step) % order.length;
    const c = order[idx];
    const skip = (c.kind === "monster" && c.out) || (c.kind === "pc" && c.out && (c.death_saves?.failures ?? 0) >= 3);
    if (skip) {
      // A skipped turn still passes in time for effects measured by it.
      out = tick(tick(out, c.id, "start"), c.id, "end");
      continue;
    }
    const wrapped = idx <= start;
    const round = wrapped ? out.round + 1 : out.round;
    out = withLog({ ...out, active_id: c.id, round }, (wrapped ? "Round " + round + ". " : "") + c.name + "'s turn.");
    return tick(out, c.id, "start");
  }
  return out;
}

export function damage(b: Battle, id: string, amount: number, note: string): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c || c.hp === undefined) return b;
  const hp = Math.max(0, c.hp - amount);
  let out = update(b, id, () => ({ hp, out: hp === 0 ? true : c.out }));
  out = withLog(out, c.name + " takes " + amount + " damage" + (note ? " (" + note + ")" : "") + ": " + c.hp + " → " + hp + " HP.");
  return hp === 0 && !c.out ? releaseGrapples(withLog(out, c.name + " is defeated."), id, c.name + " is defeated") : out;
}

/** Conditions that leave a creature Incapacitated, which ends any grapple it holds. */
const INCAPACITATING = ["Incapacitated", "Paralyzed", "Petrified", "Stunned", "Unconscious"];

/** Ends every grapple held by `grapplerId` (SRD: the grappler is Incapacitated, defeated or gone). */
export function releaseGrapples(b: Battle, grapplerId: string, why: string): Battle {
  const freed: string[] = [];
  const combatants = b.combatants.map(c => {
    if (!c.conditions.some(x => x.name === "Grappled" && x.source_id === grapplerId)) return c;
    freed.push(c.name);
    return { ...c, conditions: c.conditions.filter(x => !(x.name === "Grappled" && x.source_id === grapplerId)) };
  });
  if (!freed.length) return b;
  return withLog({ ...b, combatants }, freed.join(", ") + (freed.length === 1 ? " is" : " are") + " no longer Grappled (" + why + ").");
}

/** Adds failed death saves to a downed PC, e.g. when a monster hits them (1, or 2 on a critical hit). */
export function addDeathSaveFailures(b: Battle, id: string, n: number, why: string): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c || c.kind !== "pc" || !c.out) return b;
  const ds = c.death_saves ?? { successes: 0, failures: 0 };
  return setDeathSaves(withLog(b, c.name + " suffers " + n + " death save failure" + (n === 1 ? "" : "s") + " (" + why + ")."), id, ds.successes, ds.failures + n);
}

export function heal(b: Battle, id: string, amount: number): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c || c.hp === undefined || c.max_hp === undefined) return b;
  const hp = Math.min(c.max_hp, c.hp + amount);
  return withLog(update(b, id, () => ({ hp, out: hp > 0 ? false : c.out })), c.name + " regains " + (hp - c.hp) + " HP: " + c.hp + " → " + hp + " HP.");
}

export function setHitPoints(b: Battle, id: string, hp: number, maxHp: number): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c) return b;
  const max = Math.max(1, maxHp), cur = Math.min(max, Math.max(0, hp));
  return withLog(update(b, id, () => ({ hp: cur, max_hp: max, out: cur === 0 })), c.name + " HP set to " + cur + " / " + max + ".");
}

export function setOut(b: Battle, id: string, isOut: boolean): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c) return b;
  const label = c.kind === "pc" ? (isOut ? "is down" : "is back up") : (isOut ? "is defeated" : "is back in the fight");
  // Death saves start fresh each time a PC drops to 0 HP.
  let out = withLog(update(b, id, () => ({ out: isOut, death_saves: undefined })), c.name + " " + label + ".");
  if (!isOut || c.out) return out;
  out = releaseGrapples(out, id, c.name + (c.kind === "pc" ? " is down" : " is defeated"));
  // A PC at 0 HP is Unconscious, and an Unconscious creature falls Prone.
  if (c.kind === "pc" && !c.conditions.some(x => x.name === "Prone")) {
    out = withLog(update(out, id, x => ({ conditions: [...x.conditions, { id: uid(), name: "Prone", rounds: null }] })), c.name + " falls Prone.");
  }
  return out;
}

/** Records a downed PC's death saving throws (players roll their own). */
export function setDeathSaves(b: Battle, id: string, successes: number, failures: number): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c || c.kind !== "pc") return b;
  const s = Math.max(0, Math.min(3, successes)), f = Math.max(0, Math.min(3, failures));
  const prev = c.death_saves ?? { successes: 0, failures: 0 };
  let out = update(b, id, () => ({ death_saves: { successes: s, failures: f } }));
  const status = f >= 3 && prev.failures < 3 ? " " + c.name + " dies." : s >= 3 && prev.successes < 3 ? " " + c.name + " is stable." : "";
  out = withLog(out, c.name + " death saves: " + s + " success" + (s === 1 ? "" : "es") + ", " + f + " failure" + (f === 1 ? "" : "s") + "." + status);
  return out;
}

export function rename(b: Battle, id: string, name: string): Battle {
  return update(b, id, () => ({ name }));
}

export type Duration =
  | { type: "until_removed" }
  | { type: "rounds"; rounds: number }
  | { type: "turn"; when: "start" | "end"; of: string };

export interface ConditionOptions { effect?: ConditionEffect; nextRollOnly?: boolean; sourceId?: string; duration?: Duration }

/** Works out when a new condition ends, measured from the current turn. */
export function conditionEnd(b: Battle, affectedId: string, d: Duration): ConditionEnd | undefined {
  if (d.type === "rounds") return { when: "start", of: b.active_id ?? affectedId, count: Math.max(1, d.rounds), style: "rounds" };
  if (d.type === "turn") {
    // "End of X's next turn" added during X's own turn: this turn's end doesn't count.
    const extra = d.when === "end" && d.of === b.active_id ? 1 : 0;
    return { when: d.when, of: d.of, count: 1 + extra, style: "turn" };
  }
  return undefined;
}

export function addCondition(b: Battle, id: string, name: string, opts: ConditionOptions = {}): Battle {
  const { effect, nextRollOnly = false, sourceId, duration = { type: "until_removed" } } = opts;
  const source = sourceId ? b.combatants.find(c => c.id === sourceId) : undefined;
  const ends = conditionEnd(b, id, duration);
  const cond: ActiveCondition = { id: uid(), name, rounds: null,
    ...(ends ? { ends } : {}), ...(source ? { source_id: source.id, source_name: source.name } : {}),
    ...(effect ? { effect } : {}), ...(effect && nextRollOnly ? { next_roll_only: true } : {}) };
  const by = source && source.id !== id ? " (from " + source.name + ")" : "";
  const timing = ends ? " " + describeTiming(cond, x => named(b, x), true) : "";
  const detail = effect ? " — " + describeEffect(effect, cond.next_roll_only) : "";
  const out = withLog(update(b, id, c => ({ conditions: [...c.conditions, cond] })),
    named(b, id) + (isStandard(name) ? " is " : " is affected by ") + name + by + timing + detail + ".");
  return INCAPACITATING.includes(name) ? releaseGrapples(out, id, named(b, id) + " is " + name) : out;
}

/**
 * How long a condition lasts, e.g. "2 rounds left" / "until the end of Cleric's next turn".
 * `long` gives the sentence form used in the log and tooltips.
 */
export function describeTiming(cond: ActiveCondition, nameOf: (id: string) => string, long = false): string {
  const e = cond.ends;
  if (!e) return cond.rounds !== null ? (long ? "for " + cond.rounds + " more round" + (cond.rounds === 1 ? "" : "s") : cond.rounds + " rd") : "";
  if (e.style === "rounds") return long ? "for " + e.count + " round" + (e.count === 1 ? "" : "s") : e.count + " rd";
  const whose = nameOf(e.of);
  return (long ? "until the " : "until ") + e.when + " of " + whose + "'s " + (long ? "next turn" : "turn");
}

/** Removes one-shot effects used up by a roll. */
export function consumeConditions(b: Battle, used: { combatantId: string; condition: ActiveCondition }[]): Battle {
  let out = b;
  for (const { combatantId, condition } of used) {
    out = withLog(update(out, combatantId, c => ({ conditions: c.conditions.filter(x => x.id !== condition.id) })),
      named(out, combatantId) + "'s " + condition.name + " is used up.");
  }
  return out;
}

export function removeCondition(b: Battle, id: string, conditionId: string): Battle {
  const cond = b.combatants.find(c => c.id === id)?.conditions.find(x => x.id === conditionId);
  const standard = !!cond && (CONDITIONS as readonly string[]).includes(cond.name);
  return withLog(update(b, id, c => ({ conditions: c.conditions.filter(x => x.id !== conditionId) })),
    named(b, id) + (standard ? " is no longer " + cond!.name : cond ? " is no longer affected by " + cond.name : " is no longer affected") + ".");
}

export function addCombatants(b: Battle, list: Combatant[]): Battle {
  return withLog({ ...b, combatants: [...b.combatants, ...list] }, "Added " + list.map(c => c.name).join(", ") + ".");
}

export function removeCombatant(b: Battle, id: string): Battle {
  let out = b;
  if (b.active_id === id && b.started) out = nextTurn(b);
  const name = named(b, id);
  out = releaseGrapples(out, id, name + " left the battle");
  // Effects timed by the removed combatant's turns can no longer run out on their own.
  const orphaned: string[] = [];
  out = { ...out, combatants: out.combatants.filter(c => c.id !== id).map(c => {
    if (!c.conditions.some(x => x.ends?.of === id)) return c;
    return { ...c, conditions: c.conditions.map(x => {
      if (x.ends?.of !== id) return x;
      orphaned.push(c.name + "'s " + x.name);
      const { ends: _ends, ...rest } = x;
      return rest;
    }) };
  }) };
  if (orphaned.length) out = withLog(out, orphaned.join(", ") + (orphaned.length === 1 ? " now lasts until removed (it was" : " now last until removed (they were") + " timed by " + name + "'s turns).");
  if (out.active_id === id) out = { ...out, active_id: null };
  return withLog(out, name + " removed from the battle.");
}

export function endBattle(b: Battle, loot?: LootItem[]): Battle {
  let out = withLog({ ...b, ended: true, active_id: null, ...(loot ? { loot } : {}) }, "Battle ended after " + b.round + " round" + (b.round === 1 ? "" : "s") + ".");
  const taken = (loot ?? []).filter(x => x.taken);
  if (loot) out = withLog(out, taken.length ? "Loot taken: " + taken.map(x => x.text + " (" + x.source + ")").join("; ") + "." : "The party searched but took nothing.");
  return out;
}

/** Monsters all defeated / PCs all down — the cue to end the battle. */
export function battleOver(b: Battle): "enemies" | "party" | null {
  if (!b.started) return null;
  const monsters = b.combatants.filter(c => c.kind === "monster"), pcs = b.combatants.filter(c => c.kind === "pc");
  if (monsters.length && monsters.every(c => c.out)) return "enemies";
  if (pcs.length && pcs.every(c => c.out)) return "party";
  return null;
}
