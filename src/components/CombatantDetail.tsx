import { useState } from "react";
import type { Battle, Combatant } from "../models/combat";
import { CONDITIONS } from "../models/combat";
import type { Monster, NamedFeature } from "../models/monster";
import type { PartyMember } from "../models/battle";
import type { Advantage, D20Roll, DiceExpr, DiceRoll } from "../lib/dice";
import { critical, describeD20, describeDice, formatDice, signed } from "../lib/dice";
import type { Ability, DamagePart, DamageType } from "../lib/statblock";
import { ABILITIES, DAMAGE_TYPES, adjustDamage, conditionImmunities, parseDamageTraits, parseFeature, saveBonus } from "../lib/statblock";
import * as rules from "../lib/combat";
import { describeEffect, describeRule, resistsAllDamage, rollEffects } from "../lib/effects";
import type { ActiveCondition, ConditionEffect } from "../models/combat";
import { clampInt } from "../lib/format";
import type { Prompt, Situational } from "../lib/traits";
import { situationalAdvantage } from "../lib/traits";

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
  /** Everyone else in the battle, for choosing an attack's target. */
  others: Combatant[];
  targetId: string;
  onTarget: (id: string) => void;
  /** Manual Advantage/Disadvantage for this combatant's next d20; null = automatic from conditions. */
  override: Advantage | null;
  onOverride: (mode: Advantage | null) => void;
  /** Everyone in the battle in turn order (for "caused by" and "whose turn"). */
  everyone: Combatant[];
  activeId: string | null;
  /** Stat-block situations the DM has said apply to this combatant's next roll (e.g. Pack Tactics). */
  situational: string[];
  onSituational: (keys: string[]) => void;
}

/** Result of the latest attack roll for one feature, used to suggest the next button. */
interface AttackOutcome { key: string; natural: number; total: number; hit: boolean | null }

const FEATURE_SECTIONS = [["traits", "Traits"], ["actions", "Actions"], ["bonus_actions", "Bonus Actions"], ["reactions", "Reactions"], ["legendary_actions", "Legendary Actions"]] as const;

