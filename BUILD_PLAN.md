# Hollowmere: Build Plan

How to build the game with AI coding agents (Claude Code, Google Antigravity or any similar agentic tool) and as little human intervention as possible. 2D pixel art only. No 3D tools, no Unity, no Blender.

**Honest note:** "zero human intervention" is not realistic. The goal is to push humans to a handful of **checkpoints** (section 12) and let agents do everything between them. Pixel art is the weakest link for AI automation, so the plan leans on free asset packs and scripts rather than AI-generated art.

---

## 1. Principles that make agent-built projects work

1. **Everything is text.** Code, content, maps, prompts, tests and specs are all plain files in the repo. No binary editor project files that an agent cannot read.
2. **The engine runs headless.** The whole game simulation is pure TypeScript with no graphics. Agents can test it, and bots can play it, without a screen.
3. **Contracts first.** Shared schemas (ids, events, Run Bible, Director output) live in one package. Everything else depends on them.
4. **Content is data.** Events, NPCs, crises and clues are JSON/YAML files checked by validators, not hard-coded.
5. **Every task has a machine-checkable "done".** A test, a lint rule or an eval score. No "looks good."
6. **LLM calls are mocked in tests.** Recorded fixtures keep tests free. Real LLM evals run in a small, capped, scheduled job.
7. **Roles, not NPCs, in events.** Events are written with **role slots** (`slot:traitor`, `slot:victim`) instead of fixed characters. This is what lets one event play out differently for every player.

---

## 2. Everything that has to be made

### 2.1 Game design content (authored by the content agent, reviewed by a human at checkpoints)

| Item | Vertical slice | Full v1 |
|---|---|---|
| Villages | 1 | 1 (more later) |
| NPC cards (personality, speech style, tics, allowed roles) | 8 | 12 |
| Roles per NPC | 3 | 4 to 5 |
| Crises | 4 | 8 |
| Secrets (templates) | 20 | 50 |
| Clue templates | 40 | 100 |
| Events (with role slots) | 30 | 80 to 100 |
| Dilemma templates | 12 | 30 |
| Midpoint twists | 4 | 10 |
| Ending families | 6 | 8 (with 3 to 4 variants each) |
| Onboarding questions | 7 | 12 (7 drawn per player) |
| Spawn scenarios | 4 | 8 |
| Starting kits | 4 | 8 |
| World-of-the-day modifiers | 10 | 30 |
| Rumor mutation rules | 7 | 7 |
| Seed Deck entries per slot | 15 | 30+ |
| Pre-written fallback dialogue (per NPC × angle × mood) | 6 per combination | 10 per combination |
| Items (resources, tools, weapons, food, clothing, remedies) | 60 | 120 |
| Recipes | 40 | 80 |
| Enemy types | 4 | 8 |
| Persona cards for test bots | 10 | 20+ |

### 2.2 Art (2D pixel only)

Internal resolution: **320×180**, scaled by whole numbers to 1280×720. Tile size: **16×16**. Characters: 16×24. Palette: one shared palette of 32 colors (pick one from Lospec at checkpoint 2).

