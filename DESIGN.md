# dnd-battle-tracker — Design

Status: agreed design, pre-implementation (2026-11-05).

## Purpose

A web tool for Dungeon Masters to run combat: initiative order, monster hit points, monster attack and saving-throw rolls, PC status, conditions, and everything else a DM tracks during a fight. It is a companion to [dnd-monster-reference](https://github.com/sebscape/dnd-monster-reference) but works on its own.

## Deployment

| | |
|---|---|
| Repo | `sebscape/dnd-battle-tracker` |
| Hosting | Netlify, auto-deploy from `main` |
| Address | https://dnd-battle-tracker.c2ma.com |
| Stack | React + TypeScript + Vite (same as dnd-monster-reference) |
| Users | Single DM per browser; no accounts |

## Monster data and the storage bridge

- **Published monsters** (SRD 5.2.1, 330 monsters) are bundled with the battle app, so it works without the reference app.
- **Custom monsters and artwork** live in the reference app's browser storage on `dnd-monster-ref.c2ma.com`. Browsers isolate storage per subdomain, so the battle app reads them through a **storage bridge**:
  - The reference app hosts a small bridge page, `public/bridge.html` (served at `/bridge.html`), with no UI.
  - The battle app loads it in a hidden iframe and requests data with `postMessage`.
  - The bridge only answers requests from `https://dnd-battle-tracker.c2ma.com` (and `http://localhost:5174`, the battle app's dev server) and checks the message origin on both sides. The reference app's dev server stays on port 5173.
  - Both sites are under `c2ma.com` (same site), so browsers should give the iframe the same storage the reference app sees. **This must be verified in Chrome, Firefox and Safari before other work is built on it.**
- **Read-only.** The battle app never changes custom monsters or artwork. All editing stays in the reference app.
- **Fallback.** If the bridge doesn't respond within a few seconds, the battle app continues with published monsters only and says so in the UI.
- **Monster references in saved encounters** use the monster UUID. If a custom monster is missing later (bridge offline, monster deleted), the encounter shows it as unavailable rather than failing.
- **Schema.** The battle app copies the `Monster` type and `isMonster()` validator from the reference app (schema 1.2.0). Shared code can move to a common package later if the duplication becomes a problem.

### Bridge messages (version 1)

Every message is `{ protocol: "dnd-bridge", id, type, payload }`. Replies are `{ protocol: "dnd-bridge", id, ok: true, result }` or `{ ..., ok: false, error }`.

| Request | Result |
|---|---|
| `hello` | `{ bridgeVersion, schemaVersion, storage: { customMonsterCount, artworkCount, localStorageKeys } }` |
| `listCustomMonsters` | `{ monsters }`: custom (`homebrew`) `Monster` records |
| `getArtwork { monsterIds }` | `{ artwork }`: map of monster ID → image data URL. `monsterIds: null` returns all (max 500 IDs per request). |

The bridge never writes to storage and never creates the artwork database if it doesn't exist. The published catalog is not sent through the bridge; the battle app has its own copy.

### Prototype status

`public/bridge-test.html` (live at `/bridge-test.html`) connects to the production bridge and shows what it can read. `?bridge=local` points it at the reference app's dev server instead. Tested in Chrome locally (protocol, allow-list, empty storage). Still to verify on the live sites in Chrome, Firefox and Safari, on desktop and mobile.

## Battle app storage

Browser storage on `dnd-battle-tracker.c2ma.com` (localStorage for small records, IndexedDB if size requires):

- **Party roster:** saved PCs.
- **Encounters:** saved encounter templates.
- **Active battle:** saved after every change so a refresh or closed tab resumes it.
- **Battle history:** finished battles with their combat log.

Export/import of all battle-app data as JSON for backup, matching the reference app's approach.

## Core features

### Party roster ("light" PC tracking)
- Saved once: name, level, AC, passive Perception.
- In battle: initiative, conditions, up/down status. Players track their own HP.
- Level is needed for encounter difficulty.

### Encounters
- Build ahead of time: choose monsters (published or custom) and counts, choose which party members are present.
- Or build on the fly when a fight starts.
- Combatants can be added or removed mid-fight.

### Monster setup at battle start
- **HP rolled** from the stat block's hit dice (e.g. `20d10 + 40`), editable by the DM.
- **Initiative:** each monster rolls separately by default; the encounter can switch a monster type to one shared roll.
- **Names:** copies are auto-numbered (Goblin 1, Goblin 2) and each can be renamed.

### Turn order
- Initiative list sorted high to low, with the active combatant highlighted; next/previous turn; round counter.
- PC initiative entered by the DM.
- DM-only view (no player-facing screen in this version).

### Dice
- Click an attack or saving throw to roll it; the result shows the dice and modifiers.
- The DM can type in a physical die result instead of the app's roll.
- Supports advantage and disadvantage.

### Reading stat blocks for rolls
SRD 5.2.1 actions use consistent wording, which the app parses into roll buttons:
- Attacks: `Melee Attack Roll: +5, reach 5 ft. Hit: 6 (1d6 + 3) Slashing damage.` (about 420 of the catalog's 806 actions)
- Saves: `Constitution Saving Throw: DC 14 … Failure: 10 (3d6) Psychic damage. Success: Half damage.` (about 150)
- Anything that doesn't parse cleanly is shown as plain text for the DM to roll by hand.

### Damage and healing
- Apply damage or healing to one or more combatants.
- Pick a damage type: resistances halve it and immunities cancel it automatically, from the stat block. The DM can override.
- At 0 HP a monster is marked defeated (kept in the list, greyed out).

### Area effects
- Select several monsters, roll all their saving throws together, enter the damage once, and apply full damage on a failure and half on a success (respecting each monster's resistances).

### Conditions
- Add conditions to any combatant, optionally with a duration in rounds.
- Durations count down automatically, with a reminder when a condition ends.

### Legendary actions and lairs
- Track legendary action uses per monster; uses reset at the start of that monster's turn.
- **"In lair" toggle** per monster. SRD 5.2.1 has no separate lair actions in stat blocks; being in a lair raises legendary action uses and Legendary Resistance (e.g. Aboleth: 3/Day, 4/Day in Lair).
- Track Legendary Resistance uses.

### Combat log and undo
- Every roll, HP change, condition change and turn change is logged.
- Undo reverses the last action, step by step.

### Encounter difficulty
- Shows difficulty for the party using the SRD 5.2.1 XP budget per character level and monster XP by challenge rating. Table values are taken from the SRD 5.2.1 during implementation.

## Layout
- Responsive: laptop (turn order, active monster's stat block and log side by side), tablet (touch-sized controls), phone (single column).
- Monster artwork, when available through the bridge, appears on the active monster's card.

## Build order
1. **Bridge prototype.** Bridge page in the reference app plus a bare test page on this site; verify in Chrome, Firefox and Safari.
2. **Foundation.** Project setup, monster loading (bundled catalog + bridge), party roster, encounter builder.
3. **Live battle.** Turn order, HP, conditions, dice, stat block parsing.
4. **Version 1 extras.** Area effects, legendary/lair tracking, log with undo, encounter difficulty, battle history, export/import.

## Out of scope for version 1
- Player-facing or shared table display.
- Multiple devices or users, accounts, cloud sync.
- Editing custom monsters or artwork from the battle app.
