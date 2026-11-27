# Test report: engine lane (T005 to T009)

Environment: Node 22.23.5, TypeScript 6.0.3 (typecheck), `node:test` (no Vitest in the build sandbox).

| Check | Result |
|---|---|
| `tsc --noEmit` (strict, erasableSyntaxOnly, 33 files incl. tests) | pass, 0 errors |
| `node --test "packages/**/test/**/*.test.ts"` | 116 tests, 116 pass, 0 fail (about 5 s); 105 engine + 11 content |
| 30-day headless sim, seed 1, autumn start | deterministic; bot alive; famine day 15 then soup kitchen day 16 |
| Determinism (same seed, 2 runs, daily state hashes) | identical |
| Save at day 10, load, play to day 20 vs uninterrupted | identical hash |
| Robustness sweep (40 seeds x 20 days, all seasons) | 0 invariant violations |

## Per-task acceptance

| Task | Check from the plan | Evidence |
|---|---|---|
| T005 | 30-day headless sim runs and is deterministic | `sim.test.ts`, `rng.test.ts`, `time-weather.test.ts`, `survival.test.ts` |
| T006 | Scripted scenarios pass | `economy.test.ts` (tools, yields, depletion/respawn, atomic failures, stations, build, use/equip) |
| T007 | Simulated fights stay within balance bounds | `combat.test.ts` (200 seeded fights per bound; all fights terminate; FSM, dodge, stagger, flee, ranged, loot) |
| T008 | Threshold events fire in a sim | `village.test.ts` (all 6 thresholds fire; edge/cooldown/once; famine chains to soup kitchen; organic famine in a 40-day world-only sim) |
| T009 | Same event plays with 3 different slot assignments | `events.test.ts` (different text, different NPC trust effects, shared consequences) |
| T010 | Linter passes, coverage report prints | `content.test.ts` and `npm run content:lint` (0 errors, 0 warnings, report printed) |

## Bugs the tests found and I fixed while building

1. Enemies backed away when closer than 0.8 x attack range (negative chase step).
2. Hit-stagger allowed unlimited stun-lock; a fist-wielding bot beat a bear. Added a minimum-damage rule and stagger immunity.
3. Winter village hunger drift could never reach the famine threshold. Retuned.
4. Phase-gated scheduled events could never fire (only retried at day start). Now retried every tick.
5. Village thresholds were only checked at day rollover; now checked every tick.

## NOT verified (be aware)

- `npm install`, ESLint, Prettier and Vitest: the sandbox had no internet. Tests use `node:test`, so none of
  these are needed to run them. Lint/format and CI (the rest of T001/T002) are not set up.
- Typechecking used TypeScript 6.0.3 here; `package.json` asks for `^5.9.0`. Expect the same result, but this
  is the most likely place for a surprise on your machine.
- Node below 22.18 needs the `--experimental-strip-types` flag (package.json targets >= 22.18, where it is on by default).
- Combat feel and balance are numbers on paper. Only playtesting can judge fun.
- `packages/engine/test/fixtures` is small test data. `packages/content/data` is kept in sync with it, so the 12 events are placeholders, not the 30-event slice.

- Cast quality (voice, tone) is a human judgment: see `docs/CAST.md`. The 12 events are placeholders, not the 30-event slice.
- Section 6 lint rules for secrets, crises, clues and fallback dialogue are not implemented because those types are not in M1.
