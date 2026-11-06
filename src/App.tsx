import { useState } from "react";
import BattleScreen from "./components/BattleScreen";
import Encounters from "./components/Encounters";
import PartyRoster from "./components/PartyRoster";
import type { Encounter } from "./models/battle";
import { isEncounter, isPartyMember } from "./models/battle";
import { createBattle } from "./lib/combat";
import { useBattle } from "./lib/useBattle";
import { ENCOUNTERS_KEY, PARTY_KEY, useStoredList } from "./lib/storage";
import { useMonsters } from "./lib/useMonsters";

type Tab = "battle" | "encounters" | "party";

export default function App() {
  const data = useMonsters();
  const [party, setParty, partyError] = useStoredList(PARTY_KEY, isPartyMember);
  const [encounters, setEncounters, encounterError] = useStoredList(ENCOUNTERS_KEY, isEncounter);
  const battle = useBattle();
  const [tab, setTab] = useState<Tab>(() => battle.battle ? "battle" : "encounters");

  function startBattle(encounter: Encounter | null) {
    if (battle.battle && !window.confirm("A battle is already in progress. End it (saving it to history) and start a new one?")) return;
    if (battle.battle) battle.finish();
    const { battle: b, skipped } = createBattle(encounter?.name || "Quick battle", encounter, party, data.byId);
    if (skipped.length) window.alert("These custom monsters aren't available and were left out: " + skipped.join(", "));
    battle.start(b);
    setTab("battle");
  }

  const bridgeText = data.bridge === "connecting" ? "Checking Monster Reference…"
    : data.bridge === "connected" ? data.custom.length + " custom monster" + (data.custom.length === 1 ? "" : "s") + " from Monster Reference"
    : "Published monsters only — Monster Reference not reachable";
  const saveError = partyError || encounterError || battle.error;

  return <main>
    <header>
      <div className="app-brand">
        <img className="app-brand-logo" src="/images/battle-tracker-logo.webp" alt="" width="296" height="320" />
        <div><h1>D&amp;D Battle Tracker</h1><p className="muted">Plan encounters and run combat.</p></div>
      </div>
      <div className="header-status">
        <span>{data.loading ? "Loading monsters…" : data.published.length + " published monsters"}</span>
        <span className={"bridge-status " + data.bridge} title="Custom monsters and artwork come from the Monster Reference app in this browser">{bridgeText}</span>
      </div>
    </header>

    <nav className="tabs" aria-label="Sections">
      {(["battle", "encounters", "party"] as const).map(t => <button key={t} type="button" className="tab" aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
        {t === "battle" ? (battle.battle ? "Battle · round " + battle.battle.round : "Battle") : t === "encounters" ? "Encounters" : "Party (" + party.length + ")"}
      </button>)}
    </nav>

    {data.error && <p role="alert" className="error">{data.error}</p>}
    {saveError && <p role="alert" className="error">{saveError}</p>}

    {tab === "battle" && (battle.battle
      ? <BattleScreen key={battle.battle.id} battle={battle.battle} canUndo={battle.canUndo} apply={battle.apply} undo={battle.undo}
          finish={() => { battle.finish(); setTab("encounters"); }} party={party} data={data} />
      : <section className="panel empty-battle">
          <h2>No battle in progress</h2>
          <p className="muted">Start one from a saved encounter, or start an empty battle and add combatants as the fight begins.</p>
          <div className="actions-left">
            <button type="button" className="primary" disabled={data.loading} onClick={() => startBattle(null)}>Start an empty battle</button>
            <button type="button" onClick={() => setTab("encounters")}>Go to encounters</button>
          </div>
        </section>)}
    {tab === "encounters" && <Encounters encounters={encounters} onChange={setEncounters} party={party} data={data} onStartBattle={startBattle} />}
    {tab === "party" && <PartyRoster party={party} onChange={setParty} />}

    <footer>
      <p>Party and encounters are saved in this browser. Custom monsters and artwork are read from <a href="https://dnd-monster-ref.c2ma.com/">Monster Reference</a> in this same browser and are never changed here.</p>
      <p>This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at <a href="https://www.dndbeyond.com/srd">https://www.dndbeyond.com/srd</a>. The SRD 5.2.1 is licensed under the <a href="https://creativecommons.org/licenses/by/4.0/legalcode">Creative Commons Attribution 4.0 International License</a>.</p>
    </footer>
  </main>;
}
