import { stableStringify } from './rng.ts';
import type { GameState } from './state.ts';

export function serialize(state: GameState): string {
  return stableStringify(state);
}

/** Parse a saved run. Throws a descriptive Error for anything that is not a valid v1 save. */
export function deserialize(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('save: not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('save: not an object');
  const s = raw as Partial<GameState>;
  if (s.version !== 1) throw new Error(`save: unsupported version ${String(s.version)}`);
  const need: (keyof GameState)[] = ['seed', 'rng', 'tick', 'weather', 'player', 'village', 'npcs', 'nodes', 'flags', 'scheduled', 'thresholds', 'eventLog'];
  for (const k of need) if (s[k] === undefined) throw new Error(`save: missing field "${k}"`);
  if (!Number.isInteger(s.tick) || (s.tick as number) < 0) throw new Error('save: bad tick');
  return raw as GameState;
}
