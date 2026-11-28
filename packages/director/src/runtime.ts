import type { ContentBundle, Id, Season } from '../../shared/src/index.ts';
import { runEvent } from '../../engine/src/events.ts';
import { checkInvariants } from '../../engine/src/invariants.ts';
import { hashState } from '../../engine/src/rng.ts';
import { survivalBot } from '../../engine/src/sim.ts';
import type { Policy } from '../../engine/src/sim.ts';
import { perform } from '../../engine/src/actions.ts';
import { cloneState, createGame, currentDay, currentPhase, currentSeason } from '../../engine/src/state.ts';
import type { GameState } from '../../engine/src/state.ts';
import { startTickOfDay } from '../../engine/src/time.ts';
import { advance } from '../../engine/src/world.ts';
import { buildFallbackBible, profileKeyOf } from './bible.ts';
import type { OnboardingProfile, RunBible } from './bible.ts';
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { fallbackDirector, listEligible, newDirectorMemory, stressSignals, validateDirectorOutput, STANCE_TARGET } from './director.ts';
import type { DirectorInput, DirectorMemory, DirectorOutput } from './director.ts';
import type { Lore } from './lore.ts';
import type { RecentRun } from './fingerprint.ts';

const SEASON_OF: Record<string, Season> = { spring_mist: 'spring', summer_haze: 'summer', autumn_rain: 'autumn', first_snow: 'winter', deep_winter: 'winter', thaw: 'spring' };

export const DEFAULT_NODES: { id: Id; def: Id }[] = [
  { id: 'oak_01', def: 'oak_tree' }, { id: 'oak_02', def: 'oak_tree' }, { id: 'oak_03', def: 'oak_tree' },
  { id: 'bush_01', def: 'berry_bush' }, { id: 'bush_02', def: 'berry_bush' }, { id: 'bush_03', def: 'berry_bush' },
  { id: 'stone_01', def: 'stone_outcrop' }, { id: 'stone_02', def: 'stone_outcrop' }, { id: 'iron_01', def: 'iron_vein' },
];

/** Turn a validated Run Bible into a fresh engine state: roles, kit, village stats, attitudes. */
export function startGameFromBible(content: ContentBundle, lore: Lore, bible: RunBible, seed: number, nodes = DEFAULT_NODES): GameState {
  const kit = lore.kits[bible.start.kit_id]!;
  const items = [{ item: 'axe', qty: 1 }, { item: 'pickaxe', qty: 1 }, ...kit.items];
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.item, (merged.get(i.item) ?? 0) + i.qty);
  const state = createGame(content, {
    seed,
    startSeason: SEASON_OF[bible.start.weather_season_id] ?? 'spring',
    startItems: [...merged].map(([item, qty]) => ({ item, qty: content.items[item]?.stack === 1 ? 1 : qty })),
    nodes,
    npcRoles: Object.fromEntries(bible.cast_roles.map((c) => [c.npc_id, c.role_id])),
    equipped: { clothing: merged.has('wool_coat') ? 'wool_coat' : null, weapon: merged.has('sword') ? 'sword' : null },
  });
  Object.assign(state.village, bible.start.village_stats);
  for (const c of bible.cast_roles) state.npcs[c.npc_id]!.trust = c.initial_attitude;
  return state;
}

export interface DecisionLog {
  tick: number;
  day: number;
  kind: 'day_start' | 'evening' | 'major';
  eventId: Id | null;
  stance: string | null;
  source: 'llm' | 'pregenerated' | 'fallback' | 'none';
  reason: string | null;
}

function trimBible(b: RunBible): unknown {
  return { crisis: b.crisis.crisis_id, fingerprint: b.fingerprint, cast: b.cast_roles.map((c) => ({ npc: c.npc_id, role: c.role_id, attitude: c.initial_attitude })), arc: b.arc, clock_days: b.crisis.clock_days };
}

/** One Director decision: try the model (if any), validate hard, fall back to code. */
export async function decide(input: DirectorInput, client: LlmClient | null, records: CallRecord[]): Promise<{ out: DirectorOutput | null; source: 'llm' | 'fallback' | 'none'; reason: string | null }> {
  const eligible = listEligible(input.state, input.content);
  if (eligible.length === 0) return { out: null, source: 'none', reason: 'no_eligible_events' };
  let reason: string | null = 'no_client';
  if (client) {
    const { state, memory } = input;
    const res = await client.complete('P3', {
      run_bible: trimBible(input.bible),
      player_profile: { behaviour_tags: input.behaviourTags ?? [] },
      world_state: { day: currentDay(state), phase: currentPhase(state), season: currentSeason(state), village: state.village, weather: state.weather, stats: state.player.stats },
      stress_signals: stressSignals(state, memory),
      last_beats: memory.beats.slice(-3),
      eligible_events: eligible,
      stance_quota: { target: STANCE_TARGET, counts: memory.stanceCounts },
      director_seed: input.seed,
      decision_point: input.decision,
    });
    records.push(...res.records);
    if (res.ok) {
      const v = validateDirectorOutput(res.json, { state, content: input.content, lore: input.lore, eligible, memory, behaviourTags: input.behaviourTags });
      if (v.ok && v.output) return { out: v.output, source: 'llm', reason: null };
      reason = `rejected: ${v.errors[0]}`;
    } else reason = res.reason;
    for (const r of res.records) r.fallbackUsed = true;
  }
  return { out: fallbackDirector(input), source: 'fallback', reason };
}