| Group | Contents |
|---|---|
| **Terrain tiles** | grass, dirt, snow variants, water, marsh, forest floor, stone path, edges and transitions |
| **Village buildings** | 4 house variants, forge, mill, chapel, hall, watchtower, ruins (exteriors) |
| **Interiors** | floors, walls, furniture (about 30 pieces), hearth, beds, workbench |
| **Props** | fences, wells, crates, barrels, campfire, graves, statues, signs, lanterns (about 40) |
| **Resource nodes** | tree, rock, berry bush, ore, fish spot, herb patch, each with a depleted state |
| **Player** | 4 directions × idle, walk, attack, hurt, gather, die; palette-swappable skin, hair and clothes |
| **NPCs** | 8 to 12, built from base bodies with palette swaps and one unique hat, hair or accessory each |
| **Animals and enemies** | deer, wolf, crow, rabbit, bandit (2 variants), cultist, ghost, boss silhouette |
| **Item icons** | 16×16, about 60 at slice, 120 at v1 |
| **UI** | health/hunger/warmth/energy bars, hotbar, inventory grid, dialogue box, choice buttons, journal (clues, rumors, relationships), village-mood display, map, pause and settings, title screen, toasts for "the world noticed" lines |
| **Campfire Prelude** | one scene: fire, stranger, night sky |
| **Chronicle** | book frame, page textures, about 20 scene vignettes composed from existing sprites (assembled by code, not drawn separately) |
| **Portraits (post-slice)** | 8 NPCs × 4 moods at 48×48 |
| **Effects** | snow, rain, embers, dust, fog (particles), day-night tint (code), hit flash |
| **Store/marketing** | app icon, 5 screenshots, short trailer made from in-engine capture |

### 2.3 Audio

| Group | Contents |
|---|---|
| **SFX (about 40)** | footsteps by surface, chop, mine, gather, craft, hit, hurt, UI click, dialogue blip per NPC, fire crackle, wind, rain, wolf howl, door, bell |
| **Music (6 loops)** | title, morning/day, evening, night, danger, and a "village mood" layer that goes hopeful or thin |

### 2.4 Engine systems

Time and day/night · seasons and weather · movement and tile collision · survival stats · gathering · crafting · simple base-building · inventory · real-time combat · enemy AI (state machine) · NPC daily schedules · dialogue (intent buttons) · event runner (with role slots) · village stats and thresholds · NPC memory and trust · rumor spread · journal · save/load · onboarding flow · Chronicle viewer · ghost-monument placement · settings and accessibility · analytics events.

### 2.5 LLM layer

Provider adapter · prompt registry (P0 to P9) · Seed Deck draw · fingerprint check · schema validators · fallback Director · fallback Run Bible builder · response cache · call logger and cost meter · per-player and daily caps · kill switch · typed-input sanitizer.

### 2.6 Backend

Anonymous accounts · cloud saves · shared tables (ghost legends, daily modifier, fingerprints) · LLM proxy function (keeps the API key off the client) · rate limits · cost tables · content-gap log.

### 2.7 Quality and operations

Unit tests · headless full-run simulations · divergence eval · persona-bot runs · continuity checker · CI · cost dashboard · error reporting.

---

## 3. Tech stack

| Area | Choice | Why it suits agents | Alternatives |
|---|---|---|---|
| **Language** | TypeScript everywhere | One language across client, server and tools; strong types catch agent mistakes | JavaScript |
| **Game framework** | **Phaser** (use the current stable release when you start) | Code-only 2D framework. No editor project files. Excellent pixel-art support, tilemaps, particles, input | Godot is a good engine but its scene files and editor make agent-only work harder |
| **Build tool** | **Vite** | Fast, simple, agent-friendly | none needed |
| **Monorepo** | **pnpm workspaces** | Clear package boundaries for parallel agent lanes | npm workspaces |
| **Schemas** | **Zod** | One source of truth for types and runtime validation. Also used for LLM output | Valibot |
| **Maps** | Code-defined: ASCII or JSON grids compiled to tilemaps by a script | Agents can write and diff maps. No manual editor needed | **Tiled** or **LDtk** if you want to hand-edit |
| **Backend and DB** | **Supabase** (Postgres, anonymous sign-in, row-level security, Edge Functions) | One service for DB, auth and the secure LLM proxy. Free tier is enough to start (check current limits) | Cloudflare Workers + D1; Firebase |
| **LLM access** | Server-side only, behind a **provider adapter** interface | Swap providers, switch models per task, never expose keys | Direct calls from the client are not allowed |
| **Models** | Small, fast model for dialogue, memory, rumors, daily modifier. Stronger model for Run Bible and Chronicle | Cost control (use whatever your credits cover) | One model for everything while prototyping |
| **Hosting** | **Cloudflare Pages** or **Vercel** (static client) | Free tiers, deploy on push | Netlify, itch.io for early builds |
| **Mobile packaging** | **PWA first**, then **Capacitor** to wrap for Android | Web build is the single source; no second codebase | none |
| **Testing** | **Vitest** (unit and headless sim), **Playwright** (browser smoke tests) | Agents can run them in a loop | Jest |
| **CI** | **GitHub Actions** | Runs lint, tests and fixture checks on every push | any CI |
| **Pixel art tools** | Free asset packs (e.g. Kenney, itch.io CC0 packs, OpenGameArt, **check each license**) + **Python (Pillow)** scripts for palette swaps and atlas packing. For hand edits: **LibreSprite**, **Piskel** or **Pixelorama** (free) | Scripted variants give NPC diversity without drawing each one | Aseprite (paid) |
| **Fonts** | Google Fonts pixel fonts (Press Start 2P, Silkscreen, VT323) | Free, open licenses | any OFL pixel font |
| **Sound** | **jsfxr** (generates retro SFX in the browser), **BeepBox** or **Bosca Ceoil** for chiptune loops, plus CC0 packs | Free and quick | CC0 music packs |
| **Agent rules** | `AGENTS.md` as the single source of truth; `CLAUDE.md` is one line pointing to it | Works across tools. Check each tool's docs for the rules file it reads (some read `GEMINI.md` or its own rules folder; point those at `AGENTS.md` too) | n/a |

