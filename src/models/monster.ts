// Copied from dnd-monster-reference src/models/monster.ts (schema 1.2.0). Keep in sync.
export type SourceType = "official_srd" | "third_party" | "homebrew";
export interface NamedFeature { name: string; description: string; }
export interface Abilities { str: number; dex: number; con: number; int: number; wis: number; cha: number; }
export interface Monster {
  id: string; name: string; size: string; type: string; alignment?: string;
  challenge_rating: string; proficiency_bonus?: number;
  armor_class: number; armor_description?: string; hit_points: number; hit_dice?: string;
  initiative_bonus: number; speed?: string; abilities?: Abilities;
  saving_throws?: string; skills?: string; damage_vulnerabilities?: string;
  damage_resistances?: string; damage_immunities?: string;
  condition_immunities?: string; senses?: string; languages?: string;
  gear?: string; legendary_actions_intro?: string;
  traits?: NamedFeature[]; actions?: NamedFeature[]; bonus_actions?: NamedFeature[];
  reactions?: NamedFeature[]; legendary_actions?: NamedFeature[];
  spellcasting?: NamedFeature[]; tags: string[];
  source: { type: SourceType; name: string; reference?: string; license?: string };
  derived_from?: { monster_id: string };
  timestamp_created: string; timestamp_modified: string;
}
export interface MonsterCatalog { schema_version: string; catalog_version?: string; monsters: Monster[]; }
export const SCHEMA_VERSION = "1.2.0";
export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export function newMonster(base?: Monster): Monster {
  const now = new Date().toISOString();
  const cloned = base ? structuredClone(base) : {};
  return {
    size: "Medium", type: "Beast", challenge_rating: "0",
    armor_class: 10, hit_points: 1, initiative_bonus: 0, speed: "30 ft.",
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    traits: [], actions: [], bonus_actions: [], reactions: [], legendary_actions: [],
    spellcasting: [], tags: [], ...cloned,
    id: crypto.randomUUID(),
    name: base ? base.name + " (Custom)" : "",
    source: { type: "homebrew", name: "Custom" },
    ...(base ? { derived_from: { monster_id: base.id } } : {}),
    timestamp_created: now, timestamp_modified: now
  };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isMonster(value: unknown): value is Monster {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<Monster>;
  return typeof m.id === "string" && uuid.test(m.id)
    && typeof m.name === "string" && m.name.trim().length > 0
    && typeof m.size === "string" && typeof m.type === "string"
    && typeof m.challenge_rating === "string"
    && Number.isFinite(m.armor_class) && Number.isFinite(m.hit_points)
    && Number.isFinite(m.initiative_bonus)
    && Array.isArray(m.tags) && m.tags.every(t => typeof t === "string")
    && !!m.source && ["homebrew", "official_srd", "third_party"].includes(m.source.type)
    && typeof m.source.name === "string"
    && typeof m.timestamp_created === "string" && typeof m.timestamp_modified === "string"
    && (m.gear === undefined || typeof m.gear === "string")
    && (m.legendary_actions_intro === undefined || typeof m.legendary_actions_intro === "string")
    && (!m.abilities || ABILITY_KEYS.every(k => Number.isFinite(m.abilities?.[k])))
    && (["traits", "actions", "bonus_actions", "reactions", "legendary_actions", "spellcasting"] as const)
      .every(k => !m[k] || (Array.isArray(m[k]) && m[k].every(f => typeof f.name === "string" && typeof f.description === "string")));
}
