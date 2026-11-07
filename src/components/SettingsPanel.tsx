import type { CoinRow, TreasureSettings } from "../lib/treasure";
import { COINS, rowProblem } from "../lib/treasure";
import { clampInt } from "../lib/format";

interface Props {
  settings: TreasureSettings;
  onChange: (s: TreasureSettings) => void;
}

/** The DM's own coin table, rolled for each defeated monster when a battle ends. */
export default function SettingsPanel({ settings, onChange }: Props) {
  const setRow = (id: string, patch: Partial<CoinRow>) => onChange({ ...settings, rows: settings.rows.map(r => r.id === id ? { ...r, ...patch } : r) });
  const addRow = () => {
    const last = settings.rows[settings.rows.length - 1];
    onChange({ ...settings, rows: [...settings.rows, { id: crypto.randomUUID(), min_cr: last ? last.max_cr : "0", max_cr: "", dice: "", multiplier: 1, coin: "GP" }] });
  };
  return <section className="panel settings">
    <h2>Treasure</h2>
    <p className="muted">When a battle ends, the app lists the gear from each defeated monster's stat block and the treasure you planned for the encounter.
      It can also roll coins for each monster from a table you enter here — for example the individual treasure table in your copy of the Dungeon Master's Guide.
      The SRD 5.2.1 doesn't include one, so the app doesn't ship one. Leave it empty to skip coins.</p>

    {settings.rows.length > 0 && <table className="coin-table">
      <thead><tr><th>CR from</th><th>CR to</th><th>Dice</th><th>× Multiplier</th><th>Coin</th><th /></tr></thead>
      <tbody>{settings.rows.map(r => {
        const problem = rowProblem(r);
        return <tr key={r.id}>
          <td><input aria-label="Lowest CR" value={r.min_cr} placeholder="0" onChange={e => setRow(r.id, { min_cr: e.target.value })} /></td>
          <td><input aria-label="Highest CR" value={r.max_cr} placeholder="4" onChange={e => setRow(r.id, { max_cr: e.target.value })} /></td>
          <td><input aria-label="Dice" value={r.dice} placeholder="3d6" onChange={e => setRow(r.id, { dice: e.target.value })} /></td>
          <td><input aria-label="Multiplier" type="number" min="1" value={r.multiplier} onChange={e => setRow(r.id, { multiplier: clampInt(e.target.value, 1, 100000, 1) })} /></td>
          <td><select aria-label="Coin" value={r.coin} onChange={e => setRow(r.id, { coin: e.target.value as CoinRow["coin"] })}>{COINS.map(c => <option key={c}>{c}</option>)}</select></td>
          <td><button type="button" className="small danger" aria-label="Remove row" onClick={() => onChange({ ...settings, rows: settings.rows.filter(x => x.id !== r.id) })}>×</button></td>
          {problem && <td className="row-problem warn-text small-text">{problem}</td>}
        </tr>;
      })}</tbody>
    </table>}
    <div className="actions-left">
      <button type="button" onClick={addRow}>+ Add a row</button>
    </div>
    <label className="check"><input type="checkbox" checked={settings.skip_mindless} onChange={e => onChange({ ...settings, skip_mindless: e.target.checked })} />
      No coins for Beasts, Plants and Oozes</label>
    <p className="muted small-text">Example row: CR 0 to 2, 2d4 × 1 GP (made-up values — use your own). Monsters whose CR fits no row get no coins. Saved in this browser.</p>
  </section>;
}
