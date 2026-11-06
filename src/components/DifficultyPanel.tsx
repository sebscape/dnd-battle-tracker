import type { Difficulty, Rating } from "../lib/difficulty";
import { crKey } from "../lib/difficulty";

const LABEL: Record<Rating, string> = { none: "No monsters yet", low: "Low", moderate: "Moderate", high: "High", beyond: "Beyond High" };
const fmt = (n: number) => n.toLocaleString("en-US");
const crNum = (cr: string) => cr.includes("/") ? 1 / Number(cr.split("/")[1]) : Number(cr);

export default function DifficultyPanel({ difficulty, partySize }: { difficulty: Difficulty | null; partySize: number }) {
  if (!difficulty) return <div className="difficulty"><p className="muted">Select party members to see the encounter's difficulty.</p></div>;
  const { totalXp, budget, rating, maxAdditionalCr, averageLevel, warnings } = difficulty;
  const scale = Math.max(budget.high * 1.2, totalXp);
  const pct = (n: number) => Math.min(100, (n / scale) * 100) + "%";
  const key = maxAdditionalCr && crKey(maxAdditionalCr);

  return <div className="difficulty">
    <div className="difficulty-head">
      <span><span className={"rating " + rating}>{LABEL[rating]}</span> <span className="muted">{fmt(totalXp)} XP for {partySize} character{partySize === 1 ? "" : "s"}</span></span>
      <span className="muted small-text">Budgets: Low {fmt(budget.low)} · Moderate {fmt(budget.moderate)} · High {fmt(budget.high)}</span>
    </div>
    <div className="xp-bar" role="img" aria-label={fmt(totalXp) + " XP of a " + fmt(budget.high) + " XP High budget"}>
      <div className={"xp-fill " + rating} style={{ width: pct(totalXp) }} />
      {(["low", "moderate", "high"] as const).map(k => <span key={k} className="xp-mark" style={{ left: pct(budget[k]) }} title={LABEL[k] + ": " + fmt(budget[k]) + " XP"} />)}
    </div>
    <p className="small-text">
      {maxAdditionalCr === null
        ? <>The High budget is used up; adding more monsters makes this encounter harder than High.</>
        : <>Largest monster you can still add and stay within High: <strong>CR {maxAdditionalCr}</strong>
          {key && crNum(key) > averageLevel && <span className="muted"> (above the party's average level of {averageLevel}, so a monster that strong may be able to take out a character in one action)</span>}</>}
    </p>
    {warnings.length > 0 && <ul className="warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
  </div>;
}
