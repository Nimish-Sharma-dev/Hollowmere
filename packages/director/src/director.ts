import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { assignSlots, checkRequirements, eligibleNpcs, validateAssignment } from '../../engine/src/events.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import { currentDay } from '../../engine/src/state.ts';
import type { GameState } from '../../engine/src/state.ts';
import type { RunBible } from './bible.ts';
import type { Lore } from './lore.ts';
import { P3_SCHEMA, STANCES } from './schemas.ts';
import { validate } from './schema.ts';

export type Stance = (typeof STANCES)[number];

export interface EligibleEvent {
  id: Id;
  tags: string[];
  /** NPCs that could fill each slot right now */
  slots: Record<string, Id[]>;
}

export interface Beat {
  event_id: Id;
  tags: string[];
  stance: Stance;
  day: number;
}

/** Director state that lives beside the engine state (serialize it with the save). */
export interface DirectorMemory {
  beats: Beat[];
  stanceCounts: Record<Stance, number>;
  foreshadowed: boolean;
}

export const newDirectorMemory = (): DirectorMemory => ({ beats: [], stanceCounts: { mirror: 0, challenge: 0, wildcard: 0 }, foreshadowed: false });

export const STANCE_TARGET: Record<Stance, number> = { mirror: 0.4, challenge: 0.4, wildcard: 0.2 };
/** after this many decisions the quota is enforced */
export const QUOTA_MIN_DECISIONS = 8;
export const QUOTA_TOLERANCE = 0.10;

export interface DirectorOutput {
  diagnosis: string;
  options_considered: { event_id: Id; stance: Stance; pitch: string; risk: string }[];
  chosen_event_id: Id;
  stance: Stance;
  slot_assignments: Record<string, Id>;
  npc_spawns: Id[];
  tone: string;
  difficulty_adjust: number;
  dilemma_template_id: Id | null;
  rumor_seed: string | null;
  foreshadow_clue_id: Id | null;
  player_facing_cause: string;
  plan_ahead: string[];
  library_gap: string[];
}

export interface DirectorInput {
  state: GameState;
  content: ContentBundle;
  lore: Lore;
  bible: RunBible;
  memory: DirectorMemory;
  decision: { kind: 'day_start' | 'evening' | 'major'; day: number };
  seed: number;
  /** tags describing what the player has been doing (from their actions), used for the mirror stance */
  behaviourTags?: string[];
}

const CHALLENGE_TAGS = ['conflict', 'crime', 'secret', 'escalation', 'confrontation'];
const MIRROR_TAGS = ['kindness', 'relief'];
const LIFELINE_TAGS = ['relief', 'kindness'];
const isCrisisTag = (t: string): boolean => t.startsWith('crisis_');

/** Events whose requirements hold now and that have at least one valid slot assignment. */
export function listEligible(state: GameState, content: ContentBundle): EligibleEvent[] {
  const out: EligibleEvent[] = [];
  for (const id of Object.keys(content.events).sort()) {
    const ev = content.events[id]!;
    if (ev.tags.includes('threshold')) continue; // threshold events fire from village stats, not from the Director
    if (!checkRequirements(ev, state).ok) continue;
    if (!assignSlots(ev, state, new Rng(1))) continue;
    out.push({ id, tags: ev.tags, slots: Object.fromEntries(Object.keys(ev.slots).sort().map((s) => [s, eligibleNpcs(ev, s, state)])) });
  }
  return out;
}

export function classify(tags: string[], behaviour: string[]): Stance {
  const hit = tags.some((t) => behaviour.includes(t));
  if (hit || tags.some((t) => MIRROR_TAGS.includes(t))) return 'mirror';
  if (tags.some((t) => CHALLENGE_TAGS.includes(t))) return 'challenge';
  return 'wildcard';
}