/** Apply a validated Director output to the world. */
export function applyDirectorOutput(state: GameState, content: ContentBundle, out: DirectorOutput, memory: DirectorMemory): boolean {
  const r = runEvent(state, content, out.chosen_event_id, { assignment: out.slot_assignments });
  if (!r.ok) return false;
  for (const n of out.npc_spawns) {
    const npc = state.npcs[n];
    if (npc) npc.override = { location: content.npcs[n]!.gather, untilTick: startTickOfDay(currentDay(state) + 1) };
  }
  state.modifiers.hungerMult = Math.max(0.9, Math.min(1.1, 1 + 0.1 * out.difficulty_adjust));
  if (out.foreshadow_clue_id && !state.plantedClues.includes(out.foreshadow_clue_id)) {
    state.plantedClues.push(out.foreshadow_clue_id);
    memory.foreshadowed = true;
  }
  memory.beats.push({ event_id: out.chosen_event_id, tags: content.events[out.chosen_event_id]!.tags, stance: out.stance, day: currentDay(state) });
  memory.stanceCounts[out.stance]++;
  return true;
}

export interface DirectedOptions {
  seed: number;
  days: number;
  client?: LlmClient | null;
  profile?: OnboardingProfile | null;
  recents?: RecentRun[];
  /** supply a bible to skip building one */
  bible?: RunBible;
  policy?: Policy;
  behaviourTags?: string[];
  /** called just before each Director decision (lets tests script a mock model) */
  beforeDecide?: (input: DirectorInput) => void;
}

export interface DirectedResult {
  state: GameState;
  bible: RunBible;
  memory: DirectorMemory;
  decisions: DecisionLog[];
  records: CallRecord[];
  violations: string[];
  profileKey: string;
  finalHash: string;
  pregenUsed: number;
}

/** A whole game with the Director in charge of story events. Works with no client at all. */
export async function runDirectedGame(content: ContentBundle, lore: Lore, opts: DirectedOptions): Promise<DirectedResult> {
  const built = opts.bible ? null : buildFallbackBible(content, lore, { seed: opts.seed, recents: opts.recents, profile: opts.profile });
  const bible = opts.bible ?? built!.bible;
  const state = startGameFromBible(content, lore, bible, opts.seed);
  const memory = newDirectorMemory();
  const policy = opts.policy ?? survivalBot;
  const client = opts.client ?? null;
  const decisions: DecisionLog[] = [];
  const records: CallRecord[] = [];
  const violations: string[] = [];
  let pending: { day: number; out: DirectorOutput } | null = null;
  let pregenUsed = 0;
  let nextDecision = 0;
  const T = 240;
  const endTick = opts.days * T;

  while (state.tick < endTick) {
    if (state.tick >= nextDecision) {
      const day = currentDay(state);
      const kind: DecisionLog['kind'] = state.tick % T < 144 ? 'day_start' : 'evening';
      const input: DirectorInput = { state, content, lore, bible, memory, decision: { kind, day }, seed: opts.seed, behaviourTags: opts.behaviourTags };
      let out: DirectorOutput | null = null;
      let source: DecisionLog['source'] = 'none';
      let reason: string | null = null;
      if (kind === 'day_start' && pending && pending.day === day) {
        // use the beat generated last evening if it is still valid today
        const eligible = listEligible(state, content);
        const v = validateDirectorOutput(pending.out, { state, content, lore, eligible, memory });
        if (v.ok && v.output) {
          out = v.output;
          source = 'pregenerated';
          pregenUsed++;
        }
      }
      pending = null;
      if (!out) {
        opts.beforeDecide?.(input);
        const d = await decide(input, client, records);
        out = d.out;
        source = d.source;
        reason = d.reason;
      }
      const applied = out ? applyDirectorOutput(state, content, out, memory) : false;
      decisions.push({ tick: state.tick, day, kind, eventId: applied && out ? out.chosen_event_id : null, stance: applied && out ? out.stance : null, source: applied ? source : 'none', reason: applied ? reason : reason ?? 'apply_failed' });
      if (kind === 'evening' && client) {
        // pre-generation: write tomorrow morning's beat now, in the background of the evening
        // judge eligibility as of tomorrow morning (day number, phase, cooldowns), on a copy of the world
        const preview = cloneState(state);
        preview.tick = startTickOfDay(day + 1);
        const nextInput: DirectorInput = { ...input, state: preview, decision: { kind: 'day_start', day: day + 1 } };
        opts.beforeDecide?.(nextInput);
        const d = await decide(nextInput, client, records);
        if (d.out && d.source === 'llm') pending = { day: day + 1, out: d.out };
      }
      nextDecision = kind === 'day_start' ? startTickOfDay(day) + 144 : startTickOfDay(day + 1);
    }
    if (state.player.alive) {
      const a = policy(state, content);
      const res = a ? perform(state, content, a) : ({ ok: false } as const);
      if (!res.ok) advance(state, content, 1, 'idle');
    } else advance(state, content, 1, 'idle');
    for (const v of checkInvariants(state, content)) violations.push(`tick ${state.tick}: ${v}`);
    if (violations.length > 20) break;
  }
  return { state, bible, memory, decisions, records, violations, profileKey: profileKeyOf(opts.profile), finalHash: hashState(state), pregenUsed };
}