**Explicitly out of scope:** Blender, Unity, Unreal, any 3D asset or workflow.

**Do not copy the reference game.** Take inspiration from the genre, but make your own art, names, items and maps.

---

## 4. Repository layout

```text
hollowmere/
├─ AGENTS.md                  # rules for every agent (section 13)
├─ CLAUDE.md                  # one line: "Read AGENTS.md"
├─ README.md                  # the idea only
├─ docs/
│  ├─ BUILD_PLAN.md
│  ├─ PROMPTS.md
│  ├─ design/                 # pillars, systems specs, tone guide
│  └─ tasks/                  # T001.md ... one file per task
├─ packages/
│  ├─ shared/                 # Zod schemas, ids, types (the contracts)
│  ├─ engine/                 # headless simulation, pure TS, no graphics
│  ├─ content/                # JSON/YAML libraries + validators + linters
│  ├─ director/               # prompts, seed deck, adapter, validators, fallbacks, cache
│  └─ evals/                  # persona bots, divergence harness, fixtures
├─ apps/
│  └─ game/                   # Phaser client (rendering and input only)
├─ supabase/
│  ├─ migrations/
│  └─ functions/              # llm-proxy, daily-modifier, ghost-legends
├─ assets/
│  ├─ sprites/ tiles/ ui/ audio/
│  └─ manifest.json           # every asset with license and source
├─ tools/                     # palette-swap, atlas packer, asset linter, map compiler, content linter
└─ .github/workflows/
```

**Dependency rule:** `shared` ← `engine`, `content`, `director` ← `apps/game`. The client never imports prompts or keys.

---

## 5. Architecture and data flow

```text
Player input
   │
   ▼
apps/game (Phaser)  ──►  packages/engine (headless rules, state)
   │                           │
   │ decision point / dialogue │ stress signals, world state
   ▼                           ▼
supabase/functions/llm-proxy  ◄── packages/director
   │   (caps, key, cache, cost log)     (prompts + seed deck + validators)
   ▼
LLM provider  ──►  JSON  ──►  validator  ──►  engine applies it
                                  │ fails
                                  ▼
                            fallback Director (rule-based, same JSON shape)
```

- The client sends only **state summaries**, never raw prompts.
- The proxy builds the prompt from the registry, applies caps, calls the model, validates, logs, and returns clean JSON.
- The **same validator and schemas** run in tests, so fixtures prove the validator works.

---

