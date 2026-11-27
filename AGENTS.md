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
