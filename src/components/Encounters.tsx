import { useState } from "react";
import type { Encounter, EncounterMonster, PartyMember } from "../models/battle";
import { newEncounter } from "../models/battle";
import type { Monster } from "../models/monster";
import type { MonsterData } from "../lib/useMonsters";
import { isCustom } from "../lib/format";
import MonsterPicker from "./MonsterPicker";
import MonsterDetails from "./MonsterDetails";
import AutoGenerate from "./AutoGenerate";
import DifficultyPanel from "./DifficultyPanel";
import { encounterDifficulty, monsterXp } from "../lib/difficulty";

const xpText = (cr: string, count: number) => {
  const xp = monsterXp(cr);
  return xp === null ? "" : " · " + (xp * count).toLocaleString("en-US") + " XP" + (count > 1 ? " (" + xp.toLocaleString("en-US") + " each)" : "");
};

interface Props {
  encounters: Encounter[];
  onChange: (encounters: Encounter[]) => void;
  party: PartyMember[];
  data: MonsterData;
  onStartBattle: (encounter: Encounter) => void;
}

const monsterTotal = (e: Encounter) => e.monsters.reduce((n, m) => n + m.count, 0);

export default function Encounters({ encounters, onChange, party, data, onStartBattle }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = encounters.find(e => e.id === selectedId) ?? null;

  function update(encounter: Encounter) {
    const stamped = { ...encounter, timestamp_modified: new Date().toISOString() };
    onChange(encounters.map(e => e.id === stamped.id ? stamped : e));
  }
  function create() {
    // New encounters include the whole party by default.
    const e = { ...newEncounter(), name: "Encounter " + (encounters.length + 1), party_member_ids: party.map(p => p.id) };
    onChange([...encounters, e]);
    setSelectedId(e.id);
  }
  function duplicate(e: Encounter) {
    const now = new Date().toISOString();
    const copy = { ...structuredClone(e), id: crypto.randomUUID(), name: e.name + " (copy)", timestamp_created: now, timestamp_modified: now };
    onChange([...encounters, copy]);
    setSelectedId(copy.id);
  }
  function remove(e: Encounter) {
    if (!window.confirm("Delete " + (e.name || "this encounter") + "?")) return;
    onChange(encounters.filter(x => x.id !== e.id));
    setSelectedId(null);
  }

  const sorted = [...encounters].sort((a, b) => b.timestamp_modified.localeCompare(a.timestamp_modified));
  return <div className="layout">
    <section className="panel list">
      <div className="panel-heading"><h2>Encounters</h2><button type="button" onClick={create}>+ New</button></div>
      {sorted.length === 0 && <p className="muted">No saved encounters. Create one to plan a fight ahead of time.</p>}
      {sorted.map(e => <button key={e.id} type="button" className={"list-item " + (e.id === selectedId ? "active" : "")} onClick={() => setSelectedId(e.id)}>
        <strong>{e.name || "Untitled encounter"}</strong>
        <small>{monsterTotal(e)} monster{monsterTotal(e) === 1 ? "" : "s"} · {e.party_member_ids.length} PC{e.party_member_ids.length === 1 ? "" : "s"}{e.environment ? " · " + e.environment : ""}</small>
      </button>)}
    </section>
    <section className="panel detail">
      {selected
        ? <EncounterEditor key={selected.id} encounter={selected} party={party} data={data} onChange={update} onDuplicate={() => duplicate(selected)} onDelete={() => remove(selected)} onStart={() => onStartBattle(selected)} />
        : <p className="muted">Select an encounter to edit it, or create a new one.</p>}
    </section>
  </div>;
}

interface EditorProps {
  encounter: Encounter;
  party: PartyMember[];
  data: MonsterData;
  onChange: (e: Encounter) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onStart: () => void;
}