## 6. Content pipeline (LLM-assisted, human-light)

1. **Author with an agent.** The content agent writes NPC cards, events, crises, secrets and clues from the design docs.
2. **Lint automatically.** Scripts check ids are unique and snake_case, every role slot has at least 2 eligible NPCs, every event has requirements and effects in the allowed vocabulary, every secret has 2 or more clues in different places, every crisis has 6 or more eligible events, and every NPC has 6 or more fallback lines per angle.
3. **Event effect vocabulary (small and fixed):** `village.<stat> ±n`, `npc[<slot>].trust ±n`, `flag.set <id>`, `spawn npc[<slot>] at <location>`, `give item <id>`, `start dilemma <id>`, `plant clue <id>`, `schedule event <id> in <days>`. The engine owns this list, and the content agent may only use it.
4. **Gap harvesting.** Whenever the Director returns `library_gap`, it is written to a `content_gaps` table. A scheduled content-agent task reads the top gaps and writes new content for them. Over time the library fills exactly where the LLM wished it had more.
5. **Coverage report.** A script prints how many events exist per crisis, per tone, per stance and per role slot, so thin areas are visible.

---

## 7. Art pipeline (low-manual)

1. **Style board (human, checkpoint 2):** choose the palette, one or two base asset packs, and a font.
2. **Manifest first:** `assets/manifest.json` lists every asset needed, its size, its source and its license. The asset linter fails the build if a file is not in the manifest, has the wrong size, or uses colors outside the palette.
3. **Import and normalize:** a script remaps imported art to the shared palette and checks the tile grid.
4. **Variants by script:** palette swaps for NPC clothes, hair and skin, seasonal tile recolors (snow, autumn) and damaged or depleted states.
5. **Composed scenes:** Chronicle illustrations and the campfire scene are assembled from existing sprites by code.
6. **Hand fixes:** a human or an image-capable agent touches up gaps in LibreSprite, Piskel or Pixelorama, with the linter as the referee.
7. **Rendering rules:** nearest-neighbor filtering, whole-number scaling, no sub-pixel movement for sprites, one shared palette, text in a pixel font.

---

## 8. Engine specifications (short)

- **Time:** 1 in-game day is about 8 to 12 real minutes (tunable). Phases: morning, day, evening, night.
- **Stats:** health, hunger, warmth, energy. Constants live in one config file.
- **Combat:** real-time, with melee (hit, dodge, knockback) and a simple ranged option. Damage and drops come from data tables.
- **NPC schedules:** each NPC has a home, a workplace and a gathering spot per phase. Events can override the schedule.
- **Dialogue:** the player picks an intent (`ask`, `help`, `threaten`, `bargain`, `gossip`, `greet`). The LLM writes the NPC's reply (P4). The engine applies the returned `trust_delta`, memory and clue.
- **Event runner:** an event is a data script with role slots. The Director assigns NPCs to slots, and the runner plays the script.
- **Village stats:** `hope, fear, hunger, trust, unity` from 0 to 10. Threshold crossings trigger scheduled events (festival, riot, famine, exodus).
- **Saves:** a single JSON blob per run. The Run Bible, world state, memories, rumors and event log are all in it.
- **Determinism:** engine randomness is seeded per run, so bugs are reproducible.

---

## 9. LLM layer specifications

