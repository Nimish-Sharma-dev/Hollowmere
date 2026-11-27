import { PHASES, SEASONS, VILLAGE_STATS, isId } from '../../shared/src/index.ts';
import type { ContentBundle, EventDef, Id, VillageStat } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import { addItem } from './inventory.ts';
import { Rng } from './rng.ts';
import { currentDay, currentPhase, currentSeason, fail, scheduleEvent, withRng } from './state.ts';
import type { EventLogEntry, GameState, Result, ScheduledEvent } from './state.ts';
import { startTickOfDay } from './time.ts';
import { adjustTrust, adjustVillage, checkThresholds } from './village.ts';

/* ───────────── effect vocabulary (small and fixed; the engine owns this list) ───────────── */

export type Effect =
  | { kind: 'village'; stat: VillageStat; delta: number }
  | { kind: 'trust'; slot: string; delta: number }
  | { kind: 'flag'; id: string }
  | { kind: 'spawn'; slot: string; location: Id }
  | { kind: 'give'; item: Id; qty: number }
  | { kind: 'dilemma'; id: Id }
  | { kind: 'clue'; id: Id }
  | { kind: 'schedule'; event: Id; days: number };

const NUM = '([+-]\\d+(?:\\.\\d+)?)';
const ID = '([a-z][a-z0-9_]*)';
const RE = {
  village: new RegExp(`^village\\.(hope|fear|hunger|trust|unity) ${NUM}$`),
  trust: new RegExp(`^npc\\[${ID}\\]\\.trust ${NUM}$`),
  flag: new RegExp(`^flag\\.set ${ID}$`),
  spawn: new RegExp(`^spawn npc\\[${ID}\\] at ${ID}$`),
  give: new RegExp(`^give item ${ID}(?: (\\d+))?$`),
  dilemma: new RegExp(`^start dilemma ${ID}$`),
  clue: new RegExp(`^plant clue ${ID}$`),
  schedule: new RegExp(`^schedule event ${ID} in (\\d+)$`),
};

export function parseEffect(text: string): Result<{ effect: Effect }> {
  let m: RegExpMatchArray | null;
  if ((m = RE.village.exec(text))) return { ok: true, effect: { kind: 'village', stat: m[1] as VillageStat, delta: Number(m[2]) } };
  if ((m = RE.trust.exec(text))) return { ok: true, effect: { kind: 'trust', slot: m[1]!, delta: Number(m[2]) } };
  if ((m = RE.flag.exec(text))) return { ok: true, effect: { kind: 'flag', id: m[1]! } };
  if ((m = RE.spawn.exec(text))) return { ok: true, effect: { kind: 'spawn', slot: m[1]!, location: m[2]! } };
  if ((m = RE.give.exec(text))) return { ok: true, effect: { kind: 'give', item: m[1]!, qty: m[2] ? Number(m[2]) : 1 } };
  if ((m = RE.dilemma.exec(text))) return { ok: true, effect: { kind: 'dilemma', id: m[1]! } };
  if ((m = RE.clue.exec(text))) return { ok: true, effect: { kind: 'clue', id: m[1]! } };
  if ((m = RE.schedule.exec(text))) return { ok: true, effect: { kind: 'schedule', event: m[1]!, days: Number(m[2]) } };
  return fail(`unknown_effect: ${text}`);
}

/* ───────────── validation (reused by the content linter in T010) ───────────── */

/** Returns a list of human-readable problems; empty means the event is valid against this content. */
export function validateEvent(ev: EventDef, content: ContentBundle): string[] {
  const errs: string[] = [];
  const where = `event ${ev.id}`;
  if (!isId(ev.id)) errs.push(`${where}: id is not snake_case`);
  const slotNames = Object.keys(ev.slots);
  for (const s of slotNames) {
    if (!isId(s)) errs.push(`${where}: slot name "${s}" is not snake_case`);
    if (ev.slots[s]!.roles.length === 0) errs.push(`${where}: slot "${s}" has no roles`);
  }
  for (const text of ev.effects) {
    const p = parseEffect(text);
    if (!p.ok) {
      errs.push(`${where}: ${p.reason}`);
      continue;
    }
    const e = p.effect;
    if ((e.kind === 'trust' || e.kind === 'spawn') && !(e.slot in ev.slots)) errs.push(`${where}: effect "${text}" uses unknown slot "${e.slot}"`);
    if (e.kind === 'spawn' && !content.locations.includes(e.location)) errs.push(`${where}: effect "${text}" uses unknown location`);
    if (e.kind === 'give' && !content.items[e.item]) errs.push(`${where}: effect "${text}" gives unknown item`);
    if (e.kind === 'schedule' && !content.events[e.event]) errs.push(`${where}: effect "${text}" schedules unknown event`);
  }
  for (const beat of ev.beats) {
    for (const m of beat.matchAll(/\{([^}]*)\}/g)) {
      if (!(m[1]! in ev.slots)) errs.push(`${where}: beat uses unknown placeholder {${m[1]}}`);
    }
  }
  const rq = ev.requirements;
  if (rq) {
    for (const p of rq.phase ?? []) if (!(PHASES as readonly string[]).includes(p)) errs.push(`${where}: bad phase ${p}`);
    for (const s of rq.season ?? []) if (!(SEASONS as readonly string[]).includes(s)) errs.push(`${where}: bad season ${s}`);
    for (const v of rq.village ?? []) if (!(VILLAGE_STATS as readonly string[]).includes(v.stat)) errs.push(`${where}: bad village stat ${v.stat}`);
  }
  return errs;
}