function EncounterEditor({ encounter, party, data, onChange, onDuplicate, onDelete, onStart }: EditorProps) {
  // One monster's details open at a time, in either list: "encounter:<id>" or "picker:<id>".
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (key: string) => setExpanded(k => k === key ? null : key);
  const set = (patch: Partial<Encounter>) => onChange({ ...encounter, ...patch });
  const setMonster = (index: number, patch: Partial<EncounterMonster>) =>
    set({ monsters: encounter.monsters.map((m, i) => i === index ? { ...m, ...patch } : m) });

  function addMonster(m: Monster) {
    const existing = encounter.monsters.findIndex(x => x.monster_id === m.id);
    if (existing >= 0) setMonster(existing, { count: Math.min(99, encounter.monsters[existing].count + 1) });
    else set({ monsters: [...encounter.monsters, { monster_id: m.id, monster_name: m.name, count: 1, group_initiative: false }] });
  }
  function togglePartyMember(id: string, on: boolean) {
    set({ party_member_ids: on ? [...encounter.party_member_ids, id] : encounter.party_member_ids.filter(x => x !== id) });
  }

  // Party members that were deleted from the roster are ignored.
  const missingPcs = encounter.party_member_ids.filter(id => !party.some(p => p.id === id)).length;
  const allMonsters = [...data.published, ...data.custom];
  const presentPcs = party.filter(p => encounter.party_member_ids.includes(p.id));
  const difficulty = encounterDifficulty(
    presentPcs.map(p => p.level),
    encounter.monsters.flatMap(em => { const m = data.byId.get(em.monster_id); return m ? [{ name: m.name, cr: m.challenge_rating, count: em.count }] : []; }));

  return <div className="editor">
    <label>Encounter name<input value={encounter.name} onChange={e => set({ name: e.target.value })} /></label>
    <label>Notes<textarea value={encounter.notes ?? ""} placeholder="Location, tactics…" onChange={e => set({ notes: e.target.value || undefined })} /></label>
    <label>Treasure<textarea value={encounter.treasure ?? ""} placeholder="What the party can find, e.g. Bugbear's pouch: 14 GP and a silver locket" onChange={e => set({ treasure: e.target.value || undefined })} /></label>

    <h3>Party</h3>
    {party.length === 0
      ? <p className="muted">No characters in the party roster yet. Add them on the Party tab.</p>
      : <div className="checks">{party.map(p => <label key={p.id} className="check">
          <input type="checkbox" checked={encounter.party_member_ids.includes(p.id)} onChange={e => togglePartyMember(p.id, e.target.checked)} />
          {p.name || "Unnamed character"} <small className="muted">(level {p.level})</small>
        </label>)}</div>}
    {missingPcs > 0 && <p className="muted small-text">{missingPcs} character{missingPcs === 1 ? " is" : "s are"} no longer in the party roster and will be skipped.</p>}

    <h3>Monsters</h3>
    <AutoGenerate encounter={encounter} levels={presentPcs.map(p => p.level)} monsters={allMonsters} onChange={set} />
    {encounter.monsters.length === 0 && <p className="muted">No monsters yet. Auto generate some, or search below to add them.</p>}
    <ul className="encounter-monsters">
      {encounter.monsters.map((em, i) => {
        const m = data.byId.get(em.monster_id);
        const unavailable = !m && !data.loading && data.bridge !== "connecting";
        const open = !!m && expanded === "encounter:" + m.id;
        const summary = m ? m.size + " " + m.type + " · CR " + m.challenge_rating + xpText(m.challenge_rating, em.count) + (isCustom(m) ? " · Custom" : "") : unavailable ? "Unavailable: custom monster not found in Critter Codex" : "Loading…";
        return <li key={em.monster_id} className={(unavailable ? "unavailable" : "") + (open ? " expanded" : "")}>
          {m
            ? <button type="button" className="monster-toggle em-name" aria-expanded={open} title={open ? "Hide details" : "Show details"} onClick={() => toggle("encounter:" + m.id)}>
                <strong>{m.name}</strong><small>{summary}</small>
              </button>
            : <div className="em-name"><strong>{em.monster_name}</strong><small>{summary}</small></div>}
          <div className="stepper" role="group" aria-label={"Number of " + em.monster_name}>
            <button type="button" className="small" aria-label="One fewer" disabled={em.count <= 1} onClick={() => setMonster(i, { count: em.count - 1 })}>−</button>
            <span aria-live="polite">{em.count}</span>
            <button type="button" className="small" aria-label="One more" disabled={em.count >= 99} onClick={() => setMonster(i, { count: em.count + 1 })}>+</button>
          </div>
          <label className="check" title="All copies act on one shared initiative roll">
            <input type="checkbox" checked={em.group_initiative} disabled={em.count < 2} onChange={e => setMonster(i, { group_initiative: e.target.checked })} /> Group initiative
          </label>
          <button type="button" className="danger small" onClick={() => set({ monsters: encounter.monsters.filter((_, j) => j !== i) })}>Remove</button>
          {open && <MonsterDetails monster={m} artwork={data.artwork[m.id]} />}
        </li>;
      })}
    </ul>

    <DifficultyPanel difficulty={difficulty} partySize={presentPcs.length} />

    <MonsterPicker monsters={allMonsters} onAdd={addMonster} artwork={data.artwork}
      expandedId={expanded?.startsWith("picker:") ? expanded.slice(7) : null} onToggle={id => toggle("picker:" + id)} />

    <div className="actions">
      <button type="button" className="primary" disabled={data.loading || (encounter.monsters.length === 0 && encounter.party_member_ids.length === 0)} onClick={onStart}>Start battle ▸</button>
      <span className="actions-right">
        <button type="button" onClick={onDuplicate}>Duplicate</button>
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
      </span>
    </div>
    <p className="muted small-text">Changes save automatically.</p>
  </div>;
}
