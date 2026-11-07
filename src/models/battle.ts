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

export interface Encounter {
  id: string;
  name: string;
  notes?: string;
  /** Loot the DM planned for this fight; shown when the battle ends. */
  treasure?: string;
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

export function isEncounter(value: unknown): value is Encounter {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<Encounter>;
  return isString(e.id) && e.id.length > 0 && isString(e.name)
    && (e.notes === undefined || isString(e.notes))
    && (e.treasure === undefined || isString(e.treasure))
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
