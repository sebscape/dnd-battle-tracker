import { useMemo, useState } from "react";
import type { Monster } from "../models/monster";
import { crValue, isCustom } from "../lib/format";
import { monsterXp } from "../lib/difficulty";

interface Props {
  monsters: Monster[];
  onAdd: (monster: Monster) => void;
}

const MAX_RESULTS = 40;

export default function MonsterPicker({ monsters, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [minCr, setMinCr] = useState("");
  const [maxCr, setMaxCr] = useState("");
  const matches = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const lo = minCr ? crValue(minCr) : NaN, hi = maxCr ? crValue(maxCr) : NaN;
    return monsters.filter(m => {
      if (source === "published" && isCustom(m)) return false;
      if (source === "custom" && !isCustom(m)) return false;
      const cr = crValue(m.challenge_rating);
      if (!Number.isNaN(lo) && !(cr >= lo)) return false;
      if (!Number.isNaN(hi) && !(cr <= hi)) return false;
      const text = (m.name + " " + m.type + " " + m.size + " " + m.tags.join(" ")).toLocaleLowerCase();
      return words.every(w => text.includes(w));
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [monsters, query, source, minCr, maxCr]);

  return <div className="picker">
    <h3>Add monsters</h3>
    <div className="picker-filters">
      <label className="grow">Search<input value={query} placeholder="Name, type, tag…" onChange={e => setQuery(e.target.value)} /></label>
      <label>Source<select value={source} onChange={e => setSource(e.target.value)}><option value="all">All</option><option value="published">Published</option><option value="custom">Custom</option></select></label>
      <label>Min CR<input value={minCr} placeholder="e.g. 1/4" onChange={e => setMinCr(e.target.value)} /></label>
      <label>Max CR<input value={maxCr} placeholder="e.g. 5" onChange={e => setMaxCr(e.target.value)} /></label>
    </div>
    <p className="muted small-text" role="status">{matches.length} match{matches.length === 1 ? "" : "es"}{matches.length > MAX_RESULTS ? " — showing the first " + MAX_RESULTS + ", refine your search to see more" : ""}</p>
    <ul className="picker-results">
      {matches.slice(0, MAX_RESULTS).map(m => <li key={m.id}>
        <span><strong>{m.name}</strong><small>{m.size} {m.type} · CR {m.challenge_rating}{monsterXp(m.challenge_rating) !== null ? " (" + monsterXp(m.challenge_rating)!.toLocaleString("en-US") + " XP)" : ""} · HP {m.hit_points} · AC {m.armor_class}{isCustom(m) ? " · Custom" : ""}</small></span>
        <button type="button" className="small" onClick={() => onAdd(m)} aria-label={"Add " + m.name}>Add</button>
      </li>)}
    </ul>
  </div>;
}
