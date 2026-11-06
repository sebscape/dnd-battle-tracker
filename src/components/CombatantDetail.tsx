import { useState } from "react";
import type { Battle, Combatant } from "../models/combat";
import { CONDITIONS } from "../models/combat";
import type { Monster, NamedFeature } from "../models/monster";
import type { PartyMember } from "../models/battle";
import type { Advantage, D20Roll, DiceExpr, DiceRoll } from "../lib/dice";
import { critical, describeD20, describeDice, formatDice, signed } from "../lib/dice";
import type { DamagePart, DamageType } from "../lib/statblock";
import { ABILITIES, DAMAGE_TYPES, adjustDamage, conditionImmunities, parseDamageTraits, parseFeature, saveBonus } from "../lib/statblock";
import * as rules from "../lib/combat";
import { clampInt } from "../lib/format";

export interface Roller {
  d20: (title: string, bonus: number, mode: Advantage) => Promise<D20Roll | null>;
  dice: (title: string, expr: DiceExpr) => Promise<DiceRoll | null>;
}

interface Props {
  combatant: Combatant;
  monster?: Monster;
  member?: PartyMember;
  artwork?: string;
  started: boolean;
  apply: (change: (b: Battle) => Battle) => void;
  roller: Roller;
}

const FEATURE_SECTIONS = [["traits", "Traits"], ["actions", "Actions"], ["bonus_actions", "Bonus Actions"], ["reactions", "Reactions"], ["legendary_actions", "Legendary Actions"]] as const;

