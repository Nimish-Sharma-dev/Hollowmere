# Human verification checklist (engine lane)

1. `node -v` must be 22.18 or newer. Then: `npm install` (only typescript + @types/node) and `npm run verify`.
   Expect: typecheck clean, 116 tests passing. Send me any error text verbatim.
2. `npm run sim -- 1 30 autumn` prints a 30-day summary (seed, days, start season are arguments). Try a few seeds.
3. Read `docs/ENGINE.md` "Decisions worth knowing" and confirm you agree with each one.
4. Skim `packages/engine/src/config.ts`: day length, temperatures, decay rates and combat numbers are the
   knobs you will tune after a real playtest.
5. Nothing else needs a human until a client exists (T011+).
6. `npm run content:lint` prints lint results and the coverage table for the placeholder data (0 errors, 0 warnings expected).
7. Read `docs/CAST.md` (the 8 starter NPCs). This is the only human approval M1 needs. Tell me what to change.