export default function CombatantDetail({ combatant: c, monster, member, artwork, started, apply, roller, others, targetId, onTarget, override, onOverride,
  everyone, activeId, situational, onSituational }: Props) {
  const [lastRoll, setLastRoll] = useState("");
  const [outcome, setOutcome] = useState<AttackOutcome | null>(null);
  const target = others.find(o => o.id === targetId) ?? null;
  const nameOf = (id: string) => everyone.find(x => x.id === id)?.name;
  const isOn = (p: Prompt) => situational.includes(p.key);
  const extrasFrom = (s: Situational) => [...s.auto, ...s.prompts.filter(isOn).map(p => p.label)];
  const toggle = (key: string) => onSituational(situational.includes(key) ? situational.filter(k => k !== key) : [...situational, key]);
  // Stat-block rules that apply to all of its attacks (Pack Tactics, Bloodied frenzies…).
  const generalSit = situationalAdvantage(monster, c, target, "attack");
  const attackFx = rollEffects(c, target, "attack", undefined, { nameOf, extraAdvantage: extrasFrom(generalSit) });
  const saveExtras = situationalAdvantage(monster, c, null, "save").auto;

  async function rollD20(label: string, bonus: number, attackKey?: string, ability?: Ability, feature?: NamedFeature) {
    const isAttack = attackKey !== undefined;
    const extra = isAttack ? extrasFrom(feature ? situationalAdvantage(monster, c, target, "attack", feature) : generalSit) : saveExtras;
    const fx = rollEffects(c, isAttack ? target : null, isAttack ? "attack" : "save", ability, { nameOf, extraAdvantage: extra });
    const vs = isAttack && target ? " vs " + target.name + " (AC " + target.armor_class + ")" : "";
    if (fx.autoFail && override === null) {
      const text = c.name + " — " + label + ": automatically fails (" + fx.autoFail + ").";
      setLastRoll(text); setOutcome(null);
      apply(b => rules.withLog(b, text));
      return;
    }
    const mode = override ?? fx.mode;
    const why = override !== null ? (override === "normal" ? "" : " — " + override + ", chosen by you") : fx.summary ? " — " + fx.summary : "";
    const r = await roller.d20(c.name + ": " + label + vs, bonus, mode);
    if (!r) return;
    onOverride(null);
    onSituational([]);
    // A natural 20 always hits and is a critical hit; a natural 1 always misses.
    const hit = !isAttack ? null : r.natural === 20 ? true : r.natural === 1 ? false : target ? r.total >= target.armor_class : null;
    const nat = r.natural === 20 ? " — natural 20" + (isAttack ? ", a critical hit!" : "!") : r.natural === 1 ? " — natural 1" + (isAttack ? ", an automatic miss." : ".") : "";
    const verdict = isAttack && target && r.natural !== 20 && r.natural !== 1 ? (hit ? " — hit." : " — miss.") : "";
    const text = c.name + " — " + label + vs + ": " + r.total + " (" + describeD20(r) + why + ")" + nat + verdict;
    setLastRoll(text);
    setOutcome(isAttack ? { key: attackKey!, natural: r.natural, total: r.total, hit } : null);
    apply(b => rules.consumeConditions(rules.withLog(b, text), fx.consumed));
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
    const onTarget = outcome?.hit && target ? " " + target.name : "";
    const heading = c.name + " — " + (crit ? label.replace(/ hits$/, "") + " critical hit" + (onTarget ? " on" + onTarget : "") : label + onTarget);
    const text = parts.length === 1
      ? heading + ": " + results[0].replace(/^(\d+) (\w+)/, "$1 $2 damage")
      : heading + ": " + total + " damage — " + results.join(" + ");
    setLastRoll(text);
    setOutcome(null);
    apply(b => rules.withLog(b, text));
  }

  return <div className="combatant-detail">
    <div className="detail-head">
      {artwork && <img className="detail-art" src={artwork} alt="" />}
      <div className="grow">
        {c.party_member_id && member
          ? <label>Name<input value={c.name} readOnly title="Change the name on the Party tab" /></label>
          : <NameField key={c.id + c.name} name={c.name} onCommit={v => apply(b => rules.rename(b, c.id, v))} />}
        <p className="muted small-text">
          {monster ? monster.size + " " + monster.type + " · CR " + monster.challenge_rating : "Player character" + (member ? " · level " + member.level : "")}
          {" · AC " + c.armor_class}{member ? " · Passive Perception " + member.passive_perception : ""}
          {member && " · Name, level and AC come from the Party tab"}
        </p>
      </div>
      <button type="button" className="tiny danger remove-corner" title={"Take " + c.name + " out of this battle (Undo brings them back)"}
        onClick={() => { if (window.confirm("Remove " + c.name + " from the battle?")) apply(b => rules.removeCombatant(b, c.id)); }}>Remove</button>
    </div>

    {c.kind === "monster" && c.hp !== undefined && c.max_hp !== undefined && <HitPoints c={c} monster={monster} apply={apply} />}
    {c.conditions.some(x => describeRule(x.name).includes("can't take actions")) && <p className="warn-text small-text">{c.name} can't take actions or reactions ({c.conditions.filter(x => describeRule(x.name).includes("can't take actions")).map(x => x.name).join(", ")}).</p>}
    {c.kind === "pc" && member?.notes && <p className="muted">{member.notes}</p>}

    <div className="row-actions">
      <label className="check"><input type="checkbox" checked={c.out} onChange={e => { const v = e.target.checked; apply(b => rules.setOut(b, c.id, v)); }} />
        {c.kind === "pc" ? "Down (0 HP)" : "Defeated"}</label>
      {c.kind === "monster" && <button type="button" className="small" onClick={() => apply(b => rules.rerollInitiative(b, c.id))}>Reroll initiative{c.init_group ? " (group)" : ""}</button>}
    </div>

    {c.kind === "pc" && c.out && <DeathSaves c={c} apply={apply} />}

    <Conditions c={c} monster={monster} apply={apply} everyone={everyone} activeId={activeId} />

    {monster && <>
      <label className="target-pick">Target
        <select value={target ? target.id : ""} onChange={e => { onTarget(e.target.value); setOutcome(null); }}>
          <option value="">No target (compare with AC yourself)</option>
          {others.map(o => <option key={o.id} value={o.id}>{o.name} — AC {o.armor_class}{o.out ? (o.kind === "pc" ? " (down)" : " (defeated)") : ""}</option>)}
        </select>
      </label>
      <RollModeButtons fx={attackFx} override={override} onOverride={onOverride} />
      <SituationToggles prompts={generalSit.prompts} isOn={isOn} toggle={toggle} />
      <RollHints c={c} override={override} attackFx={attackFx} />
      {lastRoll && <p className="last-roll" role="status">{lastRoll}</p>}

      <h3>Saving throws</h3>
      <div className="save-buttons">
        {ABILITIES.map(a => {
          const bonus = saveBonus(monster, a);
          const fx = rollEffects(c, null, "save", a, { nameOf, extraAdvantage: saveExtras });
          const mark = override !== null ? "" : fx.autoFail ? " ✕" : fx.mode === "advantage" ? " ▲" : fx.mode === "disadvantage" ? " ▼" : "";
          const tip = a + " saving throw" + (fx.autoFail ? " — automatically fails (" + fx.autoFail + ")" : fx.summary ? " — " + fx.summary : "");
          return <button key={a} type="button" className={"small" + (mark ? " marked" : "")} title={tip} onClick={() => rollD20(a + " saving throw", bonus, undefined, a)}>
            {a.slice(0, 3).toUpperCase()} {signed(bonus)}{mark}</button>;
        })}
      </div>

      <StatSummary monster={monster} />

      {FEATURE_SECTIONS.map(([key, title]) => {
        const features = monster[key] ?? [];
        if (!features.length) return null;
        return <section key={key}>
          <h3>{title}</h3>
          {key === "legendary_actions" && monster.legendary_actions_intro && <p className="muted small-text">{monster.legendary_actions_intro}</p>}
          {features.map((f, i) => {
            const k = key + ":" + i;
            // Rules written into this attack only (beyond the general ones shown above).
            const own = situationalAdvantage(monster, c, target, "attack", f);
            const specific: Situational = { auto: own.auto.filter(x => !generalSit.auto.includes(x)), prompts: own.prompts.filter(p => !generalSit.prompts.some(g => g.key === p.key)) };
            return <Feature key={i} feature={f} outcome={outcome?.key === k ? outcome : null} specific={specific} isOn={isOn} toggle={toggle}
              onAttack={(label, bonus) => rollD20(label, bonus, k, undefined, f)} onDamage={rollDamage} />;
          })}
        </section>;
      })}
      {(monster.spellcasting?.length ?? 0) > 0 && <section><h3>Spellcasting</h3>{monster.spellcasting!.map((f, i) => <p key={i}><b>{f.name}.</b> {f.description}</p>)}</section>}
    </>}
    {!started && <p className="muted small-text">Set everyone's initiative, then press Begin combat.</p>}
  </div>;
}

interface FeatureProps {
  feature: NamedFeature;
  outcome: AttackOutcome | null;
  specific: Situational;
  isOn: (p: Prompt) => boolean;
  toggle: (key: string) => void;
  onAttack: (label: string, bonus: number) => void;
  onDamage: (label: string, parts: DamagePart[], crit: boolean) => void;
}

function Feature({ feature, outcome, specific, isOn, toggle, onAttack, onDamage }: FeatureProps) {
  const p = parseFeature(feature);
  const hasCrit = !!p.attack?.damage.some(d => d.dice);
  // Which damage button to point at after an attack roll. Nothing is disabled: the DM can always override.
  const nat20 = outcome?.natural === 20, missed = outcome?.hit === false;
  const suggest: "damage" | "critical" | "none" | null = !outcome ? null : missed ? "none" : nat20 && hasCrit ? "critical" : "damage";
  const cls = (which: "damage" | "critical") => "small" + (suggest === null ? "" : suggest === which ? " suggested" : " dimmed");
  const note = !outcome ? "" : nat20 ? (hasCrit ? "Natural 20 — a critical hit. Roll Critical damage." : "Natural 20 — a critical hit (fixed damage doesn't change).")
    : outcome.natural === 1 ? "Natural 1 — an automatic miss. No damage."
    : outcome.hit === true ? "Hit — roll Damage." : missed ? "Miss — no damage."
    : "Compare " + outcome.total + " with the target's AC. If it's equal or higher, roll Damage.";
  const dmgLabel = (parts: DamagePart[]) => parts.map(d => d.dice ? formatDice(d.dice) : String(d.average)).join(" + ") + " " + [...new Set(parts.map(d => d.type))].join("/");
  return <div className="feature">
    <p><b>{feature.name}.</b> {feature.description}</p>
    {(p.attack || p.save) && <div className="feature-rolls">
      {p.attack && <>
        <button type="button" className="small" title="Roll to hit: d20 + bonus, compared with the target's AC" onClick={() => onAttack(feature.name + " attack roll", p.attack!.bonus)}>Attack {signed(p.attack.bonus)}</button>
        {p.attack.damage.length > 0 && <>
          <button type="button" className={cls("damage")} title="Damage on a hit" onClick={() => onDamage(feature.name + " hits", p.attack!.damage, false)}>Damage {dmgLabel(p.attack.damage)}</button>
          {hasCrit && <button type="button" className={cls("critical")} title="On a natural 20: the damage dice are rolled twice" onClick={() => onDamage(feature.name + " hits", p.attack!.damage, true)}>Critical damage</button>}
        </>}
      </>}
      {p.save && <>
        <span className="badge">DC {p.save.dc} {p.save.ability} save{p.save.halfOnSuccess ? ", half on success" : ""}</span>
        {p.save.failureDamage.length > 0 && <button type="button" className="small" title="Damage to a creature that fails the save" onClick={() => onDamage(feature.name + " (failed save)", p.save!.failureDamage, false)}>Damage {dmgLabel(p.save.failureDamage)}</button>}
      </>}
    </div>}
    {p.attack && specific.auto.map(a => <p key={a} className="roll-note">Advantage on this attack — {a.replace(feature.name + ": ", "")}.</p>)}
    {p.attack && <SituationToggles prompts={specific.prompts} isOn={isOn} toggle={toggle} />}
    {note && <p className="roll-note" role="status">{note}</p>}
  </div>;
}

/** One-click switches for stat-block Advantage the app can't judge (positions, unknown HP). Used for the next roll only. */
function SituationToggles({ prompts, isOn, toggle }: { prompts: Prompt[]; isOn: (p: Prompt) => boolean; toggle: (key: string) => void }) {
  if (!prompts.length) return null;
  return <div className="situations">
    {prompts.map(p => <div key={p.key} className="situation">
      <button type="button" className={"small toggle" + (isOn(p) ? " on" : "")} aria-pressed={isOn(p)} onClick={() => toggle(p.key)}>
        {isOn(p) ? "✓ " : ""}{p.label} applies</button>
      <span className="small-text muted">{p.note}{isOn(p) ? " Counted for the next roll." : ""}</span>
    </div>)}
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
  const base = monster && valid ? adjustDamage(monster, n, type) : null;
  // Petrified creatures resist all damage, on top of the stat block (resistance doesn't stack).
  const petrified = base && resistsAllDamage(c) && base.amount > 0 && !base.note.includes("resistant")
    ? { amount: Math.floor(base.amount / 2), note: (base.note ? base.note + ", " : "") + "Petrified: resistant to all damage" } : null;
  const calc = petrified ?? base;
  const typed = calc && (type || calc.note) ? calc : null;
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
      {typed.note ? n + (type ? " " + type : "") + " → " + typed.amount + " (" + typed.note + ")" : "No resistance to " + type + "."}
      {typed.note && <label className="check inline"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> Ignore (apply full {n})</label>}
    </p>}
    {unclear && <p className="small-text warn-text">This stat block has a resistance or immunity the app can't apply automatically — check it before applying damage.</p>}
  </div>;
}

const EFFECT_OPTIONS: { value: string; label: string; effect: ConditionEffect | null }[] = [
  { value: "", label: "No effect on rolls", effect: null },
  { value: "dis-attacks", label: "Disadvantage on its attack rolls", effect: { mode: "disadvantage", on: "attacks" } },
  { value: "dis-saves", label: "Disadvantage on its saving throws", effect: { mode: "disadvantage", on: "saves" } },
  { value: "dis-all", label: "Disadvantage on all its d20 rolls", effect: { mode: "disadvantage", on: "all" } },
  { value: "adv-attacks", label: "Advantage on its attack rolls", effect: { mode: "advantage", on: "attacks" } },
  { value: "adv-saves", label: "Advantage on its saving throws", effect: { mode: "advantage", on: "saves" } },
  { value: "adv-all", label: "Advantage on all its d20 rolls", effect: { mode: "advantage", on: "all" } },
  { value: "adv-against", label: "Attacks against it have Advantage", effect: { mode: "advantage", on: "attacks_against" } },
  { value: "dis-against", label: "Attacks against it have Disadvantage", effect: { mode: "disadvantage", on: "attacks_against" } },
];

type DurationChoice = "until_removed" | "rounds" | "start" | "end";

function Conditions({ c, monster, apply, everyone, activeId }: { c: Combatant; monster?: Monster; apply: Props["apply"]; everyone: Combatant[]; activeId: string | null }) {
  const [name, setName] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [effectKey, setEffectKey] = useState("");
  const [nextOnly, setNextOnly] = useState(false);
  const [sourceSel, setSourceSel] = useState<string | null>(null);
  const [durationType, setDurationType] = useState<DurationChoice>("until_removed");
  const [rounds, setRounds] = useState("1");
  const [whoseSel, setWhoseSel] = useState<string | null>(null);
  const nameOf = (id: string) => everyone.find(x => x.id === id)?.name ?? "?";
  // Defaults: caused by whoever's turn it is (usually the caster or grappler), timed by that creature's turn.
  const source = sourceSel ?? (activeId && activeId !== c.id ? activeId : "");
  const whose = whoseSel ?? (source || activeId || c.id);
  const effect = name === "__custom" ? EFFECT_OPTIONS.find(o => o.value === effectKey)?.effect ?? undefined : undefined;
  const reset = () => { setName(""); setCustom(""); setEffectKey(""); setNextOnly(false); setSourceSel(null); setDurationType("until_removed"); setRounds("1"); setWhoseSel(null); };
  const chosen = name === "__custom" ? custom.trim() : name;
  const immune = monster ? conditionImmunities(monster).some(x => x.toLowerCase() === chosen.toLowerCase()) : false;
  const n = clampInt(rounds, 1, 999, 1);
  const duration: rules.Duration = durationType === "rounds" ? { type: "rounds", rounds: n }
    : durationType === "start" || durationType === "end" ? { type: "turn", when: durationType, of: whose } : { type: "until_removed" };
  const roundsFrom = activeId ?? c.id;
  const explain = durationType === "rounds" ? "Ends when " + nameOf(roundsFrom) + "'s turn comes around " + (n === 1 ? "again" : n + " times") + " (" + n + " round" + (n === 1 ? "" : "s") + ")."
    : durationType === "start" ? "Ends at the start of " + nameOf(whose) + "'s next turn."
    : durationType === "end" ? "Ends at the end of " + nameOf(whose) + "'s next turn." : "";
  const timingOf = (cond: ActiveCondition) => rules.describeTiming(cond, nameOf);
  const byOf = (cond: ActiveCondition) => cond.source_id && cond.source_id !== c.id ? (everyone.find(x => x.id === cond.source_id)?.name ?? cond.source_name) : null;

  return <div className="conditions">
    <h3>Conditions</h3>
    {c.conditions.length === 0 && <p className="muted small-text">No conditions.</p>}
    <div className="chips">{c.conditions.map(cond => {
      const by = byOf(cond);
      const tip = [cond.effect ? describeEffect(cond.effect, cond.next_roll_only) : describeRule(cond.name), by ? "Caused by " + by : "", rules.describeTiming(cond, nameOf, true)].filter(Boolean).join(" · ");
      return <span key={cond.id} className="chip" title={tip}>
        {cond.name}{by ? " (" + by + ")" : ""}
        {cond.effect ? " · " + (cond.effect.mode === "advantage" ? "Adv" : "Dis") + (cond.effect.on === "attacks_against" ? " vs it" : "") + (cond.next_roll_only ? ", next roll" : "") : ""}
        {timingOf(cond) ? " · " + timingOf(cond) : ""}
        {cond.next_roll_only && <button type="button" className="chip-used" title="A player used it on their own roll — remove it" onClick={() => apply(b => rules.consumeConditions(b, [{ combatantId: c.id, condition: cond }]))}>Used</button>}
        <button type="button" aria-label={"Remove " + cond.name} onClick={() => apply(b => rules.removeCondition(b, c.id, cond.id))}>×</button>
      </span>;
    })}</div>
    <form className="condition-add" onSubmit={e => {
      e.preventDefault();
      if (!chosen) return;
      apply(b => rules.addCondition(b, c.id, chosen, { effect, nextRollOnly: nextOnly, sourceId: source || undefined, duration }));
      reset();
    }}>
      <label>Add a condition<select value={name} onChange={e => setName(e.target.value)}>
        <option value="">Choose a condition…</option>
        {CONDITIONS.map(x => <option key={x} value={x}>{x}</option>)}<option value="__custom">Other…</option></select></label>
      {name === "__custom" && <label>Name<input value={custom} placeholder="e.g. Guiding Bolt" onChange={e => setCustom(e.target.value)} /></label>}
      {name === "__custom" && <label className="effect-pick">Effect on rolls<select value={effectKey} onChange={e => setEffectKey(e.target.value)}>
        {EFFECT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
      {name === "__custom" && effect && <label className="check"><input type="checkbox" checked={nextOnly} onChange={e => setNextOnly(e.target.checked)} /> Next roll only</label>}
      {name && <label className="wide">Caused by<select value={source} onChange={e => setSourceSel(e.target.value)}>
        <option value="">— (no one / not tracked)</option>
        {everyone.filter(x => x.id !== c.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      {name && <label className="wide">Lasts<select value={durationType} onChange={e => setDurationType(e.target.value as DurationChoice)}>
        <option value="until_removed">Until removed</option>
        <option value="rounds">A number of rounds</option>
        <option value="start">Until the start of a turn</option>
        <option value="end">Until the end of a turn</option></select></label>}
      {name && durationType === "rounds" && <label className="narrow">Rounds<input type="number" min="1" value={rounds} onChange={e => setRounds(e.target.value)} /></label>}
      {name && (durationType === "start" || durationType === "end") && <label className="wide">Whose next turn<select value={whose} onChange={e => setWhoseSel(e.target.value)}>
        {everyone.map(x => <option key={x.id} value={x.id}>{x.name}{x.id === c.id ? " (this one)" : ""}</option>)}</select></label>}
      <button type="submit" className="small" disabled={!chosen}>Add</button>
    </form>
    {explain && <p className="small-text muted">{explain}</p>}
    {name && name !== "__custom" && describeRule(name) && <p className="small-text muted">{describeRule(name)}</p>}
    {name === "Grappled" && <p className="small-text muted">With "Caused by" set, the app applies Disadvantage when it attacks anyone other than its grappler, and Advantage for attacks like the Bugbear's Light Hammer.</p>}
    {name === "__custom" && effect && nextOnly && <p className="small-text muted">Removed after the first app roll it affects{durationType !== "until_removed" ? ", or when its time runs out" : ""}. If a player uses it on their own roll, click Used on its tag.</p>}
    {immune && <p className="small-text warn-text">{c.name} is immune to {chosen}.</p>}
  </div>;
}

/** Name input that saves on Enter or when focus leaves, so typing doesn't create an undo step per letter. */
function NameField({ name, onCommit }: { name: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(name);
  const commit = () => { const v = value.trim(); if (v && v !== name) onCommit(v); else setValue(name); };
  return <label>Name<input value={value} onChange={e => setValue(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} /></label>;
}

/** What will happen to this combatant's next rolls, and why. */
function RollHints({ c, override, attackFx }: { c: Combatant; override: Advantage | null; attackFx: ReturnType<typeof rollEffects> }) {
  if (override !== null) return <p className="roll-hint small-text">Next d20: <b>{MODE_LABEL[override]}</b>, chosen by you for one roll{attackFx.mode !== override ? " (conditions say " + MODE_LABEL[attackFx.mode] + ")" : ""}.</p>;
  const lines: string[] = [];
  if (attackFx.summary) lines.push("Attack rolls: " + attackFx.summary);
  const dex = rollEffects(c, null, "save", "Dexterity"), str = rollEffects(c, null, "save", "Strength"), wis = rollEffects(c, null, "save", "Wisdom");
  if (str.autoFail) lines.push("Strength and Dexterity saves: automatic failure (" + str.autoFail + ")");
  else if (dex.summary && dex.summary !== wis.summary) lines.push("Dexterity saves: " + dex.summary);
  if (wis.summary) lines.push((str.autoFail ? "Other saving throws: " : "Saving throws: ") + wis.summary);
  if (!lines.length && !attackFx.reminders.length) return null;
  return <div className="roll-hint small-text">
    {lines.map((l, i) => <p key={i}>{l}</p>)}
    {attackFx.reminders.map((r, i) => <p key={"r" + i} className="warn-text">{r}</p>)}
  </div>;
}

const MODE_LABEL: Record<Advantage, string> = { normal: "Normal", advantage: "Advantage", disadvantage: "Disadvantage" };

/** Why conditions lead to a mode, for the highlighted button's tooltip. */
function modeReason(fx: ReturnType<typeof rollEffects>): string {
  const adv = fx.reasons.filter(r => r.startsWith("Advantage: ")).map(r => r.slice(11));
  const dis = fx.reasons.filter(r => r.startsWith("Disadvantage: ")).map(r => r.slice(14));
  const list = (xs: string[]) => xs.map(x => x[0].toUpperCase() + x.slice(1)).join("; ");
  if (fx.mode === "advantage") return "Advantage on attack rolls — " + list(adv);
  if (fx.mode === "disadvantage") return "Disadvantage on attack rolls — " + list(dis);
  if (adv.length && dis.length) return "Normal: Advantage (" + adv.join(", ") + ") and Disadvantage (" + dis.join(", ") + ") cancel out";
  return "Normal: no conditions affect attack rolls";
}

/**
 * Next d20: the mode the conditions call for is highlighted (with the reason on hover);
 * the others are dimmed but clickable to override it for one roll. Clicking the
 * condition-based choice again goes back to automatic.
 */
function RollModeButtons({ fx, override, onOverride }: { fx: ReturnType<typeof rollEffects>; override: Advantage | null; onOverride: (m: Advantage | null) => void }) {
  const active = override ?? fx.mode;
  const reason = modeReason(fx);
  return <div className="roll-mode" role="group" aria-label="Next d20 roll">
    <span className="muted small-text">Next d20:</span>
    {(["normal", "advantage", "disadvantage"] as const).map(m => {
      const isActive = m === active;
      const title = isActive
        ? (override === null ? reason : MODE_LABEL[m] + " — chosen by you for the next roll. " + (m === fx.mode ? "" : "Click " + MODE_LABEL[fx.mode] + " to go back to what the conditions say (" + reason + ")."))
        : m === fx.mode ? "Go back to what the conditions say: " + reason
        : "Use " + MODE_LABEL[m] + " instead for the next roll";
      return <button key={m} type="button" className={"small " + (isActive ? "selected" : "dimmed") + (isActive && override !== null && m !== fx.mode ? " manual" : "")}
        aria-pressed={isActive} title={title} onClick={() => onOverride(m === fx.mode ? null : m)}>{MODE_LABEL[m]}</button>;
    })}
  </div>;
}

/** Three success and three failure boxes. Clicking box n sets the count to n (or back to n − 1). */
function DeathSaves({ c, apply }: { c: Combatant; apply: Props["apply"] }) {
  const ds = c.death_saves ?? { successes: 0, failures: 0 };
  const set = (s: number, f: number) => apply(b => rules.setDeathSaves(b, c.id, s, f));
  const row = (kind: "successes" | "failures", label: string, mark: string) => <div className="ds-row" role="group" aria-label={label}>
    <span className="ds-label">{label}</span>
    {[1, 2, 3].map(n => {
      const on = ds[kind] >= n;
      const next = on && ds[kind] === n ? n - 1 : n;
      return <button key={n} type="button" className={"ds-box " + kind + (on ? " on" : "")} aria-pressed={on} aria-label={label + " " + n}
        onClick={() => kind === "successes" ? set(next, ds.failures) : set(ds.successes, next)}>{on ? mark : ""}</button>;
    })}
  </div>;
  const status = ds.failures >= 3 ? "Dead." : ds.successes >= 3 ? "Stable at 0 HP." : "";
  return <div className="death-save-panel">
    <h3>Death saves</h3>
    {row("successes", "Successes", "✓")}
    {row("failures", "Failures", "✗")}
    {status && <p className={ds.failures >= 3 ? "warn-text" : "muted"}>{status}</p>}
    <p className="muted small-text">The player rolls a d20 at the start of their turn: 10 or higher is a success, 9 or lower a failure. A natural 20 means they regain 1 HP (untick Down); a natural 1 counts as two failures. Taking damage while down is a failure (two on a critical hit).</p>
  </div>;
}
