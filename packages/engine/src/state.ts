import { VILLAGE_STATS, NEEDS } from '../../shared/src/index.ts';
import type { ContentBundle, Id, Need, Phase, Season, VillageStat, Weather } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import { addItem, newInventory } from './inventory.ts';
import type { Inventory, Stack } from './inventory.ts';
import { Rng } from './rng.ts';
import { dayOf, phaseOfTick, seasonOfDay } from './time.ts';
import { weatherForDay } from './weather.ts';

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };

export function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

export interface PlayerState {
  stats: Record<Need, number>;
  inventory: Inventory;
  equipped: { weapon: Id | null; clothing: Id | null };
  /** station tags currently reachable, e.g. ["fire", "shelter", "workshop"] (set by the client or bot) */
  nearby: string[];
  alive: boolean;
  deathCause: string | null;
}

export interface NpcState {
  id: Id;
  role: string | null;
  alive: boolean;
  /** -10..10 */
  trust: number;
  /** event-driven location override */
  override: { location: Id; untilTick: number } | null;
}

export interface NodeState {
  def: Id;
  usesLeft: number;
  respawnDay: number | null;
}

export interface ScheduledEvent {
  eventId: Id;
  /** run on or after this day */
  day: number;
  source: 'event' | 'threshold' | 'director';
  /** number of distinct days on which a run was attempted and blocked */
  attempts: number;
  lastTriedDay: number | null;
}

export interface EventLogEntry {
  tick: number;
  day: number;
  eventId: Id;
  assignment: Record<string, Id>;
  effects: string[];
  text: string[];
}

export interface SkippedEvent {
  day: number;
  eventId: Id;
  reason: string;
}

export interface ThresholdState {
  active: boolean;
  lastFiredDay: number | null;
  fired: number;
}

export interface GameState {
  version: 1;
  seed: number;
  startSeason: Season;
  /** main RNG stream state */
  rng: number;
  /** completed world ticks; tick 0 = day 1 morning */
  tick: number;
  weather: Weather;
  modifiers: { id: string | null; tempOffset: number; hungerMult: number };
  player: PlayerState;
  village: Record<VillageStat, number>;
  npcs: Record<Id, NpcState>;
  nodes: Record<Id, NodeState>;
  structures: { id: Id; kind: Id }[];
  flags: Record<string, true>;
  scheduled: ScheduledEvent[];
  eventCooldown: Record<Id, number>;
  eventRuns: Record<Id, number>;
  thresholds: Record<Id, ThresholdState>;
  pendingDilemmas: Id[];
  plantedClues: Id[];
  eventLog: EventLogEntry[];
  skipped: SkippedEvent[];
}

export interface NewGameOptions {
  seed: number;
  startSeason?: Season;
  startItems?: Stack[];
  /** resource node instances placed in the world */
  nodes?: { id: Id; def: Id }[];
  /** run roles per NPC; defaults to each card's first allowed role */
  npcRoles?: Record<Id, string>;
  equipped?: { weapon?: Id | null; clothing?: Id | null };
}

export function currentDay(state: GameState): number {
  return dayOf(state.tick);
}
export function currentPhase(state: GameState): Phase {
  return phaseOfTick(state.tick);
}
export function currentSeason(state: GameState): Season {
  return seasonOfDay(currentDay(state), state.startSeason);
}

/** Run fn with the main RNG stream and write the advanced state back. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rng);
  const out = fn(rng);
  state.rng = rng.s;
  return out;
}

export function createGame(content: ContentBundle, opts: NewGameOptions): GameState {
  const startSeason = opts.startSeason ?? 'spring';
  const inventory = newInventory(CONFIG.inventorySlots);
  for (const s of opts.startItems ?? []) {
    const def = content.items[s.item];
    if (!def) throw new Error(`createGame: unknown start item ${s.item}`);
    addItem(inventory, def, s.qty);
  }
  const stats = {} as Record<Need, number>;
  for (const n of NEEDS) stats[n] = CONFIG.survival.startStats[n];
  const village = {} as Record<VillageStat, number>;
  for (const v of VILLAGE_STATS) village[v] = CONFIG.village.start[v];

  const npcs: Record<Id, NpcState> = {};
  for (const id of Object.keys(content.npcs).sort()) {
    const card = content.npcs[id]!;
    npcs[id] = { id, role: opts.npcRoles?.[id] ?? card.allowedRoles[0] ?? null, alive: true, trust: 0, override: null };
  }
  const nodes: Record<Id, NodeState> = {};
  for (const n of opts.nodes ?? []) {
    const def = content.nodes[n.def];
    if (!def) throw new Error(`createGame: unknown node def ${n.def}`);
    if (nodes[n.id]) throw new Error(`createGame: duplicate node id ${n.id}`);
    nodes[n.id] = { def: n.def, usesLeft: def.uses, respawnDay: null };
  }
  const thresholds: Record<Id, ThresholdState> = {};
  for (const t of content.thresholds) thresholds[t.id] = { active: false, lastFiredDay: null, fired: 0 };

  return {
    version: 1,
    seed: opts.seed >>> 0,
    startSeason,
    rng: (opts.seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    weather: weatherForDay(opts.seed >>> 0, 1, seasonOfDay(1, startSeason)),
    modifiers: { id: null, tempOffset: 0, hungerMult: 1 },
    player: {
      stats,
      inventory,
      equipped: { weapon: opts.equipped?.weapon ?? null, clothing: opts.equipped?.clothing ?? null },
      nearby: [],
      alive: true,
      deathCause: null,
    },
    village,
    npcs,
    nodes,
    structures: [],
    flags: {},
    scheduled: [],
    eventCooldown: {},
    eventRuns: {},
    thresholds,
    pendingDilemmas: [],
    plantedClues: [],
    eventLog: [],
    skipped: [],
  };
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** Queue an event to run on/after `day`. Used by `schedule event` effects, thresholds and the Director. */
export function scheduleEvent(state: GameState, eventId: Id, day: number, source: ScheduledEvent['source']): void {
  state.scheduled.push({ eventId, day, source, attempts: 0, lastTriedDay: null });
}
