import type { Monster, NamedFeature } from "../models/monster";
import { ABILITY_KEYS } from "../models/monster";

// Read-only copy of the Monster Reference app's detail view (src/App.tsx `Detail`,
// src/MonsterArtwork.tsx), without the artwork editing, download and monster editing buttons, and
// without the AI image-prompt description.
// Keep the sections in step with that app.
const FEATURE_KEYS = ["traits", "actions", "bonus_actions", "reactions", "legendary_actions", "spellcasting"] as const;
const TEXT_KEYS = ["alignment", "armor_description", "hit_dice", "saving_throws", "skills", "damage_vulnerabilities", "damage_resistances", "damage_immunities", "condition_immunities", "senses", "languages", "gear", "legendary_actions_intro"] as const;
const titleCase = (s: string) => s.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const modifier = (n: number) => { const m = Math.floor((n - 10) / 2); return (m >= 0 ? "+" : "") + m; };

const SPELL_FREQUENCY = /(?=At Will:|\b\d+\/Day(?: Each)?:)/g;
function FeatureDescription({ feature }: { feature: NamedFeature }) {
  if (feature.name !== "Spellcasting") return <>{feature.description}</>;
  const parts = feature.description.split(SPELL_FREQUENCY).filter(Boolean);
  if (parts.length < 2) return <>{feature.description}</>;
  return <>{parts.map((part, i) => <span key={i} className="spell-line">{part.trim()}</span>)}</>;
}

export default function MonsterDetails({ monster, artwork }: { monster: Monster; artwork?: string }) {
  const custom = monster.source.type === "homebrew";
  return <div className="monster-details" aria-label={monster.name + " details"}>
    <div className="md-top">
      <div className="md-art">{artwork
        ? <img src={artwork} alt={monster.name + " artwork"} />
        : <span className="muted small-text">No artwork</span>}</div>
      <div className="md-summary">
        <p>{monster.size} {monster.type} · CR {monster.challenge_rating} · {custom ? "Custom" : "Published"}</p>
        <div className="md-stats"><span>AC <b>{monster.armor_class}</b></span><span>HP <b>{monster.hit_points}</b></span><span>Initiative <b>{monster.initiative_bonus >= 0 ? "+" : ""}{monster.initiative_bonus}</b></span></div>
        {monster.speed && <p><b>Speed:</b> {monster.speed}</p>}
        {monster.abilities && <div className="md-abilities">{ABILITY_KEYS.map(k => <div key={k}><b>{k.toUpperCase()}</b><span>{monster.abilities![k]} ({modifier(monster.abilities![k])})</span></div>)}</div>}
      </div>
    </div>
    {TEXT_KEYS.map(k => monster[k] ? <p key={k}><b>{titleCase(k)}:</b> {monster[k]}</p> : null)}
    {FEATURE_KEYS.map(k => (monster[k]?.length ?? 0) > 0 && <section key={k}><h4>{titleCase(k)}</h4>{monster[k]?.map((f, i) => <p key={i}><b>{f.name}.</b> <FeatureDescription feature={f} /></p>)}</section>)}
    <p><b>Tags:</b> {monster.tags.join(", ") || "None"}</p><p><b>Source:</b> {monster.source.name}</p>
    <p className="muted small-text">UUID: {monster.id}</p>
  </div>;
}