export function stressSignals(state: GameState, memory: DirectorMemory): { nearCollapse: boolean; lowTensionBeats: number } {
  const st = state.player.stats;
  const v = state.village;
  const nearCollapse = st.health < 35 || st.hunger < 20 || st.warmth < 25 || v.hunger >= 8.5 || v.hope <= 1.5 || v.unity <= 1.5;
  let calm = 0;
  for (let i = memory.beats.length - 1; i >= 0; i--) {
    if (memory.beats[i]!.tags.some((t) => CHALLENGE_TAGS.includes(t))) break;
    calm++;
  }
  return { nearCollapse, lowTensionBeats: calm };
}

/** Would choosing `stance` now push it past its quota band? Only enforced after QUOTA_MIN_DECISIONS. */
export function quotaViolation(memory: DirectorMemory, stance: Stance): boolean {
  const total = memory.stanceCounts.mirror + memory.stanceCounts.challenge + memory.stanceCounts.wildcard;
  if (total < QUOTA_MIN_DECISIONS) return false;
  return (memory.stanceCounts[stance] + 1) / (total + 1) > STANCE_TARGET[stance] + QUOTA_TOLERANCE;
}

function overlapsRecent(tags: string[], beats: Beat[]): boolean {
  const mine = tags.filter((t) => !isCrisisTag(t));
  const hits = beats.slice(-3).filter((b) => b.tags.some((t) => !isCrisisTag(t) && mine.includes(t))).length;
  return hits >= 2;
}

