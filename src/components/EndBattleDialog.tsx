import { useEffect, useRef, useState } from "react";
import type { Battle, LootItem } from "../models/combat";
import type { Monster } from "../models/monster";
import type { TreasureSettings } from "../lib/treasure";
import { findLoot } from "../lib/treasure";

interface Props {
  battle: Battle;
  byId: Map<string, Monster>;
  settings: TreasureSettings;
  /** loot undefined = ended without searching. */
  onFinish: (loot?: LootItem[]) => void;
  onCancel: () => void;
}

/** Ending a battle: optionally search the defeated monsters, then save the battle to history. */
export default function EndBattleDialog({ battle, byId, settings, onFinish, onCancel }: Props) {
  const [items, setItems] = useState<LootItem[]>(() => findLoot(battle, byId, settings));
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const defeated = battle.combatants.filter(c => c.kind === "monster" && c.out);
  const sources = [...new Set(items.map(i => i.source))];
  const empty = defeated.filter(c => !items.some(i => i.source === c.name));
  const hasCoinTable = settings.rows.length > 0;
  const toggle = (id: string, taken: boolean) => setItems(list => list.map(i => i.id === id ? { ...i, taken } : i));

  return <div className="modal-backdrop" onClick={onCancel}>
    <div className="modal wide-modal" role="dialog" aria-modal="true" aria-label="End battle" onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === "Escape") onCancel(); }}>
      <h2>End battle</h2>
      {defeated.length > 0 || battle.treasure_note
        ? <>
          <p className="muted small-text">If the party searches the defeated monsters, this is what they find. Untick anything they leave behind. It's saved with the battle in history.</p>
          {sources.map(src => <fieldset key={src} className="loot-group">
            <legend>{src}</legend>
            {items.filter(i => i.source === src).map(i => <label key={i.id} className="check">
              <input type="checkbox" checked={i.taken} onChange={e => toggle(i.id, e.target.checked)} /> {i.text}
            </label>)}
          </fieldset>)}
          {empty.length > 0 && <p className="muted small-text">Nothing listed for: {empty.map(c => c.name).join(", ")}.</p>}
          {!hasCoinTable && <p className="muted small-text">No coins are rolled: the SRD has no treasure table. You can enter your own coin table on the Settings tab.</p>}
          {hasCoinTable && <button type="button" className="small" onClick={() => setItems(findLoot(battle, byId, settings))}>Roll coins again</button>}
        </>
        : <p className="muted">No monsters were defeated, so there's nothing to search.</p>}
      <div className="actions">
        <button type="button" onClick={onCancel}>Back to the battle</button>
        <span className="actions-right">
          <button type="button" onClick={() => onFinish()}>End without searching</button>
          <button ref={first} type="button" className="primary" onClick={() => onFinish(items)} disabled={!items.length}>Search and end battle</button>
        </span>
      </div>
    </div>
  </div>;
}
