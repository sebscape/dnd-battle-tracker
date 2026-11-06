import type { PartyMember } from "../models/battle";
import { newPartyMember } from "../models/battle";
import { clampInt } from "../lib/format";

interface Props {
  party: PartyMember[];
  onChange: (party: PartyMember[]) => void;
}

export default function PartyRoster({ party, onChange }: Props) {
  const update = (id: string, patch: Partial<PartyMember>) => onChange(party.map(p => p.id === id ? { ...p, ...patch } : p));
  const remove = (member: PartyMember) => {
    if (window.confirm("Remove " + (member.name || "this character") + " from the party?")) onChange(party.filter(p => p.id !== member.id));
  };
  return <section className="panel">
    <div className="panel-heading">
      <div><h2>Party</h2><p className="muted">Saved once and reused in every encounter. Players track their own hit points.</p></div>
      <button type="button" onClick={() => onChange([...party, newPartyMember()])}>+ Add character</button>
    </div>
    {party.length === 0 && <p className="muted">No characters yet. Add your players' characters to use them in encounters.</p>}
    <div className="party-list">
      {party.map((p, i) => <fieldset key={p.id} className="party-member">
        <legend className="sr-only">Character {i + 1}</legend>
        <label className="grow">Name<input value={p.name} placeholder="Character name" onChange={e => update(p.id, { name: e.target.value })} /></label>
        <label>Level<input type="number" min="1" max="20" value={p.level} onChange={e => update(p.id, { level: clampInt(e.target.value, 1, 20, p.level) })} /></label>
        <label>AC<input type="number" min="0" max="50" value={p.armor_class} onChange={e => update(p.id, { armor_class: clampInt(e.target.value, 0, 50, p.armor_class) })} /></label>
        <label title="Initiative bonus (usually the Dexterity modifier). Leave empty until the player tells you.">Init. bonus<input type="number" min="-10" max="30" placeholder="Not set" value={p.initiative_bonus ?? ""}
          onChange={e => update(p.id, { initiative_bonus: e.target.value.trim() === "" ? undefined : clampInt(e.target.value, -10, 30, p.initiative_bonus ?? 0) })} /></label>
        <label title="Passive Perception">Passive Perc.<input type="number" min="0" max="50" value={p.passive_perception} onChange={e => update(p.id, { passive_perception: clampInt(e.target.value, 0, 50, p.passive_perception) })} /></label>
        <label className="full">Notes<input value={p.notes ?? ""} placeholder="Class, player name, anything useful" onChange={e => update(p.id, { notes: e.target.value || undefined })} /></label>
        <button type="button" className="danger small" onClick={() => remove(p)}>Remove</button>
      </fieldset>)}
    </div>
  </section>;
}
