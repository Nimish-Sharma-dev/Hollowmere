import { PHASES, SEASONS } from '../../shared/src/index.ts';
import type { Phase, Season } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';

/** Day numbers are 1-indexed. tick 0 is day 1, morning. */
export function dayOf(tick: number): number {
  return Math.floor(tick / CONFIG.ticksPerDay) + 1;
}

export function tickOfDay(tick: number): number {
  return tick % CONFIG.ticksPerDay;
}

export function phaseAt(tickInDay: number): Phase {
  let result: Phase = PHASES[0];
  for (const p of PHASES) {
    if (tickInDay >= CONFIG.phaseStarts[p]) result = p;
  }
  return result;
}

export function phaseOfTick(tick: number): Phase {
  return phaseAt(tickOfDay(tick));
}

export function seasonOfDay(day: number, startSeason: Season): Season {
  const startIdx = SEASONS.indexOf(startSeason);
  const idx = (startIdx + Math.floor((day - 1) / CONFIG.daysPerSeason)) % SEASONS.length;
  return SEASONS[idx] as Season;
}

/** first tick of the given day */
export function startTickOfDay(day: number): number {
  return (day - 1) * CONFIG.ticksPerDay;
}

/** "Day 3, 14:30" style clock; tick 0 = 06:00. */
export function clockString(tick: number): string {
  const minutes = Math.floor((tickOfDay(tick) / CONFIG.ticksPerDay) * 24 * 60);
  const total = (6 * 60 + minutes) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `Day ${dayOf(tick)}, ${hh}:${mm}`;
}