- **Provider adapter:** one interface (`complete(promptId, vars, opts) → validated JSON`), with one implementation per provider. Includes timeouts, one retry and token counting.
- **Prompt registry:** versioned prompt files with `P0` to `P9`, each paired with a Zod output schema and a fixture set.
- **Prompt caching:** put the stable parts (constitution, Run Bible, library digest) first so the provider can reuse them, if your provider supports caching.
- **Pre-generation:** at evening, generate tomorrow's morning beat in the background. When a dialogue scene is likely, pre-generate the first reply.
- **Caps:** per-player calls per day, per-run total, and a global daily budget. When any cap is hit, the fallback takes over silently.
- **Kill switch:** an environment flag that routes everything to the fallback.
- **Call log:** `llm_calls(id, run_id, prompt_id, model, tokens_in, tokens_out, tokens_cached, cost_usd, latency_ms, ok, fallback_used, created_at)`.
- **Sanitizer for typed answers:** length cap (120 to 200 characters), strip control characters, wrap in `<player_text>`, run a basic profanity and link filter. The validator is the real defense because the model can only output known ids.
- **Fallback Director:** weighted random over eligible events using tag match, anti-repeat, stance quota and the Run Bible's arc. Returns exactly the P3 JSON shape. It must be good enough that a player who never hits the LLM still has a fun game.
- **Fallback Run Bible builder:** picks from authored "bible presets" and shuffles roles using the Seed Deck. It never produces a bible within distance 2 of a recent fingerprint.

---

## 10. Database tables (Supabase / Postgres)

| Table | Purpose |
|---|---|
| `players` | anonymous user id, created_at, caps usage |
| `runs` | run id, player id, seed, status, onboarding profile, archetype scores |
| `run_bibles` | run id, bible JSON (trimmed), raw response, fingerprint |
| `story_seeds` | rejected candidates kept for reuse |
| `saves` | run id, save blob, updated_at |
| `ghost_legends` | text, tags, monument type, created_at, play_count |
| `daily_modifiers` | date, modifier id, lines |
| `fingerprints` | run id, fingerprint fields, onboarding cluster |
| `llm_calls` | cost and latency log (see section 9) |
| `content_gaps` | gap text, source prompt, count, status |
| `budget` | remaining credits, daily cap, kill switch state |

Row-level security: players read and write only their own rows. Shared tables (`ghost_legends`, `daily_modifiers`) are read-only for clients and written only by server functions.

---

## 11. Milestones and agent tasks

Each task is one file in `docs/tasks/` with: goal, files it may touch, steps, and an **acceptance check** a machine can run.

### M0 Foundations
- **T001** Create the pnpm monorepo, TypeScript config, lint, formatting and Vitest. *Check: `pnpm verify` passes.*
- **T002** Write `AGENTS.md`, `CLAUDE.md` and the CI workflow. *Check: CI runs green on an empty change.*
- **T003** Build `packages/shared` with Zod schemas for ids, NPC card, event, crisis, secret, clue, Run Bible and Director output. *Check: schema tests and sample fixtures pass.*
- **T004** Create the Supabase project config and migrations for the tables in section 10. *Check: migration runs locally.*

### M1 Headless engine and data
- **T005** Engine core: time, seasons, weather, stats, seeded RNG. *Check: a 30-day headless sim runs and is deterministic.*
- **T006** Inventory, gathering, crafting, recipes from data. *Check: scripted scenarios pass.*
- **T007** Combat and enemy state machine. *Check: simulated fights stay within balance bounds.*
- **T008** NPC schedules, village stats and thresholds. *Check: threshold events fire in a sim.*
- **T009** Event runner with role slots and the effect vocabulary. *Check: the same event plays with 3 different slot assignments.*
- **T010** Content package: loaders, linters, coverage report, and the 8-NPC starter cast. *Check: linter passes, coverage report prints.*

### M2 Playable client without any LLM
- **T011** Phaser boot, pixel-perfect scaling, asset loader and manifest linter. *Check: Playwright smoke test loads the title screen.*
- **T012** Map compiler and the village map. *Check: map renders and collision tests pass.*
- **T013** Player movement, camera, interaction, HUD. *Check: Playwright walks the player to a resource node and gathers.*
- **T014** Crafting, inventory UI, save/load. *Check: save, reload and state-equality test.*
- **T015** NPCs with schedules and template-based dialogue (fallback lines). *Check: a full day plays with no LLM.*
- **T016** Day and night, weather, music and SFX hooks. *Check: audio manifest check and visual snapshot.*

