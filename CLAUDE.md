# CLAUDE.md — dnd-battle-tracker

Combat tracker for D&D Dungeon Masters. Full design and agreed decisions: **DESIGN.md** (read it before changing behavior).

## Stack and commands

- React 18 + TypeScript + Vite, same conventions as [dnd-monster-reference](https://github.com/sebscape/dnd-monster-reference).
- `npm run dev` serves on **port 5174** (the reference app uses 5173; its bridge allows `http://localhost:5174`).
- `npm run build` runs `tsc -b` then `vite build` into `dist/`. Netlify settings are in `netlify.toml`.
- Live: https://dnd-battle-tracker.c2ma.com, auto-deployed from `main`.

## Layout

| Path | Purpose |
|---|---|
| `src/App.tsx` | Header, tabs, monster data and stored lists |
| `src/components/` | `Encounters` (list + editor), `MonsterPicker`, `PartyRoster` |
| `src/lib/bridge.ts` | Client for the reference app's read-only storage bridge |
| `src/lib/useMonsters.ts` | Bundled published catalog + custom monsters/artwork via the bridge |
| `src/lib/storage.ts` | localStorage lists (`dnd-battle-tracker-party-v1`, `dnd-battle-tracker-encounters-v1`) |
| `src/models/monster.ts` | **Copy** of the reference app's model (schema 1.2.0). Keep in sync. |
| `src/models/battle.ts` | Party member and encounter types and validators |
| `public/data/published-monsters.json` | **Copy** of the reference app's SRD 5.2.1 catalog. Update when that changes. |
| `public/bridge-test.html` | Diagnostic page for the storage bridge |

## Rules

- Never write to the reference app's data; the bridge is read-only by design.
- Saved encounters reference monsters by UUID and must handle a missing custom monster gracefully.
- Keep the SRD 5.2.1 CC BY 4.0 attribution in the app footer.
- Changes to stored record shapes need a new storage key version or a migration, so existing users' data still loads.