/** The no-LLM Director (T019). Returns exactly the P3 shape, or null when nothing can happen. */
export function fallbackDirector(input: DirectorInput): DirectorOutput | null {
  const { state, content, lore, bible, memory } = input;
  const day = currentDay(state);
  const rng = new Rng(hashSeed(input.seed, 'director', day, input.decision.kind, memory.beats.length));
  const eligible = listEligible(state, content);
  if (eligible.length === 0) return null;
  const crisis = lore.crises[bible.crisis.crisis_id]!;
  const behaviour = input.behaviourTags ?? [];
  const stress = stressSignals(state, memory);

  // anti-repeat (relaxed if it would leave nothing)
  let pool = eligible.filter((e) => !overlapsRecent(e.tags, memory.beats) && memory.beats[memory.beats.length - 1]?.event_id !== e.id);
  if (pool.length === 0) pool = eligible;
  const stanceOf = new Map(pool.map((e) => [e.id, classify(e.tags, behaviour)]));
  const progress = day / Math.max(1, bible.crisis.clock_days);
  const actTags = progress < 1 / 3 ? bible.arc.act1_event_tags : progress < 2 / 3 ? bible.arc.act2_event_tags : bible.arc.act3_event_tags;
  const recentIds = memory.beats.slice(-6).map((b) => b.event_id);
  const score = (e: EligibleEvent): number =>
    (1 + (e.tags.includes(crisis.eventTag) ? 2 : 0) + (e.tags.some((t) => actTags.includes(t) && !isCrisisTag(t)) ? 3 : 0) + (e.tags.includes(`tone_${bible.fingerprint.tone}`) ? 0.5 : 0) + rng.next() * 0.5) / (1 + 2 * recentIds.filter((id) => id === e.id).length);

  // which stance do we want?
  const total = memory.stanceCounts.mirror + memory.stanceCounts.challenge + memory.stanceCounts.wildcard;
  // the arc tilts the stance (early acts lean gentle, the last act leans confrontational); the quota still bounds it
  const act = progress < 1 / 3 ? 1 : progress < 2 / 3 ? 2 : 3;
  const tilt: Record<Stance, number> = act === 1 ? { mirror: 0.1, challenge: -0.05, wildcard: 0 } : act === 3 ? { mirror: -0.05, challenge: 0.15, wildcard: 0 } : { mirror: 0, challenge: 0, wildcard: 0 };
  const deficits = STANCES.map((s) => ({ s, d: STANCE_TARGET[s] - (total === 0 ? 0 : memory.stanceCounts[s] / total) + tilt[s] + rng.next() * 0.05 })).sort((a, b) => b.d - a.d);
  let wanted: Stance = deficits[0]!.s;
  let diagnosis = `Balancing stances (mirror ${memory.stanceCounts.mirror}, challenge ${memory.stanceCounts.challenge}, wildcard ${memory.stanceCounts.wildcard}).`;
  if (stress.nearCollapse) {
    wanted = 'mirror';
    diagnosis = 'The player or village is close to collapse, so offer a lifeline.';
  } else if (stress.lowTensionBeats >= 3) {
    wanted = 'challenge';
    diagnosis = `Tension has been low for ${stress.lowTensionBeats} beats, so raise the stakes.`;
  }
  const pick = (stance: Stance, lifeline: boolean): EligibleEvent | null => {
    let c = pool.filter((e) => stanceOf.get(e.id) === stance);
    if (lifeline) {
      const l = pool.filter((e) => e.tags.some((t) => LIFELINE_TAGS.includes(t)));
      if (l.length) c = l;
    }
    if (c.length === 0) {
      const fromEligible = eligible.filter((e) => classify(e.tags, behaviour) === stance && memory.beats[memory.beats.length - 1]?.event_id !== e.id);
      if (fromEligible.length) c = fromEligible;
      else return null;
    }
    return rng.weighted(c.map((e) => ({ item: e, weight: score(e) })));
  };
  // honour the quota, then fall back through the other stances
  const order: Stance[] = [wanted, ...deficits.map((d) => d.s).filter((s) => s !== wanted)];
  let chosen: EligibleEvent | null = null;
  let stance: Stance = wanted;
  for (const s of order) {
    if (quotaViolation(memory, s) && !stress.nearCollapse) continue;
    const c = pick(s, stress.nearCollapse && s === 'mirror');
    if (c) {
      chosen = c;
      stance = s;
      break;
    }
  }
  if (!chosen) {
    // nothing in the anti-repeat pool keeps the quota: look at every eligible event before giving the quota up
    const compliant = eligible.filter((e) => !quotaViolation(memory, classify(e.tags, behaviour)));
    const from = stress.nearCollapse || compliant.length === 0 ? pool : compliant;
    chosen = rng.weighted(from.map((e) => ({ item: e, weight: score(e) })));
    stance = classify(chosen.tags, behaviour);
  }

  // options: the chosen event plus the best of the other stances, padded with other eligible events
  const options: DirectorOutput['options_considered'] = [{ event_id: chosen.id, stance, pitch: `Fits the ${crisis.name} arc.`, risk: stance === 'challenge' ? 'May strain trust.' : 'May feel too gentle.' }];
  for (const s of STANCES) {
    if (s === stance) continue;
    const c = pick(s, false);
    if (c && !options.some((o) => o.event_id === c.id)) options.push({ event_id: c.id, stance: s, pitch: `A ${s} alternative.`, risk: 'Different pacing.' });
  }
  for (const e of pool) {
    if (options.length >= 3) break;
    if (!options.some((o) => o.event_id === e.id)) options.push({ event_id: e.id, stance: stanceOf.get(e.id)!, pitch: 'Another eligible beat.', risk: 'Less tied to the arc.' });
  }
  // the anti-repeat filter may have left fewer than 3 events in the pool: pad from every eligible event before duplicating
  for (const e of eligible) {
    if (options.length >= 3) break;
    if (!options.some((o) => o.event_id === e.id)) options.push({ event_id: e.id, stance: classify(e.tags, behaviour), pitch: 'Held back by pacing rules.', risk: 'Would repeat recent beats.' });
  }
  while (options.length < 3) options.push({ ...options[0]! });

  const ev = content.events[chosen.id]!;
  const assignment = assignSlots(ev, state, new Rng(hashSeed(input.seed, 'slots', day, memory.beats.length)));
  if (!assignment) return null;

  // foreshadow the twist once, after the arc's midpoint
  let foreshadow: Id | null = null;
  const holder = bible.secrets.find((s) => s.holder_npc_id === bible.fingerprint.antagonist_npc_id);
  if (!memory.foreshadowed && holder && day >= Math.ceil(bible.crisis.clock_days / 2)) foreshadow = holder.clue_ids.find((c) => !state.plantedClues.includes(c)) ?? null;

  const last = memory.beats[memory.beats.length - 1];
  const name = chosen.id.replace(/_/g, ' ');
  return {
    diagnosis,
    options_considered: options.slice(0, 3),
    chosen_event_id: chosen.id,
    stance,
    slot_assignments: assignment,
    npc_spawns: [],
    tone: bible.fingerprint.tone,
    difficulty_adjust: stress.nearCollapse ? -1 : stress.lowTensionBeats >= 3 ? 1 : 0,
    dilemma_template_id: null,
    rumor_seed: null,
    foreshadow_clue_id: foreshadow,
    player_facing_cause: last ? `After ${last.event_id.replace(/_/g, ' ')}, the village is on edge, and ${name} follows.` : `As ${crisis.name.toLowerCase()} deepens, ${name} comes to the surface.`,
    plan_ahead: [`Give the village a quieter scene after ${name}.`, `Let ${crisis.eventTag.replace('crisis_', '').replace(/_/g, ' ')} press on the next day.`],
    library_gap: eligible.length < 3 ? [`only ${eligible.length} eligible event(s) at this decision point`] : [],
  };
}