### M3 LLM layer with mocks
- **T017** Provider adapter, prompt registry, fixtures and mock mode. *Check: all prompts run against fixtures.*
- **T018** Supabase `llm-proxy` function with caps, cache, call log and kill switch. *Check: cap and kill-switch tests pass.*
- **T019** Fallback Director and fallback Run Bible builder. *Check: 1,000 headless runs complete with no LLM; divergence judge (mock) passes the gate.*
- **T020** Director integration into the engine (decision points, pre-generation). *Check: a full run with mocked Director output.*
- **T021** Typed-input sanitizer and injection tests. *Check: a corpus of attack strings never changes game state.*
- **T022** Cost meter and budget dashboard (a simple page or CLI). *Check: cost per simulated run is printed.*

### M4 Run Bible and onboarding
- **T023** Campfire Prelude scene and question flow. *Check: Playwright completes the prelude.*
- **T024** P1 and P2 integration, Seed Deck, fingerprint check. *Check: validator rejects bad bibles in tests.*
- **T025** Spawn and first-scene instantiation from the bible. *Check: 10 different bibles produce 10 visibly different openings.*
- **T026** Divergence eval harness with persona bots (real LLM, small and capped). *Check: report with average divergence per axis.*

### M5 Living world
- **T027** P4 dialogue integration with caching and templates as fallback. *Check: latency budget and cache hit rate printed.*
- **T028** P5 memory and rumor engine and the journal UI. *Check: a rumor mutates across a sim.*
- **T029** Dilemmas, lifelines, stance quota and archetype tracking. *Check: stance mix is within 10% of the target across 200 sim runs.*

### M6 Community and closing
- **T030** P6 daily modifier and the shared table. *Check: function test.*
- **T031** P7a ghost legends: write at run end, place monuments in later runs. *Check: a legend from run A appears in run B.*
- **T032** P7b Chronicle viewer and share image export. *Check: a Chronicle renders for 5 fixture runs.*
- **T033** Endings and the title reveal. *Check: every ending family reachable in a sim.*

### M7 Hardening and release
- **T034** Continuity checker (dead NPCs, contradictions) over simulated logs. *Check: zero violations across 500 runs.*
- **T035** Content gap harvesting loop. *Check: gaps are logged, and a content task consumes them.*
- **T036** PWA build and Capacitor Android wrapper. *Check: debug APK builds and boots.*
- **T037** Performance and accessibility pass (text size, colorblind-safe cues, pause, input remap). *Check: budgets and checklist met.*
- **T038** Store assets, privacy policy draft and release checklist. *Check: checklist complete.*

---

## 12. Human checkpoints (everything else is agent work)

| # | Checkpoint | Why a human is needed |
|---|---|---|
| 1 | **Accounts and keys:** Supabase, hosting, LLM provider, GitHub | Credentials cannot be created by an agent |
| 2 | **Style board:** palette, asset packs, font, license check | Taste and legal responsibility |
| 3 | **Cast and tone approval:** the 8 NPCs, the village, the writing style | The soul of the game |
| 4 | **Read 10 Run Bibles and 10 Chronicles from the bots** (end of M4 and M6) | Only a human can judge whether they feel *fresh* and not merely different |
| 5 | **Real playtest:** 5 people, then compare notes. The success test is whether they disagree about the villain | The USP can only be proven by people |
| 6 | **Budget decisions:** model choice, caps, price of a session | Money |
| 7 | **Legal and store:** licenses, privacy policy, store listing | Responsibility |
| 8 | **Final art polish** of anything that looks off | The linter cannot judge beauty |

---

## 13. `AGENTS.md` (copy this into the repo root)

