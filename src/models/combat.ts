// A battle in progress or finished. Stored in this site's localStorage.

/** A DM-defined effect on d20 rolls, e.g. Vicious Mockery: Disadvantage on attacks, next roll only. */
export interface ConditionEffect {
  mode: "advantage" | "disadvantage";
  /** The creature's own attack rolls, saves or all d20 rolls — or attack rolls made against it. */
  on: "attacks" | "saves" | "all" | "attacks_against";
}

/**
 * When a condition ends: at the start or end of a combatant's turn, after `count`
 * more of those. "N rounds" is stored as the start of the turn it was added on,
 * N times — one full round each, as in the SRD rules.
 */
export interface ConditionEnd {
  when: "start" | "end";
  /** Combatant whose turn it's measured by. */
  of: string;
  count: number;
  /** How to describe it: "rounds" (N rounds) or "turn" (start/end of X's next turn). */
  style: "rounds" | "turn";
}

export interface ActiveCondition {
  id: string;
  name: string;
  /** Older battles only: rounds left, counted at the end of the affected combatant's turn. New conditions use `ends`. */
  rounds: number | null;
  /** When it ends; absent = until removed. */
  ends?: ConditionEnd;
  /** Who caused it (caster, grappler…). Name kept for display if they leave the battle. */
  source_id?: string;
  source_name?: string;
  /** Only for custom conditions; standard ones have built-in rules (lib/effects.ts). */
  effect?: ConditionEffect;
  /** Removed after the first roll it affects. */
  next_roll_only?: boolean;
}

export interface Combatant {
  id: string;
  kind: "monster" | "pc";
  name: string;
  monster_id?: string;
  party_member_id?: string;
  /** null until rolled or entered. */
  initiative: number | null;
  /** Used to break initiative ties. For PCs, 0 until known. */
  initiative_bonus: number;
  /** PCs added by hand (not from the party): whether initiative_bonus was entered. */
  initiative_bonus_known?: boolean;
  /** Combatants sharing a group act on one initiative roll. */
  init_group?: string;
  armor_class: number;
  /** Monsters only; players track their own hit points. */
  hp?: number;
  max_hp?: number;
  conditions: ActiveCondition[];
  /** Monster defeated, or PC down. */
  out: boolean;
  /** PCs at 0 HP: death saving throws recorded by the DM. Cleared when they're back up. */
  death_saves?: { successes: number; failures: number };
}

export interface LogEntry { id: string; round: number; text: string }

export interface Battle {
  id: string;
  name: string;
  encounter_id?: string;
  /** false while initiative is being set up. */
  started: boolean;
  ended: boolean;
  round: number;
  active_id: string | null;
  combatants: Combatant[];
  log: LogEntry[];
  /** Planned treasure copied from the encounter when the battle started. */
  treasure_note?: string;
  /** What the party found when searching after the battle. */
  loot?: LootItem[];
  timestamp_created: string;
  timestamp_modified: string;
}

export interface LootItem {
  id: string;
  /** Where it was found, e.g. "Bugbear Warrior" or "Planned treasure". */
  source: string;
  text: string;
  taken: boolean;
}

export function isBattle(value: unknown): value is Battle {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Battle>;
  return typeof b.id === "string" && typeof b.name === "string" && typeof b.started === "boolean" && typeof b.ended === "boolean"
    && typeof b.round === "number" && (b.active_id === null || typeof b.active_id === "string")
    && Array.isArray(b.combatants) && b.combatants.every(c => !!c && typeof c.id === "string" && typeof c.name === "string"
      && (c.kind === "monster" || c.kind === "pc") && Array.isArray(c.conditions) && typeof c.out === "boolean")
    && Array.isArray(b.log) && typeof b.timestamp_created === "string";
}

/** The 2024 / SRD 5.2.1 conditions, offered in the condition picker. */
export const CONDITIONS = ["Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated", "Invisible",
  "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious", "Concentrating"] as const;
