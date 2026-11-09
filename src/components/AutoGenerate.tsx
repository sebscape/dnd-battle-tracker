import { useState } from "react";
import type { Encounter, EncounterMonster } from "../models/battle";
import type { Monster } from "../models/monster";
import type { Difficulty, Environment, Kinds } from "../lib/generate";
import { ENVIRONMENTS, candidatePool, generateEncounter, suggestedMaxCr } from "../lib/generate";
import { crValue } from "../lib/format";

interface Props {
  encounter: Encounter;
  levels: number[];
  monsters: Monster[];
  onChange: (patch: Partial<Encounter>) => void;
}

const CR_CHOICES = ["1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];

/** Builds a random encounter for the selected party; pressing Auto generate again rolls a new set. */
export default function AutoGenerate({ encounter, levels, monsters, onChange }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>("moderate");
  const [kinds, setKinds] = useState<Kinds>("any");
  const [maxCrChoice, setMaxCrChoice] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [previous, setPrevious] = useState<EncounterMonster[] | null>(null);
  const environment = (encounter.environment ?? "") as Environment | "";
  const suggested = suggestedMaxCr(levels);
  const maxCr = maxCrChoice ?? String(suggested);
  const poolSize = candidatePool({ pool: monsters, environment, maxCr: crValue(maxCr) }).length;

  function generate() {
    const r = generateEncounter({ pool: monsters, levels, environment, difficulty, maxCr: crValue(maxCr), kinds });
    if ("error" in r) { setMessage(r.error); return; }
    setPrevious(encounter.monsters);
    onChange({ monsters: r.picks.map(p => ({ monster_id: p.monster.id, monster_name: p.monster.name, count: p.count, group_initiative: false })) });
    setMessage("Generated " + r.totalXp.toLocaleString("en-US") + " XP of monsters for a " + difficulty + " encounter (budget " + r.target.toLocaleString("en-US") + " XP). Press Auto generate again for a different set.");
  }

  return <fieldset className="auto-generate">
    <legend>Auto generate</legend>
    <div className="auto-fields">
      <label>Environment<select value={environment} onChange={e => onChange({ environment: e.target.value || undefined })}>
        <option value="">Any environment</option>
        {ENVIRONMENTS.map(env => <option key={env} value={env}>{env}</option>)}</select></label>
      <label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}>
        <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
      <label title="The strongest monster allowed. Suggested: the party's average level — higher CRs can drop a character in one action.">
        Max CR per monster
        <span className="cr-pick">
          <select value={maxCr} onChange={e => setMaxCrChoice(e.target.value === String(suggested) ? null : e.target.value)}>
            {CR_CHOICES.map(cr => <option key={cr} value={cr}>{cr}{cr === String(suggested) ? " (recommended)" : ""}</option>)}
          </select>
          <button type="button" className="small" disabled={maxCrChoice === null} onClick={() => setMaxCrChoice(null)} title={"Back to the recommended CR " + suggested}>Reset</button>
        </span>
      </label>
      <label>Monster kinds<select value={kinds} onChange={e => setKinds(e.target.value as Kinds)}>
        <option value="any">Any</option><option value="one">One kind (a pack)</option><option value="two">Two kinds (leader + followers)</option></select></label>
    </div>
    <div className="auto-actions">
      <button type="button" className="primary" disabled={!levels.length || !poolSize} onClick={generate}>Auto generate</button>
      {previous && <button type="button" className="small" onClick={() => { onChange({ monsters: previous }); setPrevious(null); setMessage("Previous monsters restored."); }}>Undo</button>}
      <span className="muted small-text">
        {!levels.length ? "Select party members above first — the encounter is sized to them."
          : poolSize + " monster" + (poolSize === 1 ? "" : "s") + (environment ? " in " + environment : "") + " at CR " + maxCr + " or lower. Replaces the monsters in this encounter."}
      </span>
    </div>
    {message && <p className="small-text" role="status">{message}</p>}
  </fieldset>;
}
