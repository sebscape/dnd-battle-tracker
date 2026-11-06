// Pure battle rules: creating a battle, turn order, hit points and conditions.
// Every function returns a new Battle; the caller keeps old ones for undo.
import type { ActiveCondition, Battle, Combatant, ConditionEffect } from "../models/combat";
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
    combatants, log: [], timestamp_created: t, timestamp_modified: t };
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
export function nextTurn(b: Battle): Battle {
  const order = turnOrder(b);
  if (!order.length) return b;
  let out = b;
  const current = b.active_id ? b.combatants.find(c => c.id === b.active_id) : null;
  if (current) {
    const expired: string[] = [];
    const conditions = current.conditions.flatMap(cond => {
      if (cond.rounds === null) return [cond];
      if (cond.rounds <= 1) { expired.push(cond.name); return []; }
      return [{ ...cond, rounds: cond.rounds - 1 }];
    });
    out = update(out, current.id, () => ({ conditions }));
    for (const name of expired) out = withLog(out, current.name + ((CONDITIONS as readonly string[]).includes(name) ? " is no longer " : " is no longer affected by ") + name + ".");
  }
  const start = Math.max(0, order.findIndex(c => c.id === b.active_id));
  // Defeated monsters are skipped; downed PCs still get a turn (death saving throws).
  for (let step = 1; step <= order.length; step++) {
    const idx = (start + step) % order.length;
    const c = order[idx];
    if (c.kind === "monster" && c.out) continue;
    const wrapped = idx <= start;
    const round = wrapped ? out.round + 1 : out.round;
    out = { ...out, active_id: c.id, round };
    return withLog(out, (wrapped ? "Round " + round + ". " : "") + c.name + "'s turn.");
  }
  return out;
}

export function damage(b: Battle, id: string, amount: number, note: string): Battle {
  const c = b.combatants.find(x => x.id === id);
  if (!c || c.hp === undefined) return b;
  const hp = Math.max(0, c.hp - amount);
  let out = update(b, id, () => ({ hp, out: hp === 0 ? true : c.out }));
  out = withLog(out, c.name + " takes " + amount + " damage" + (note ? " (" + note + ")" : "") + ": " + c.hp + " → " + hp + " HP.");
  return hp === 0 && !c.out ? withLog(out, c.name + " is defeated.") : out;
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
  return withLog(update(b, id, () => ({ out: isOut })), c.name + " " + label + ".");
}

export function rename(b: Battle, id: string, name: string): Battle {
  return update(b, id, () => ({ name }));
}

export function addCondition(b: Battle, id: string, name: string, rounds: number | null, effect?: ConditionEffect, nextRollOnly = false): Battle {
  const cond: ActiveCondition = { id: uid(), name, rounds, ...(effect ? { effect } : {}), ...(effect && nextRollOnly ? { next_roll_only: true } : {}) };
  const duration = rounds ? " for " + rounds + " round" + (rounds === 1 ? "" : "s") : "";
  const detail = effect ? " (" + describeEffect(effect, cond.next_roll_only) + ")" : "";
  const standard = (CONDITIONS as readonly string[]).includes(name);
  return withLog(update(b, id, c => ({ conditions: [...c.conditions, cond] })),
    named(b, id) + (standard ? " is " : " is affected by ") + name + duration + detail + ".");
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
  out = { ...out, combatants: out.combatants.filter(c => c.id !== id) };
  if (out.active_id === id) out = { ...out, active_id: null };
  return withLog(out, name + " removed from the battle.");
}

export function endBattle(b: Battle): Battle {
  return withLog({ ...b, ended: true, active_id: null }, "Battle ended after " + b.round + " round" + (b.round === 1 ? "" : "s") + ".");
}