export default function CombatantDetail({ combatant: c, monster, member, artwork, started, apply, roller }: Props) {
  const [lastRoll, setLastRoll] = useState("");
  const [mode, setMode] = useState<Advantage>("normal");

  async function rollD20(label: string, bonus: number, isAttack = false) {
    const r = await roller.d20(c.name + ": " + label, bonus, mode);
    if (!r) return;
    setMode("normal");
    const nat = r.natural === 20 ? " — natural 20" + (isAttack ? ", a critical hit!" : "!") : r.natural === 1 ? " — natural 1" + (isAttack ? ", an automatic miss." : ".") : "";
    const text = c.name + " — " + label + ": " + r.total + " (" + describeD20(r) + ")" + nat;
    setLastRoll(text);
    apply(b => rules.withLog(b, text));
  }
  async function rollDamage(label: string, parts: DamagePart[], crit: boolean) {
    const results: string[] = [];
    let total = 0;
    for (const p of parts) {
      if (!p.dice) { total += p.average; results.push(p.average + " " + p.type + " (fixed, no roll)"); continue; }
      const expr = crit ? critical(p.dice) : p.dice;
      const r = await roller.dice(c.name + ": " + label + " — " + formatDice(expr) + " " + p.type, expr);
      if (!r) return;
      total += r.total;
      results.push(r.total + " " + p.type + " (" + describeDice(r) + ")");
    }
    const heading = c.name + " — " + (crit ? label.replace(/ hits$/, "") + " critical hit" : label);
    const text = parts.length === 1
      ? heading + ": " + results[0].replace(/^(\d+) (\w+)/, "$1 $2 damage")
      : heading + ": " + total + " damage — " + results.join(" + ");
    setLastRoll(text);
    apply(b => rules.withLog(b, text));
  }

  return <div className="combatant-detail">
    <div className="detail-head">
      {artwork && <img className="detail-art" src={artwork} alt="" />}
      <div className="grow">
        <NameField key={c.id + c.name} name={c.name} onCommit={v => apply(b => rules.rename(b, c.id, v))} />
        <p className="muted small-text">
          {monster ? monster.size + " " + monster.type + " · CR " + monster.challenge_rating : "Player character" + (member ? " · level " + member.level : "")}
          {" · AC " + c.armor_class}{member ? " · Passive Perception " + member.passive_perception : ""}
        </p>
      </div>
    </div>

    {c.kind === "monster" && c.hp !== undefined && c.max_hp !== undefined && <HitPoints c={c} monster={monster} apply={apply} />}
    {c.kind === "pc" && member?.notes && <p className="muted">{member.notes}</p>}

    <div className="row-actions">
      <label className="check"><input type="checkbox" checked={c.out} onChange={e => { const v = e.target.checked; apply(b => rules.setOut(b, c.id, v)); }} />
        {c.kind === "pc" ? "Down (0 HP)" : "Defeated"}</label>
      {c.kind === "monster" && <button type="button" className="small" onClick={() => apply(b => rules.rerollInitiative(b, c.id))}>Reroll initiative{c.init_group ? " (group)" : ""}</button>}
      <button type="button" className="small danger" onClick={() => { if (window.confirm("Remove " + c.name + " from the battle?")) apply(b => rules.removeCombatant(b, c.id)); }}>Remove</button>
    </div>

    <Conditions c={c} monster={monster} apply={apply} />

    {monster && <>
      <div className="roll-mode" role="group" aria-label="Next d20 roll">
        <span className="muted small-text">Next d20:</span>
        {(["normal", "advantage", "disadvantage"] as const).map(m => <button key={m} type="button" className={"small " + (mode === m ? "selected" : "")} aria-pressed={mode === m} onClick={() => setMode(m)}>
          {m === "normal" ? "Normal" : m === "advantage" ? "Advantage" : "Disadvantage"}</button>)}
      </div>
      {lastRoll && <p className="last-roll" role="status">{lastRoll}</p>}

      <h3>Saving throws</h3>
      <div className="save-buttons">
        {ABILITIES.map(a => { const bonus = saveBonus(monster, a); return <button key={a} type="button" className="small" title={a + " saving throw"} onClick={() => rollD20(a + " saving throw", bonus)}>
          {a.slice(0, 3).toUpperCase()} {signed(bonus)}</button>; })}
      </div>

      <StatSummary monster={monster} />

      {FEATURE_SECTIONS.map(([key, title]) => {
        const features = monster[key] ?? [];
        if (!features.length) return null;
        return <section key={key}>
          <h3>{title}</h3>
          {key === "legendary_actions" && monster.legendary_actions_intro && <p className="muted small-text">{monster.legendary_actions_intro}</p>}
          {features.map((f, i) => <Feature key={i} feature={f} onAttack={(label, bonus) => rollD20(label, bonus, true)} onDamage={rollDamage} />)}
        </section>;
      })}
      {(monster.spellcasting?.length ?? 0) > 0 && <section><h3>Spellcasting</h3>{monster.spellcasting!.map((f, i) => <p key={i}><b>{f.name}.</b> {f.description}</p>)}</section>}
    </>}
    {!started && <p className="muted small-text">Set everyone's initiative, then press Begin combat.</p>}
  </div>;
}

function Feature({ feature, onAttack, onDamage }: { feature: NamedFeature; onAttack: (label: string, bonus: number) => void; onDamage: (label: string, parts: DamagePart[], crit: boolean) => void }) {
  const p = parseFeature(feature);
  const dmgLabel = (parts: DamagePart[]) => parts.map(d => d.dice ? formatDice(d.dice) : String(d.average)).join(" + ") + " " + [...new Set(parts.map(d => d.type))].join("/");
  return <div className="feature">
    <p><b>{feature.name}.</b> {feature.description}</p>
    {(p.attack || p.save) && <div className="feature-rolls">
      {p.attack && <>
        <button type="button" className="small" title="Roll to hit: d20 + bonus, compared with the target's AC" onClick={() => onAttack(feature.name + " attack roll", p.attack!.bonus)}>Attack {signed(p.attack.bonus)}</button>
        {p.attack.damage.length > 0 && <>
          <button type="button" className="small" title="Damage on a hit" onClick={() => onDamage(feature.name + " hits", p.attack!.damage, false)}>Damage {dmgLabel(p.attack.damage)}</button>
          {p.attack.damage.some(d => d.dice) && <button type="button" className="small" title="On a natural 20: the damage dice are rolled twice" onClick={() => onDamage(feature.name + " hits", p.attack!.damage, true)}>Critical damage</button>}
        </>}
      </>}
      {p.save && <>
        <span className="badge">DC {p.save.dc} {p.save.ability} save{p.save.halfOnSuccess ? ", half on success" : ""}</span>
        {p.save.failureDamage.length > 0 && <button type="button" className="small" title="Damage to a creature that fails the save" onClick={() => onDamage(feature.name + " (failed save)", p.save!.failureDamage, false)}>Damage {dmgLabel(p.save.failureDamage)}</button>}
      </>}
    </div>}
  </div>;
}

function StatSummary({ monster: m }: { monster: Monster }) {
  const rows: [string, string | undefined][] = [["Speed", m.speed], ["Senses", m.senses], ["Vulnerabilities", m.damage_vulnerabilities],
    ["Resistances", m.damage_resistances], ["Immunities", [m.damage_immunities, m.condition_immunities].filter(Boolean).join("; ") || undefined], ["Languages", m.languages]];
  return <dl className="stat-summary">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function HitPoints({ c, monster, apply }: { c: Combatant; monster?: Monster; apply: Props["apply"] }) {
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<DamageType | "">("");
  const [override, setOverride] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hpText, setHpText] = useState(String(c.hp));
  const [maxText, setMaxText] = useState(String(c.max_hp));
  const n = Math.round(Number(amount));
  const valid = amount.trim() !== "" && Number.isFinite(n) && n > 0;
  const typed = monster && valid && type ? adjustDamage(monster, n, type) : null;
  const adjusted = typed && !override ? typed : { amount: n, note: "" };
  const unclear = monster ? [monster.damage_resistances, monster.damage_immunities, monster.damage_vulnerabilities].some(t => parseDamageTraits(t).unclear) : false;
  const pct = Math.max(0, Math.min(100, (c.hp! / c.max_hp!) * 100));

  return <div className="hp-block">
    <div className="hp-line">
      <span className="hp-number"><b>{c.hp}</b> / {c.max_hp} HP</span>
      <button type="button" className="small link" onClick={() => { setHpText(String(c.hp)); setMaxText(String(c.max_hp)); setEditing(!editing); }}>{editing ? "Close" : "Edit HP"}</button>
    </div>
    <div className="hp-bar" aria-hidden="true"><div style={{ width: pct + "%" }} className={pct <= 25 ? "low" : pct <= 50 ? "mid" : ""} /></div>
    {editing && <form className="hp-edit" onSubmit={e => { e.preventDefault(); apply(b => rules.setHitPoints(b, c.id, clampInt(hpText, 0, 9999, c.hp!), clampInt(maxText, 1, 9999, c.max_hp!))); setEditing(false); }}>
      <label>Current<input type="number" min="0" value={hpText} onChange={e => setHpText(e.target.value)} /></label>
      <label>Maximum<input type="number" min="1" value={maxText} onChange={e => setMaxText(e.target.value)} /></label>
      <button type="submit" className="small">Set</button>
    </form>}
    <form className="hp-change" onSubmit={e => e.preventDefault()}>
      <label>Amount<input type="number" min="1" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>Damage type<select value={type} onChange={e => setType(e.target.value as DamageType | "")}>
        <option value="">Untyped</option>{DAMAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      <button type="button" className="danger" disabled={!valid} onClick={() => { const a = adjusted; apply(b => rules.damage(b, c.id, a.amount, a.note)); setAmount(""); }}>
        Damage{valid && adjusted.amount !== n ? " " + adjusted.amount : ""}</button>
      <button type="button" disabled={!valid} onClick={() => { apply(b => rules.heal(b, c.id, n)); setAmount(""); }}>Heal</button>
    </form>
    {typed && <p className="small-text muted">
      {typed.note ? n + " " + type + " → " + typed.amount + " (" + typed.note + ")" : "No resistance to " + type + "."}
      {typed.note && <label className="check inline"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> Ignore (apply full {n})</label>}
    </p>}
    {unclear && <p className="small-text warn-text">This stat block has a resistance or immunity the app can't apply automatically — check it before applying damage.</p>}
  </div>;
}

function Conditions({ c, monster, apply }: { c: Combatant; monster?: Monster; apply: Props["apply"] }) {
  const [name, setName] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [rounds, setRounds] = useState("");
  const chosen = name === "__custom" ? custom.trim() : name;
  const immune = monster ? conditionImmunities(monster).some(x => x.toLowerCase() === chosen.toLowerCase()) : false;
  return <div className="conditions">
    <h3>Conditions</h3>
    {c.conditions.length === 0 && <p className="muted small-text">No conditions.</p>}
    <div className="chips">{c.conditions.map(cond => <span key={cond.id} className="chip">
      {cond.name}{cond.rounds !== null ? " · " + cond.rounds + " rd" : ""}
      <button type="button" aria-label={"Remove " + cond.name} onClick={() => apply(b => rules.removeCondition(b, c.id, cond.id))}>×</button>
    </span>)}</div>
    <form className="condition-add" onSubmit={e => { e.preventDefault(); if (!chosen) return; const r = rounds.trim() ? clampInt(rounds, 1, 999, 1) : null; apply(b => rules.addCondition(b, c.id, chosen, r)); setName(""); setRounds(""); setCustom(""); }}>
      <label>Add a condition<select value={name} onChange={e => setName(e.target.value)}>
        <option value="">Choose a condition…</option>
        {CONDITIONS.map(x => <option key={x} value={x}>{x}</option>)}<option value="__custom">Other…</option></select></label>
      {name === "__custom" && <label>Name<input value={custom} placeholder="e.g. Hasted" onChange={e => setCustom(e.target.value)} /></label>}
      <label>Rounds<input type="number" min="1" value={rounds} placeholder="Until removed" onChange={e => setRounds(e.target.value)} /></label>
      <button type="submit" className="small" disabled={!chosen}>Add</button>
    </form>
    {immune && <p className="small-text warn-text">{c.name} is immune to {chosen}.</p>}
  </div>;
}

/** Name input that saves on Enter or when focus leaves, so typing doesn't create an undo step per letter. */
function NameField({ name, onCommit }: { name: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(name);
  const commit = () => { const v = value.trim(); if (v && v !== name) onCommit(v); else setValue(name); };
  return <label>Name<input value={value} onChange={e => setValue(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} /></label>;
}