/* ───────────── validation ───────────── */

export interface DirectorValidation {
  ok: boolean;
  errors: string[];
  /** the output with difficulty clamped to -2..2 (only meaningful when ok) */
  output: DirectorOutput | null;
}

/** Code-side P3 checks. The model can only choose among ids the code offered. */
export function validateDirectorOutput(raw: unknown, ctx: { state: GameState; content: ContentBundle; lore: Lore; eligible: EligibleEvent[]; memory: DirectorMemory; behaviourTags?: string[] }): DirectorValidation {
  const errors = validate(P3_SCHEMA, raw);
  if (errors.length) return { ok: false, errors, output: null };
  const out = raw as DirectorOutput;
  const err = (m: string): void => void errors.push(m);
  const ids = new Set(ctx.eligible.map((e) => e.id));
  if (!ids.has(out.chosen_event_id)) err(`chosen_event_id ${out.chosen_event_id} is not eligible`);
  for (const o of out.options_considered) if (!ids.has(o.event_id)) err(`option ${o.event_id} is not eligible`);
  const distinct = new Set(out.options_considered.map((o) => o.event_id)).size;
  if (distinct < Math.min(3, ids.size)) err(`options_considered must contain ${Math.min(3, ids.size)} distinct eligible events`);
  const chosenOpt = out.options_considered.find((o) => o.event_id === out.chosen_event_id);
  if (!chosenOpt) err('the chosen event must be one of options_considered');
  else if (chosenOpt.stance !== out.stance) err('stance does not match the chosen option');
  const ev = ctx.content.events[out.chosen_event_id];
  if (ev) {
    const v = validateAssignment(ev, ctx.state, out.slot_assignments);
    if (!v.ok) err(`slot_assignments: ${v.reason}`);
  }
  for (const n of out.npc_spawns) if (!ctx.content.npcs[n]) err(`npc_spawns names unknown NPC ${n}`);
  if (!ctx.lore.tones.includes(out.tone)) err(`unknown tone ${out.tone}`);
  if (out.foreshadow_clue_id !== null && !ctx.lore.clues[out.foreshadow_clue_id]) err(`unknown foreshadow clue ${out.foreshadow_clue_id}`);
  if (out.dilemma_template_id !== null) err('dilemma_template_id must be null until dilemma templates exist (M5)');
  if (out.rumor_seed !== null) err('rumor_seed must be null until the rumor engine exists (M5)');
  // the quota only binds when some eligible event would keep it, and never during a lifeline moment
  if (STANCES.includes(out.stance) && quotaViolation(ctx.memory, out.stance) && !stressSignals(ctx.state, ctx.memory).nearCollapse) {
    const behaviour = ctx.behaviourTags ?? [];
    if (ctx.eligible.some((e) => !quotaViolation(ctx.memory, classify(e.tags, behaviour)))) err(`stance ${out.stance} would break the 40/40/20 quota`);
  }
  if (errors.length) return { ok: false, errors, output: null };
  return { ok: true, errors: [], output: { ...out, difficulty_adjust: Math.max(-2, Math.min(2, out.difficulty_adjust)) } };
}
