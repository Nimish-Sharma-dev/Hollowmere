import { VILLAGE_STATS } from '../../shared/src/index.ts';
import type { ContentBundle, Id, VillageStat } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import { clamp } from './stats.ts';
import { currentDay, currentPhase, currentSeason, scheduleEvent } from './state.ts';
import type { GameState } from './state.ts';

const r2 = (x: number): number => Math.round(x * 100) / 100;

export function adjustVillage(state: GameState, stat: VillageStat, delta: number): void {
  state.village[stat] = r2(clamp(state.village[stat] + delta, CONFIG.village.min, CONFIG.village.max));
}

export function adjustTrust(state: GameState, npcId: Id, delta: number): void {
  const n = state.npcs[npcId];
  if (!n) return;
  n.trust = r2(clamp(n.trust + delta, CONFIG.npc.trustMin, CONFIG.npc.trustMax));
}

/** Seasonal drift, applied once at each day rollover. */
export function dailyDrift(state: GameState): void {
  const drift = CONFIG.village.seasonDrift[currentSeason(state)];
  for (const stat of VILLAGE_STATS) {
    const d = drift[stat];
    if (d) adjustVillage(state, stat, d);
  }
}

/** Where an NPC is right now (null if dead). Event overrides win over the schedule. */
export function npcLocation(state: GameState, content: ContentBundle, npcId: Id): Id | null {
  const npc = state.npcs[npcId];
  const card = content.npcs[npcId];
  if (!npc || !card || !npc.alive) return null;
  if (npc.override && state.tick < npc.override.untilTick) return npc.override.location;
  const slot = card.schedule?.[currentPhase(state)] ?? CONFIG.npc.defaultSchedule[currentPhase(state)];
  return card[slot];
}

function conditionsHold(state: GameState, conds: { stat: VillageStat; op: '>=' | '<='; value: number }[]): boolean {
  return conds.every((c) => (c.op === '>=' ? state.village[c.stat] >= c.value : state.village[c.stat] <= c.value));
}

/**
 * Edge-triggered: when a threshold's conditions become true, its event is scheduled
 * (respecting cooldown and `once`). Returns the ids of thresholds that fired.
 */
export function checkThresholds(state: GameState, content: ContentBundle): Id[] {
  const fired: Id[] = [];
  const day = currentDay(state);
  for (const t of content.thresholds) {
    const ts = (state.thresholds[t.id] ??= { active: false, lastFiredDay: null, fired: 0 });
    const active = conditionsHold(state, t.conditions);
    if (active && !ts.active) {
      const coolOk = ts.lastFiredDay === null || day - ts.lastFiredDay >= t.cooldownDays;
      const onceOk = !t.once || ts.fired === 0;
      if (coolOk && onceOk) {
        scheduleEvent(state, t.event, day, 'threshold');
        ts.lastFiredDay = day;
        ts.fired += 1;
        fired.push(t.id);
      }
    }
    ts.active = active;
  }
  return fired;
}