/* ───────────── requirements and slot assignment ───────────── */

export function checkRequirements(ev: EventDef, state: GameState): Result<object> {
  const day = currentDay(state);
  if ((state.eventCooldown[ev.id] ?? 0) > day) return fail('cooldown');
  if (ev.maxRuns !== undefined && (state.eventRuns[ev.id] ?? 0) >= ev.maxRuns) return fail('max_runs');
  const rq = ev.requirements;
  if (!rq) return { ok: true };
  if (rq.phase && !rq.phase.includes(currentPhase(state))) return fail('phase');
  if (rq.season && !rq.season.includes(currentSeason(state))) return fail('season');
  if (rq.minDay !== undefined && day < rq.minDay) return fail('min_day');
  if (rq.maxDay !== undefined && day > rq.maxDay) return fail('max_day');
  for (const f of rq.flagsAll ?? []) if (!state.flags[f]) return fail(`flag_missing:${f}`);
  for (const f of rq.flagsNone ?? []) if (state.flags[f]) return fail(`flag_present:${f}`);
  for (const v of rq.village ?? []) {
    const x = state.village[v.stat];
    if (v.min !== undefined && x < v.min) return fail(`village_${v.stat}_low`);
    if (v.max !== undefined && x > v.max) return fail(`village_${v.stat}_high`);
  }
  return { ok: true };
}

/** NPCs (sorted by id) that are alive and whose run role fits the slot. */
export function eligibleNpcs(ev: EventDef, slot: string, state: GameState): Id[] {
  const def = ev.slots[slot];
  if (!def) return [];
  return Object.keys(state.npcs)
    .sort()
    .filter((id) => {
      const n = state.npcs[id]!;
      return n.alive && n.role !== null && def.roles.includes(n.role);
    });
}

/** Depth-first search over sorted slots; `order` decides the candidate order per slot. */
function search(ev: EventDef, state: GameState, order: (cands: Id[]) => Id[], limit: number): Record<string, Id>[] {
  const slots = Object.keys(ev.slots).sort();
  const results: Record<string, Id>[] = [];
  const current: Record<string, Id> = {};
  const used = new Set<Id>();
  const go = (i: number): void => {
    if (results.length >= limit) return;
    if (i === slots.length) {
      results.push({ ...current });
      return;
    }
    const slot = slots[i]!;
    for (const id of order(eligibleNpcs(ev, slot, state))) {
      if (used.has(id)) continue;
      used.add(id);
      current[slot] = id;
      go(i + 1);
      used.delete(id);
      delete current[slot];
      if (results.length >= limit) return;
    }
  };
  go(0);
  return results;
}

/** One valid assignment chosen with the supplied RNG (deterministic), or null. */
export function assignSlots(ev: EventDef, state: GameState, rng: Rng): Record<string, Id> | null {
  return search(ev, state, (c) => rng.shuffle(c), 1)[0] ?? null;
}

/** Up to `limit` distinct valid assignments in a stable order. */
export function enumerateAssignments(ev: EventDef, state: GameState, limit = 50): Record<string, Id>[] {
  return search(ev, state, (c) => c, limit);
}

export function validateAssignment(ev: EventDef, state: GameState, assignment: Record<string, Id>): Result<object> {
  const slots = Object.keys(ev.slots);
  const given = Object.keys(assignment);
  if (given.length !== slots.length || !slots.every((s) => s in assignment)) return fail('assignment_slots_mismatch');
  const seen = new Set<Id>();
  for (const s of slots) {
    const id = assignment[s]!;
    if (seen.has(id)) return fail('assignment_duplicate_npc');
    seen.add(id);
    if (!eligibleNpcs(ev, s, state).includes(id)) return fail(`assignment_ineligible:${s}`);
  }
  return { ok: true };
}

/* ───────────── running events ───────────── */

