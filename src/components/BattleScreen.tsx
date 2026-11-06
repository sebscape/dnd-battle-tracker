import { useState } from "react";
import type { Battle, Combatant } from "../models/combat";
import type { PartyMember } from "../models/battle";
import type { MonsterData } from "../lib/useMonsters";
import type { Advantage, DiceExpr } from "../lib/dice";
import { rollD20, rollDice } from "../lib/dice";
import * as rules from "../lib/combat";
import CombatantDetail from "./CombatantDetail";
import type { Roller } from "./CombatantDetail";
import AddCombatants from "./AddCombatants";
import NumberPrompt from "./NumberPrompt";
import type { PromptRequest } from "./NumberPrompt";

const PHYSICAL_KEY = "dnd-battle-tracker-physical-dice-v1";

interface Props {
  battle: Battle;
  canUndo: boolean;
  apply: (change: (b: Battle) => Battle) => void;
  undo: () => void;
  finish: () => void;
  party: PartyMember[];
  data: MonsterData;
}

export default function BattleScreen({ battle, canUndo, apply, undo, finish, party, data }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(battle.combatants.length === 0);
  const [physical, setPhysical] = useState(() => { try { return localStorage.getItem(PHYSICAL_KEY) === "1"; } catch { return false; } });
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  // Last chosen attack target for each attacker, kept while switching between combatants.
  const [targets, setTargets] = useState<Record<string, string>>({});

  const order = rules.turnOrder(battle);
  const selected = battle.combatants.find(c => c.id === (selectedId ?? battle.active_id)) ?? null;
  const missingInit = battle.combatants.filter(c => c.initiative === null);

  const ask = (title: string, min: number, max: number) => new Promise<number | null>(resolve =>
    setPrompt({ title, min, max, resolve: v => { setPrompt(null); resolve(v); } }));
  const roller: Roller = {
    async d20(title: string, bonus: number, mode: Advantage) {
      if (!physical) return rollD20(bonus, mode);
      const n = await ask(title + " — your d20" + (mode !== "normal" ? " (keeping the " + (mode === "advantage" ? "higher" : "lower") + ")" : ""), 1, 20);
      return n === null ? null : rollD20(bonus, mode, n);
    },
    async dice(title: string, expr: DiceExpr) {
      if (!physical) return rollDice(expr);
      const n = await ask(title + " — total of your " + expr.count + "d" + expr.sides, expr.count, expr.count * expr.sides);
      return n === null ? null : rollDice(expr, n);
    },
  };
  function togglePhysical(on: boolean) {
    setPhysical(on);
    try { localStorage.setItem(PHYSICAL_KEY, on ? "1" : "0"); } catch { /* preference only */ }
  }

  const activeName = battle.combatants.find(c => c.id === battle.active_id)?.name;
  return <div className="battle">
    <div className="battle-bar panel">
      <div>
        <h2>{battle.name}</h2>
        <p className="muted small-text">{battle.started ? "Round " + battle.round + (activeName ? " · " + activeName + "'s turn" : "") : "Setting up — enter initiative for each character"}</p>
      </div>
      <div className="battle-controls">
        {battle.started
          ? <button type="button" className="primary" onClick={() => { setSelectedId(null); apply(rules.nextTurn); }} disabled={!order.length}>Next turn ▸</button>
          : <button type="button" className="primary" disabled={!order.length || missingInit.length > 0} title={missingInit.length ? "Enter initiative for: " + missingInit.map(c => c.name).join(", ") : ""}
              onClick={() => { setSelectedId(null); apply(rules.begin); }}>Begin combat</button>}
        <button type="button" onClick={undo} disabled={!canUndo}>Undo</button>
        <button type="button" aria-pressed={showAdd} onClick={() => setShowAdd(!showAdd)}>{showAdd ? "Hide add" : "+ Add"}</button>
        <label className="check" title="Type in the results of real dice instead of letting the app roll"><input type="checkbox" checked={physical} onChange={e => togglePhysical(e.target.checked)} /> I roll physical dice</label>
        <button type="button" className="danger" onClick={() => { if (window.confirm("End this battle? It will be saved to battle history.")) finish(); }}>End battle</button>
      </div>
    </div>

    {!battle.started && missingInit.length > 0 && order.length > 0 && <p className="muted small-text">Waiting for initiative: {missingInit.map(c => c.name).join(", ")}.</p>}

    <div className="battle-layout">
      <section className="panel initiative" aria-label="Initiative order">
        <h2>Initiative</h2>
        {order.length === 0 && <p className="muted">No combatants yet. Use + Add.</p>}
        <ol className="turn-list">
          {order.map(c => <InitiativeRow key={c.id} c={c} active={c.id === battle.active_id} selected={c.id === selected?.id}
            onSelect={() => setSelectedId(c.id)} onInitiative={v => apply(b => rules.setInitiative(b, c.id, v))} />)}
        </ol>
      </section>

      <section className="panel detail">
        {showAdd && <AddCombatants battle={battle} party={party} monsters={[...data.published, ...data.custom]} apply={apply} onAdded={c => setSelectedId(c.id)} />}
        {selected
          ? <CombatantDetail key={selected.id} combatant={selected} started={battle.started} apply={apply} roller={roller}
              others={order.filter(o => o.id !== selected.id && !(o.kind === "monster" && o.out))}
              targetId={targets[selected.id] ?? ""} onTarget={id => setTargets(t => ({ ...t, [selected.id]: id }))}
              monster={selected.monster_id ? data.byId.get(selected.monster_id) : undefined}
              member={selected.party_member_id ? party.find(p => p.id === selected.party_member_id) : undefined}
              artwork={selected.monster_id ? data.artwork[selected.monster_id] : undefined} />
          : !showAdd && <p className="muted">Select a combatant to see their details.</p>}
      </section>

      <section className="panel log" aria-label="Combat log">
        <h2>Log</h2>
        <ol className="log-list">
          {[...battle.log].reverse().slice(0, 100).map(e => <li key={e.id}><span className="muted">{e.round ? "R" + e.round : "—"}</span> {e.text}</li>)}
        </ol>
      </section>
    </div>
    {prompt && <NumberPrompt request={prompt} />}
  </div>;
}

