# CLAUDE.md — dnd-battle-tracker

Combat tracker for D&D Dungeon Masters. Full design and agreed decisions: **DESIGN.md** (read it before changing behavior).

## Name and addresses (renamed November 2026)

- The app is **Scrap Sheet** — "a 5E-compatible battle tracker" — at https://scrap-sheet.c2ma.com. Its companion is **Critter Codex** (formerly dnd-monster-reference, the "reference app" in these notes) at https://critter-codex.c2ma.com.
- **Never put "D&D" or "Dungeons & Dragons" in names, titles, logos or headings.** They are Wizards of the Coast trademarks, which the SRD's CC BY licence does not cover. "5E-compatible" and the SRD attribution line in the footer are the only references.
- Old address: https://dnd-battle-tracker.c2ma.com. The GitHub repo may still be named `dnd-battle-tracker` until it is renamed.
- **Storage keys keep the old `dnd-battle-tracker-…` names on purpose.** Renaming them would lose users' data.
- **Moving data from the old address:** browser storage belongs to one address. `public/move-data.html` (served from the old address, read-only, answers only the new origin), `src/lib/moveData.ts` and `src/components/MoveData.tsx` copy the party, encounters, battle history, any battle in progress and settings into the new address from the Settings tab. Remove all three once the old address redirects.

## Stack and commands

- React 18 + TypeScript + Vite, same conventions as [dnd-monster-reference](https://github.com/sebscape/dnd-monster-reference).
- `npm run dev` serves on **port 5174** (the reference app uses 5173; its bridge allows `http://localhost:5174`).
- `npm run build` runs `tsc -b` then `vite build` into `dist/`. Netlify settings are in `netlify.toml` (build, and the `netlify/functions` directory).
- `npm test` runs the unit tests in `tests/` with Node's built-in test runner (Node 22.18+; no extra packages). `tests/resolve-ts.mjs` lets Node load the app's extensionless TypeScript imports, so tested modules must be plain TypeScript (no JSX, enums or constructor parameter properties) and must not touch `import.meta.env` at load time.
- Live: https://scrap-sheet.c2ma.com, auto-deployed from `main`.

## Layout

| Path | Purpose |
|---|---|
| `src/App.tsx` | Header (with the gear button that opens Settings, as in Critter Codex), tabs (Battle, Encounters, Party), monster data and stored lists |
| `src/components/` | `Encounters` (list + editor, difficulty), `MonsterPicker`, `MonsterDetails` (read-only copy of the reference app's detail view — keep in step), `TabbedPanels` (shared tab UI: panels stay mounted while hidden, chosen tab remembered), `GenerateTabs` (the editor's "Auto Generate" section: **Auto Search** tab = `AutoGenerate`, **AI** tab = `AiGenerate`); below the monster list the editor has **Add monsters** (`MonsterPicker`) and **Story and tactics** tabs, `PartyRoster`, `BattleScreen` (turn order, log), `CombatantDetail` (HP, conditions, stat block rolls), `AddCombatants`, `NumberPrompt` (physical dice), `EndBattleDialog` (search for loot), `SettingsPanel` (opened by the header gear: data move, AI Encounter Generation, coin table), `PasswordInput` (password box with a show/hide eye), `ConversationDialog` (the spyglass: latest AI request and reply) |
| `src/lib/bridge.ts` | Client for the reference app's read-only storage bridge |
| `src/lib/useMonsters.ts` | Bundled published catalog + custom monsters/artwork via the bridge |
| `src/lib/combat.ts` | Pure battle rules: creating a battle, turn order, HP, conditions. Each function returns a new `Battle`. |
| `src/lib/useBattle.ts` | Active battle (`dnd-battle-tracker-active-v1`) with undo snapshots; finished battles go to `dnd-battle-tracker-history-v1` |
| `src/lib/statblock.ts` | Parses SRD 5.2.1 attack, saving throw, damage and resistance text |
| `src/lib/effects.ts` | How conditions affect d20 rolls (SRD 5.2.1 rules + DM-defined effects); Advantage/Disadvantage cancelling |
| `src/lib/traits.ts` | Conditional Advantage read from stat-block text (Pack Tactics, Grappled by, Bloodied, hurt targets) |
| `src/lib/treasure.ts` | Loot after a battle: stat-block gear, planned treasure, the DM's own coin table (`dnd-battle-tracker-treasure-v1`) |
| `src/lib/dice.ts` | Dice notation, crypto-random rolls, advantage/disadvantage |
| `src/lib/aiEncounter.ts` | "Generate with AI $": settings (`dnd-battle-tracker-ai-v1`), compact catalog, request, response validation (unknown monster IDs rejected), mapping onto an encounter. UI: `components/AiGenerate.tsx`, `components/AiSettingsSection.tsx` |
| `src/lib/credentials.ts` | This app's own OpenAI token (`dnd-battle-tracker-api-token-v1`), encrypted like Critter Codex's; the one unlock state shared by every AI feature here; plaintext in memory only |
| `netlify/functions/generate-encounter.mjs` | Calls the OpenAI Responses API with a strict JSON Schema; normalized JSON errors; token never stored or logged. Called directly in local dev |
| `netlify/functions/generate-encounter-background.mjs`, `encounter-job.mjs` | On Netlify: background job (up to 15 min) + job status in Netlify Blobs (`@netlify/blobs`), polled by the browser — same design as Critter Codex's artwork jobs |
| `src/lib/generate.ts` | Random encounters by environment (from monster `tags`), difficulty, max CR and kinds; used by `components/AutoGenerate` |
| `src/lib/difficulty.ts` | SRD 5.2.1 XP budgets and monster XP by CR |
| `src/lib/storage.ts` | localStorage lists (`dnd-battle-tracker-party-v1`, `dnd-battle-tracker-encounters-v1`) |
| `src/models/monster.ts` | **Copy** of the reference app's model (schema 1.2.0). Keep in sync. |
| `src/models/battle.ts` | Party member and encounter types and validators |
| `public/data/published-monsters.json` | **Copy** of the reference app's SRD 5.2.1 catalog. Update when that changes. |
| `public/bridge-test.html` | Diagnostic page for the storage bridge |

## Rules

- Never write to the reference app's data; the bridge is read-only by design.
- **API token:** Scrap Sheet has its own token setup (Settings → AI Encounter Generation), independent of Critter Codex so each app works alone. Every AI feature in this app uses `src/lib/credentials.ts`; never add a second token setting. Never store the password or the plaintext token, and never put the token in logs, error messages or URLs. Never make a paid OpenAI request in tests.
- Saved encounters reference monsters by UUID and must handle a missing custom monster gracefully.
- Keep the SRD 5.2.1 CC BY 4.0 attribution in the app footer.
- Changes to stored record shapes need a new storage key version or a migration, so existing users' data still loads.
