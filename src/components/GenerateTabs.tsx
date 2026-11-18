import { useRef, useState } from "react";
import type { Encounter, PartyMember } from "../models/battle";
import type { Monster } from "../models/monster";
import AutoGenerate from "./AutoGenerate";
import AiGenerate from "./AiGenerate";

interface Props {
  encounter: Encounter;
  party: PartyMember[];
  monsters: Monster[];
  byId: ReadonlyMap<string, Monster>;
  artwork?: Record<string, string>;
  catalogReady: boolean;
  onChange: (patch: Partial<Encounter>) => void;
}

const TABS = [{ id: "search", label: "Auto Search" }, { id: "ai", label: "AI" }] as const;
type TabId = typeof TABS[number]["id"];
const TAB_KEY = "dnd-battle-tracker-generate-tab-v1";
const loadTab = (): TabId => { try { return localStorage.getItem(TAB_KEY) === "ai" ? "ai" : "search"; } catch { return "search"; } };

/**
 * The "Auto Generate" section: Auto Search (random monsters from the catalog) and AI
 * (Generate with AI $). Both panels stay mounted while hidden, so switching tabs never
 * loses a setting, an AI result under review, or a request in progress.
 */
export default function GenerateTabs({ encounter, party, monsters, byId, artwork, catalogReady, onChange }: Props) {
  const [tab, setTab] = useState<TabId>(loadTab);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const choose = (id: TabId, focus = false) => {
    setTab(id);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* remembered for this visit only */ }
    if (focus) buttons.current[id]?.focus();
  };
  const onKey = (e: { key: string; preventDefault: () => void }) => {
    const i = TABS.findIndex(t => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length
      : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(TABS[next].id, true);
  };
  const id = (t: string) => "gen-" + t + "-" + encounter.id;

  return <div className="gen-tabs">
    <div className="gen-tablist" role="tablist" aria-label="Auto Generate" onKeyDown={onKey}>
      {TABS.map(t => <button key={t.id} type="button" role="tab" id={id(t.id) + "-tab"} aria-controls={id(t.id)} aria-selected={tab === t.id}
        tabIndex={tab === t.id ? 0 : -1} ref={(el: HTMLButtonElement | null) => { buttons.current[t.id] = el; }} className="gen-tab" onClick={() => choose(t.id)}>{t.label}</button>)}
    </div>
    <div className="gen-panel" role="tabpanel" id={id("search")} aria-labelledby={id("search") + "-tab"} hidden={tab !== "search"}>
      <AutoGenerate encounter={encounter} levels={party.map(p => p.level)} monsters={monsters} onChange={onChange} />
    </div>
    <div className="gen-panel" role="tabpanel" id={id("ai")} aria-labelledby={id("ai") + "-tab"} hidden={tab !== "ai"}>
      <AiGenerate encounter={encounter} party={party} monsters={monsters} byId={byId} artwork={artwork} catalogReady={catalogReady} onChange={onChange} />
    </div>
  </div>;
}
