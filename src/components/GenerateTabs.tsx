import type { Encounter, PartyMember } from "../models/battle";
import type { Monster } from "../models/monster";
import AutoGenerate from "./AutoGenerate";
import AiGenerate from "./AiGenerate";
import TabbedPanels from "./TabbedPanels";

interface Props {
  encounter: Encounter;
  party: PartyMember[];
  monsters: Monster[];
  byId: ReadonlyMap<string, Monster>;
  artwork?: Record<string, string>;
  catalogReady: boolean;
  onChange: (patch: Partial<Encounter>) => void;
}

/** The "Auto Generate" section: Auto Search (random monsters from the catalog) and AI (Generate with AI $). */
export default function GenerateTabs({ encounter, party, monsters, byId, artwork, catalogReady, onChange }: Props) {
  return <TabbedPanels label="Auto Generate" storageKey="dnd-battle-tracker-generate-tab-v1" idPrefix={"gen-" + encounter.id} tabs={[
    { id: "search", label: "Auto Search", content: <AutoGenerate encounter={encounter} levels={party.map(p => p.level)} monsters={monsters} onChange={onChange} /> },
    { id: "ai", label: "AI", content: <AiGenerate encounter={encounter} party={party} monsters={monsters} byId={byId} artwork={artwork} catalogReady={catalogReady} onChange={onChange} /> },
  ]} />;
}
