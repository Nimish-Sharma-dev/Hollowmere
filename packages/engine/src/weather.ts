import { WEATHERS } from '../../shared/src/index.ts';
import type { Season, Weather } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import { subRng } from './rng.ts';

/** Pure function of (seed, day, season): weather never depends on player actions. */
export function weatherForDay(seed: number, day: number, season: Season): Weather {
  const rng = subRng(seed, 'weather', day);
  const weights = CONFIG.weatherWeights[season];
  return rng.weighted(WEATHERS.map((w, i) => ({ item: w as Weather, weight: weights[i] ?? 0 })));
}
