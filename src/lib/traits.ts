// Conditional Advantage written into SRD 5.2.1 stat blocks. Applied automatically
// when the app knows enough (HP of monsters, who is grappling whom); otherwise
// offered to the DM as a one-click toggle ("prompt").
import type { Combatant } from "../models/combat";
import type { Monster, NamedFeature } from "../models/monster";
import type { RollKind } from "./effects";

export interface Prompt { key: string; label: string; note: string }
export interface Situational {
  /** Advantage reasons that apply now. */
  auto: string[];
  /** Things the DM must judge, with a toggle. */
  prompts: Prompt[];
}

const PACK = /has Advantage on (?:an )?attack rolls? against a creature if at least one of the .+? allies is within 5 feet of the creature/;
const BLOODIED = /While Bloodied, the .+? has Advantage on (melee )?attack rolls( and saving throws)?|has Advantage on (melee )?attack rolls while it is Bloodied/;
const HURT_TARGET_TRAIT = /has Advantage on attack rolls against any creature that doesn[’']t have all its Hit Points/;
const HURT_TARGET_ATTACK = /\(with Advantage if the target doesn[’']t have all its Hit Points\)/;
const GRAPPLED_BY_SELF = /\(with Advantage if the target is Grappled by the [^)]+\)/;

const isBloodied = (c: Combatant) => c.hp !== undefined && c.max_hp !== undefined && c.hp > 0 && c.hp <= c.max_hp / 2;

/** Whether the target is missing hit points: known for monsters, not for PCs (players track their own). */
function targetHurt(target: Combatant | null): boolean | null {
  if (!target || target.kind === "pc") return target?.kind === "pc" && target.out ? true : null;
  return target.hp !== undefined && target.max_hp !== undefined ? target.hp < target.max_hp : null;
}

/**
 * Conditional Advantage for one of a monster's rolls.
 * With `feature` (an attack), rules written into that attack are included too.
 */
export function situationalAdvantage(monster: Monster | undefined, self: Combatant, target: Combatant | null, kind: RollKind, feature?: NamedFeature): Situational {
  const out: Situational = { auto: [], prompts: [] };
  if (!monster) return out;
  const isMelee = feature ? /^Melee/.test(feature.description) : null;

  for (const t of monster.traits ?? []) {
    const d = t.description;
    if (kind === "attack" && PACK.test(d)) {
      out.prompts.push({ key: "trait:" + t.name, label: t.name, note: t.name + ": Advantage if one of its allies is within 5 feet of the target and isn't Incapacitated." });
    }
    const bl = BLOODIED.exec(d);
    if (bl) {
      const meleeOnly = !!(bl[1] || bl[3]);
      const coversSaves = !!bl[2];
      if ((kind === "attack" || coversSaves) && isBloodied(self)) {
        if (kind === "attack" && meleeOnly && isMelee === false) { /* ranged attack: doesn't apply */ }
        else if (kind === "attack" && meleeOnly && isMelee === null) out.prompts.push({ key: "trait:" + t.name, label: t.name, note: t.name + ": Advantage on melee attacks while Bloodied (it is)." });
        else out.auto.push(t.name + " (Bloodied)");
      }
    }
    if (kind === "attack" && HURT_TARGET_TRAIT.test(d)) {
      const hurt = targetHurt(target);
      if (hurt === true) out.auto.push(t.name + " (target is hurt)");
      else if (hurt === null) out.prompts.push({ key: "trait:" + t.name, label: t.name, note: t.name + ": Advantage if the target is missing any hit points." });
    }
  }

  if (kind === "attack" && feature) {
    const d = feature.description;
    if (HURT_TARGET_ATTACK.test(d)) {
      const hurt = targetHurt(target);
      if (hurt === true) out.auto.push(feature.name + ": target is hurt");
      else if (hurt === null) out.prompts.push({ key: "attack:" + feature.name, label: feature.name + " vs hurt target", note: feature.name + ": Advantage if the target is missing any hit points." });
    }
    if (GRAPPLED_BY_SELF.test(d) && target) {
      const grapples = target.conditions.filter(c => c.name === "Grappled");
      if (grapples.some(c => c.source_id === self.id)) out.auto.push(feature.name + ": target is Grappled by " + self.name);
      else if (grapples.some(c => !c.source_id)) out.prompts.push({ key: "attack:" + feature.name, label: feature.name + " vs grappled target",
        note: feature.name + ": Advantage if " + self.name + " is the one grappling the target (the grapple has no \"caused by\" recorded)." });
    }
  }
  return out;
}