export function renderBeats(ev: EventDef, content: ContentBundle, assignment: Record<string, Id>): string[] {
  return ev.beats.map((b) => b.replace(/\{([^}]*)\}/g, (_m, slot: string) => content.npcs[assignment[slot] ?? '']?.name ?? slot));
}

function applyEffect(state: GameState, content: ContentBundle, e: Effect, assignment: Record<string, Id>): void {
  switch (e.kind) {
    case 'village':
      adjustVillage(state, e.stat, e.delta);
      break;
    case 'trust':
      adjustTrust(state, assignment[e.slot]!, e.delta);
      break;
    case 'flag':
      state.flags[e.id] = true;
      break;
    case 'spawn': {
      const npc = state.npcs[assignment[e.slot]!];
      if (npc) npc.override = { location: e.location, untilTick: startTickOfDay(currentDay(state) + 1) };
      break;
    }
    case 'give': {
      const def = content.items[e.item];
      if (def) addItem(state.player.inventory, def, e.qty); // overflow is dropped on the ground
      break;
    }
    case 'dilemma':
      if (!state.pendingDilemmas.includes(e.id)) state.pendingDilemmas.push(e.id);
      break;
    case 'clue':
      if (!state.plantedClues.includes(e.id)) state.plantedClues.push(e.id);
      break;
    case 'schedule':
      scheduleEvent(state, e.event, currentDay(state) + e.days, 'event');
      break;
  }
}

export interface RunEventOptions {
  /** a Director-chosen assignment; validated before use */
  assignment?: Record<string, Id>;
  /** skip requirement checks (never skips validation or slot eligibility) */
  force?: boolean;
}

export function runEvent(state: GameState, content: ContentBundle, eventId: Id, opts: RunEventOptions = {}): Result<{ entry: EventLogEntry }> {
  const ev = content.events[eventId];
  if (!ev) return fail('unknown_event');
  const problems = validateEvent(ev, content);
  if (problems.length > 0) return fail(`invalid_event: ${problems[0]}`);
  if (!opts.force) {
    const req = checkRequirements(ev, state);
    if (!req.ok) return fail(`requirements: ${req.reason}`);
  }
  let assignment: Record<string, Id>;
  if (opts.assignment) {
    const v = validateAssignment(ev, state, opts.assignment);
    if (!v.ok) return fail(v.reason);
    assignment = { ...opts.assignment };
  } else {
    const picked = withRng(state, (rng) => assignSlots(ev, state, rng));
    if (!picked) return fail('no_valid_assignment');
    assignment = picked;
  }

  for (const text of ev.effects) {
    const p = parseEffect(text);
    if (p.ok) applyEffect(state, content, p.effect, assignment);
  }
  const day = currentDay(state);
  const entry: EventLogEntry = {
    tick: state.tick,
    day,
    eventId,
    assignment,
    effects: [...ev.effects],
    text: renderBeats(ev, content, assignment),
  };
  state.eventLog.push(entry);
  state.eventRuns[eventId] = (state.eventRuns[eventId] ?? 0) + 1;
  if (ev.cooldownDays) state.eventCooldown[eventId] = day + ev.cooldownDays;
  checkThresholds(state, content);
  return { ok: true, entry };
}

/**
 * Run every scheduled event that is due (day <= today). A blocked event stays queued and is
 * retried on every tick, so phase-gated events can still fire later the same day. Each distinct
 * day on which it stays blocked counts as one attempt; after CONFIG.events.maxDeferDays attempts
 * it is dropped and recorded in `state.skipped`.
 */
export function runDueEvents(state: GameState, content: ContentBundle): EventLogEntry[] {
  const ran: EventLogEntry[] = [];
  const tried = new Set<ScheduledEvent>();
  for (let guard = 0; guard < CONFIG.events.maxChainPerTick; guard++) {
    const day = currentDay(state);
    let pick: ScheduledEvent | null = null;
    for (const s of state.scheduled) {
      if (s.day > day || tried.has(s)) continue;
      if (pick === null || s.day < pick.day || (s.day === pick.day && s.eventId < pick.eventId)) pick = s;
    }
    if (pick === null) break;
    tried.add(pick);
    const res = runEvent(state, content, pick.eventId);
    const idx = state.scheduled.indexOf(pick);
    if (res.ok) {
      state.scheduled.splice(idx, 1);
      ran.push(res.entry);
    } else if (pick.lastTriedDay !== day) {
      pick.lastTriedDay = day;
      pick.attempts += 1;
      if (pick.attempts >= CONFIG.events.maxDeferDays) {
        state.scheduled.splice(idx, 1);
        state.skipped.push({ day, eventId: pick.eventId, reason: res.reason });
      }
    }
  }
  return ran;
}