```markdown
# AGENTS.md: rules for every AI agent working on Hollowmere

## Project
Hollowmere is a 2D pixel survival RPG with an LLM "Story Director".
Read README.md (idea), docs/BUILD_PLAN.md (how to build) and docs/PROMPTS.md (prompt design) first.

## Hard constraints
- 2D pixel art only. No 3D tools, engines or assets.
- TypeScript everywhere. pnpm workspaces.
- The game engine (packages/engine) is headless and must never import Phaser or any graphics code.
- Never put an API key in the client or in the repo. LLM calls go through supabase/functions/llm-proxy.
- Never let the LLM own game mechanics. It may only return ids that exist in the content library.
- IDs are lowercase snake_case and unique.
- Events use role slots, not hard-coded NPC ids.

## Working rules
- Take one task from docs/tasks/ at a time. Touch only the files that task lists.
- Contracts live in packages/shared. A change there needs: updated tests, updated docs, and the label `contract-change`.
- Run `pnpm verify` (lint, typecheck, tests, content lint, asset lint) before every commit. It must pass.
- LLM tests use recorded fixtures. Do not call a real model in unit tests.
- Do not edit a prompt in docs/PROMPTS.md or packages/director/prompts without running the fixture tests and the divergence eval.
- Every new asset needs an entry in assets/manifest.json with its license and source.
- Pixel rules: 16x16 tiles, shared palette, nearest-neighbor, whole-number scaling.

## Definition of done
Acceptance check from the task file passes, `pnpm verify` is green, docs are updated, and the change is described in one short paragraph.

## Parallel lanes (do not cross)
A Engine and client: packages/engine, apps/game
B Content: packages/content
C LLM and backend: packages/director, supabase/
D Art and audio pipeline: assets/, tools/
E QA and evals: packages/evals, tests

## When stuck
Write the blocker in docs/tasks/BLOCKERS.md with what you tried, then move to the next task. Do not guess at credentials or licenses.
```

---

## 14. Kickoff prompts for your agent tool

**Start the project**

```text
Read README.md, docs/BUILD_PLAN.md, docs/PROMPTS.md and AGENTS.md.
Set up Milestone M0 (tasks T001 to T004). Create the task files in docs/tasks/ for the whole plan first,
one file per task, each with goal, allowed files and a machine-checkable acceptance check.
Then implement T001 to T004. Run pnpm verify after each. Stop and summarise when M0 is green.
```

**Continue**

```text
Open docs/tasks/ and take the lowest-numbered task that is not done.
Follow AGENTS.md. Implement it, run its acceptance check and pnpm verify, mark it done, then take the next one.
Stop at the end of the current milestone and write a short report: what was built, what is risky, what needs a human checkpoint.
```

**Run lanes in parallel (tools that support multiple agents)**

```text
You are the <Lane A/B/C/D/E> agent. Only touch your lane's directories (see AGENTS.md).
Work through your lane's tasks for the current milestone. If you need a contract change, stop and open a contract-change request instead of editing packages/shared.
```

---

## 15. Money: do not mix runtime credits with build costs

Your **$50 of LLM credits** should pay for **players**. Agentic coding tools consume their own credits or subscription, and evals can quietly eat your runtime budget.

Suggested split (adjust to your situation):
- **About $8 to $10:** development and evals (mock everything else, run real evals only at milestones)
- **About $5:** one-time generation of the fallback dialogue bank and content drafts
- **The rest:** live play, with caps

If your credits are only for the game and building uses a separate plan, ignore the first line and keep the same caps.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Pixel art looks inconsistent | One palette, asset packs from a few sources, linter, human polish at checkpoint 8 |
| Runs feel different but not *fresh* | Seed Deck, stance mix, fingerprints, human review at checkpoint 4 |
| Library too small, so repeats | Role-slot events, gap harvesting, coverage report |
| Costs spike | Caps, caching, small models, kill switch, fallback |
| Agent drift between lanes | Contracts package, lane rules, CI |
| Prompt injection through typed text | `<player_text>` wrapping, sanitizer, id-only outputs, validator |
| Latency | Pre-generation, small models, templates as instant fallback |
| License problems with assets | Manifest with license per file, human check at checkpoint 2 |