function InitiativeRow({ c, active, selected, onSelect, onInitiative }: { c: Combatant; active: boolean; selected: boolean; onSelect: () => void; onInitiative: (v: number | null) => void }) {
  const [text, setText] = useState(c.initiative === null ? "" : String(c.initiative));
  const [lastSeen, setLastSeen] = useState(c.initiative);
  if (c.initiative !== lastSeen) { setLastSeen(c.initiative); setText(c.initiative === null ? "" : String(c.initiative)); }
  const commit = () => {
    const v = text.trim() === "" ? null : Math.round(Number(text));
    if (v !== null && !Number.isFinite(v)) { setText(c.initiative === null ? "" : String(c.initiative)); return; }
    if (v !== c.initiative) onInitiative(v);
  };
  const hpPct = c.hp !== undefined && c.max_hp ? Math.max(0, Math.min(100, (c.hp / c.max_hp) * 100)) : null;
  return <li className={"turn " + (active ? "active " : "") + (selected ? "selected " : "") + (c.out ? "out " : "") + c.kind}>
    <input className="init-input" aria-label={"Initiative for " + c.name} type="number" inputMode="numeric" value={text} placeholder="—"
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} />
    <button type="button" className="turn-main" onClick={onSelect} aria-current={active ? "step" : undefined}>
      <span className="turn-name">{active && <span aria-hidden="true">▶ </span>}{c.name}{c.init_group ? <small> · group</small> : null}</span>
      <span className="turn-meta">
        AC {c.armor_class}
        {c.hp !== undefined && <> · {c.hp}/{c.max_hp} HP</>}
        {c.out && <> · {c.kind === "pc" ? "Down" : "Defeated"}</>}
      </span>
      {hpPct !== null && <span className="mini-hp" aria-hidden="true"><span style={{ width: hpPct + "%" }} className={hpPct <= 25 ? "low" : hpPct <= 50 ? "mid" : ""} /></span>}
      {c.conditions.length > 0 && <span className="turn-conditions">{c.conditions.map(x => x.name + (x.rounds !== null ? " (" + x.rounds + ")" : "")).join(", ")}</span>}
    </button>
  </li>;
}
