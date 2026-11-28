import type { ContentBundle } from '../../shared/src/index.ts';
import { runDueEvents } from './events.ts';
import { refreshNodes } from './gathering.ts';
import { tickSurvival } from './stats.ts';
import type { Activity } from './stats.ts';
import { currentDay, currentSeason } from './state.ts';
import type { GameState } from './state.ts';
import { dayOf } from './time.ts';
import { checkThresholds, dailyDrift } from './village.ts';
import { weatherForDay } from './weather.ts';

function onNewDay(state: GameState, content: ContentBundle): void {
  state.weather = weatherForDay(state.seed, currentDay(state), currentSeason(state));
  refreshNodes(state, content);
  dailyDrift(state);
  checkThresholds(state, content);
}

/** Advance the world by `ticks`. The world keeps running even if the player is dead. */
export function advance(state: GameState, content: ContentBundle, ticks = 1, activity: Activity = 'normal'): void {
  for (let i = 0; i < ticks; i++) {
    const prevDay = dayOf(state.tick);
    state.tick += 1;
    if (dayOf(state.tick) !== prevDay) onNewDay(state, content);
    tickSurvival(state, content, activity);
    checkThresholds(state, content); // catches stat changes made outside events (Director, scripts)
    runDueEvents(state, content);
  }
}
