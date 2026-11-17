// Battle-tracker records stored in this site's browser storage.

export interface PartyMember {
  id: string;
  name: string;
  level: number;
  armor_class: number;
  passive_perception: number;
  /** Optional; unset until the player provides it. Needed for "Roll PCs". */
  initiative_bonus?: number;
  notes?: string;
}

export interface EncounterMonster {
  /** Monster UUID (published or custom). */
  monster_id: string;
  /** Name when added, shown if the monster later becomes unavailable. */
  monster_name: string;
  count: number;
  /** All copies share one initiative roll. Default false. */
  group_initiative: boolean;
}

/** A way the party might avoid the fight, with the check that decides it. */
export interface AvoidOption {
  action: string;
  check: string;
  dc: number;
  success: string;
  failure: string;
}

export interface Encounter {
  id: string;
  name: string;
  notes?: string;
  /** Where the fight takes place (one of the generator's environments). */
  environment?: string;
  /** Loot the DM planned for this fight; shown when the battle ends. */
  treasure?: string;
  // Story fields (written by the DM or by "Generate with AI"). All optional so
  // encounters saved before they existed still load unchanged.
  /** The DM's description of the circumstances, used as the AI prompt. */
  situation?: string;
  /** Boxed text to read to the players. */
  read_aloud?: string;
  /** Why the opponents are here and why it might come to a fight. */
  motivation?: string;
  /** Ways to avoid combat, each with a check and DC. */
  avoiding_combat?: AvoidOption[];
  /** How the opponents fight. */
  dm_tactics?: string;
  party_member_ids: string[];
  monsters: EncounterMonster[];
  timestamp_created: string;
  timestamp_modified: string;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isString = (v: unknown): v is string => typeof v === "string";

export function isPartyMember(value: unknown): value is PartyMember {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<PartyMember>;
  return isString(p.id) && p.id.length > 0 && isString(p.name)
    && isInt(p.level, 1, 20) && isInt(p.armor_class, 0, 50) && isInt(p.passive_perception, 0, 50)
    && (p.initiative_bonus === undefined || isInt(p.initiative_bonus, -10, 30))
    && (p.notes === undefined || isString(p.notes));
}

export function isAvoidOption(value: unknown): value is AvoidOption {
  if (!value || typeof value !== "object") return false;
  const o = value as Partial<AvoidOption>;
  return isString(o.action) && isString(o.check) && isInt(o.dc, 0, 40) && isString(o.success) && isString(o.failure);
}

export function isEncounter(value: unknown): value is Encounter {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<Encounter>;
  return isString(e.id) && e.id.length > 0 && isString(e.name)
    && (e.notes === undefined || isString(e.notes))
    && (e.treasure === undefined || isString(e.treasure))
    && (e.environment === undefined || isString(e.environment))
    && (e.situation === undefined || isString(e.situation))
    && (e.read_aloud === undefined || isString(e.read_aloud))
    && (e.motivation === undefined || isString(e.motivation))
    && (e.dm_tactics === undefined || isString(e.dm_tactics))
    && (e.avoiding_combat === undefined || (Array.isArray(e.avoiding_combat) && e.avoiding_combat.every(isAvoidOption)))
    && Array.isArray(e.party_member_ids) && e.party_member_ids.every(isString)
    && Array.isArray(e.monsters) && e.monsters.every(m => !!m && isString(m.monster_id) && isString(m.monster_name)
      && isInt(m.count, 1, 99) && typeof m.group_initiative === "boolean")
    && isString(e.timestamp_created) && isString(e.timestamp_modified);
}

export function newPartyMember(): PartyMember {
  return { id: crypto.randomUUID(), name: "", level: 1, armor_class: 10, passive_perception: 10 };
}

export function newEncounter(): Encounter {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: "", party_member_ids: [], monsters: [], timestamp_created: now, timestamp_modified: now };
}
