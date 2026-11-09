import { useState } from "react";
import type { Battle, Combatant } from "../models/combat";
import type { PartyMember } from "../models/battle";
import type { Monster } from "../models/monster";
import * as rules from "../lib/combat";
import { clampInt } from "../lib/format";
import MonsterPicker from "./MonsterPicker";

interface Props {
  artwork?: Record<string, string>;
  battle: Battle;
  party: PartyMember[];
  monsters: Monster[];
  apply: (change: (b: Battle) => Battle) => void;
  onAdded: (c: Combatant) => void;
  onDone: () => void;
}

/** Adds monsters, party members or one-off characters to a battle, including mid-fight. */
export default function AddCombatants({ battle, party, monsters, artwork, apply, onAdded, onDone }: Props) {
  const [count, setCount] = useState("1");
  const [group, setGroup] = useState(false);
  const [pcName, setPcName] = useState("");
  const [pcAc, setPcAc] = useState("10");
  const [pcInit, setPcInit] = useState("");
  const inBattle = new Set(battle.combatants.map(c => c.party_member_id).filter(Boolean));
  const available = party.filter(p => !inBattle.has(p.id));

  function add(list: Combatant[]) {
    if (!list.length) return;
    apply(b => rules.addCombatants(b, list));
    onAdded(list[0]);
  }
  const n = clampInt(count, 1, 20, 1);

  return <div className="add-combatants">
    <div className="panel-heading add-heading">
      <h3>Add to battle</h3>
      <button type="button" className="small primary" onClick={onDone}>Done</button>
    </div>
    {available.length > 0 && <div className="add-row">
      <span className="muted small-text">Party:</span>
      {available.map(p => <button key={p.id} type="button" className="small" onClick={() => add([rules.pcCombatant(p)])}>+ {p.name || "Unnamed"}</button>)}
    </div>}
    <form className="add-row" onSubmit={e => {
      e.preventDefault();
      if (!pcName.trim()) return;
      const known = pcInit.trim() !== "";
      add([{ ...rules.pcCombatant({ id: "", name: pcName.trim(), level: 1, armor_class: clampInt(pcAc, 0, 50, 10), passive_perception: 10 }), party_member_id: undefined,
        initiative_bonus: known ? clampInt(pcInit, -10, 30, 0) : 0, initiative_bonus_known: known }]);
      setPcName(""); setPcInit("");
    }}>
      <label className="grow">Other character or ally<input value={pcName} placeholder="Name" onChange={e => setPcName(e.target.value)} /></label>
      <label>AC<input type="number" min="0" max="50" value={pcAc} onChange={e => setPcAc(e.target.value)} /></label>
      <label>Init. bonus<input type="number" min="-10" max="30" placeholder="Not set" value={pcInit} onChange={e => setPcInit(e.target.value)} /></label>
      <button type="submit" className="small" disabled={!pcName.trim()}>Add</button>
    </form>
    <div className="add-row">
      <label>Monsters per add<input type="number" min="1" max="20" value={count} onChange={e => setCount(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={group} disabled={n < 2} onChange={e => setGroup(e.target.checked)} /> Group initiative</label>
    </div>
    <MonsterPicker monsters={monsters} artwork={artwork} onAdd={m => add(rules.monsterCombatants(m, n, group && n > 1, battle.combatants))} />
  </div>;
}
