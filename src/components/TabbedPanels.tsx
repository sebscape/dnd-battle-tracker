import { useRef, useState } from "react";
import type { ReactNode } from "react";

export interface TabPanel { id: string; label: string; content: ReactNode }

/**
 * Tabs above a bordered panel (used for "Auto Generate" and "Add monsters / Story and
 * tactics" in the encounter editor). Every panel stays mounted while hidden, so
 * switching tabs never loses what's in progress. With `storageKey` the chosen tab is
 * remembered; without it the first tab is selected each time.
 */
export default function TabbedPanels({ tabs, label, storageKey, idPrefix }: { tabs: TabPanel[]; label: string; storageKey?: string; idPrefix: string }) {
  const [tab, setTab] = useState<string>(() => {
    try { const saved = storageKey ? localStorage.getItem(storageKey) : null; if (saved && tabs.some(t => t.id === saved)) return saved; } catch { /* default */ }
    return tabs[0].id;
  });
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const choose = (id: string, focus = false) => {
    setTab(id);
    if (storageKey) try { localStorage.setItem(storageKey, id); } catch { /* remembered for this visit only */ }
    if (focus) buttons.current[id]?.focus();
  };
  const onKey = (e: { key: string; preventDefault: () => void }) => {
    const i = tabs.findIndex(t => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(tabs[next].id, true);
  };
  const id = (t: string) => idPrefix + "-" + t;
  return <div className="gen-tabs">
    <div className="gen-tablist" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map(t => <button key={t.id} type="button" role="tab" id={id(t.id) + "-tab"} aria-controls={id(t.id)} aria-selected={tab === t.id}
        tabIndex={tab === t.id ? 0 : -1} ref={(el: HTMLButtonElement | null) => { buttons.current[t.id] = el; }} className="gen-tab" onClick={() => choose(t.id)}>{t.label}</button>)}
    </div>
    {tabs.map(t => <div key={t.id} className="gen-panel" role="tabpanel" id={id(t.id)} aria-labelledby={id(t.id) + "-tab"} hidden={tab !== t.id}>{t.content}</div>)}
  </div>;
}
