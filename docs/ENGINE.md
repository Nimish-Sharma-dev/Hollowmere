# Engine (packages/engine): tasks T005 to T009

Headless, deterministic game rules. No Phaser, no DOM, no network, no clock, no `Math.random`
(enforced by `test/purity.test.ts`). Everything random flows through a seeded `Rng`.

## Quick start

```ts
import { createGame, perform, advance, runEvent, startEncounter, stepCombat, finishEncounter, serialize } from './packages/engine/src/index.ts';

const state = createGame(content, { seed: 42, startSeason: 'autumn', nodes: [{ id: 'oak_01', def: 'oak_tree' }], startItems: [{ item: 'axe', qty: 1 }] });
perform(state, content, { type: 'gather', node: 'oak_01' });   // costs ticks + energy
advance(state, content, 10, 'rest');                           // world + survival tick
runEvent(state, content, 'midnight_theft', { assignment: { thief: 'pip', victim: 'tobin' } }); // Director-validated
const json = serialize(state);                                 // single JSON blob per run
```

`content` is a `ContentBundle` (see `packages/shared/src/types.ts`). The engine never reads files.
Run a whole headless game: `npm run sim -- <seed> <days> <startSeason>`.

## Modules

| File | Owns |
|---|---|
| `config.ts` | Every tunable constant (day length, temperatures, decay rates, combat numbers, drift) |
| `rng.ts` | Seeded RNG, hashing, stable JSON/hash of state |
| `time.ts`, `weather.ts` | 240 ticks/day (10 real minutes at 2.5 s/tick), 4 phases, 4 seasons x 8 days, weather as a pure function of (seed, day, season) |
| `stats.ts` | health, hunger, warmth, energy; fixed rules, the Director never touches them |
| `inventory.ts`, `gathering.ts`, `crafting.ts` | Stacks and slots, resource nodes with tools/depletion/respawn, recipes with stations, structures, eat/heal/equip |
| `combat.ts` | 20 Hz fixed-step melee + ranged, dodge i-frames, knockback, stagger, enemy FSM (idle, chase, windup, recover, flee, fled, dead), loot, reference bots |
| `village.ts` | Village stats 0..10, seasonal drift, NPC schedules and overrides, edge-triggered thresholds |
| `events.ts` | Effect vocabulary parser, event validation, requirements, role-slot assignment, runner, scheduler |
| `world.ts`, `actions.ts` | `advance()` clock and `perform()` player actions |
| `save.ts`, `invariants.ts`, `sim.ts` | Save/load, per-action invariants, headless runner and reference survival bot |

## The effect vocabulary (fixed; the engine owns it)

`village.<stat> +/-n` | `npc[<slot>].trust +/-n` | `flag.set <id>` | `spawn npc[<slot>] at <location>` |
`give item <id> [qty]` | `start dilemma <id>` | `plant clue <id>` | `schedule event <id> in <days>`

Anything else is rejected by `parseEffect` / `validateEvent`. `give item` accepts an optional quantity (a small
extension of the plan's wording; default 1).

## Decisions worth knowing

- **Roles are per run.** A slot's `roles` are matched against `state.npcs[id].role` (set by the Run Bible),
  not against the card's `allowedRoles`. `createGame` defaults each role to the card's first allowed role.
- **Blocked scheduled events** are retried every tick (so night-only events still fire at night) and dropped,
  with an entry in `state.skipped`, after 3 distinct blocked days.
- **Thresholds are edge-triggered** with cooldowns and `once`, and checked every tick.
- **Tile collision, pathfinding and rendering are not here** (T012+). Combat happens in an abstract open arena.
- **Plain TypeScript types instead of Zod** (T003 is not part of this lane). Swap in `z.infer` types later.
- **Imports are relative** (`../../shared/src/index.ts`) so the engine runs with zero installs.
  Switch to workspace package imports when you add a bundler.
- **Combat balance numbers are best-judgment defaults.** Tune in `config.ts` and the content enemies;
  the balance tests in `combat.test.ts` are the guard rails.

## Content package (T010)

`packages/content` has the loader (`loadContent(dir)`, one JSON file per table), the linter and the coverage report.
Run `npm run content:lint` (exit code 1 on errors).

Lint rules: ids snake_case and equal to their key; every reference (items, recipes, nodes, drops, structures,
locations, thresholds, scheduled events) resolves; tool types exist; every effect is in the fixed vocabulary and uses
real slots, items and locations; every event has effects; **every role slot has at least 2 possible NPCs**;
every NPC has at least 3 roles, a title, personality, speech style and 3 distinct tics. Warnings: events that could fire
constantly (no requirement, cooldown or trigger), NPCs in no event, roles used by no slot.

Coverage report: events per slot with candidate counts and possible assignments, NPC involvement, events per tag,
events per role.

**Starter cast:** the 8 cards in `packages/content/data/npcs.json` (read them in `docs/CAST.md`). They need your approval
at human checkpoint 3. The events in `data/events.json` are a 12-event placeholder library (the plan's 30 come later);
they exist so the cast can be linted and the engine exercised.

**Section 6 lint rules not implementable yet** because their content types do not exist in M1: secrets with 2+ clues in
different places, crises with 6+ eligible events, and 6+ fallback lines per NPC per angle (crises, secrets, clues and
dialogue arrive with T003, T015 and the content tasks that follow).
