import type { Id } from '../../shared/src/index.ts';
import { Rng } from '../../engine/src/rng.ts';
import { TONES } from './lore.ts';

/** Seed Deck (PROMPTS.md section 1). Starter lists; the plan wants 30+ entries each over time. */
export const SEED_DECK = {
  lens: TONES,
  constraint: [
    'no one is purely good or bad', 'the antagonist is someone the player likes', 'the real danger is not the obvious one',
    'a promise made early becomes costly late', 'the solution requires giving something up', 'the player\'s backstory is quietly tied to the crisis',
    'a child sees the truth first and is ignored', 'help comes from the least trusted person', 'the crisis is partly the village\'s own fault',
    'the first kindness is later repaid or exploited',
  ],
  wildcard: [
    'a stranger who knows too much', 'a stolen heirloom', 'a letter delivered to the wrong person', 'an animal behaving strangely',
    'a festival nobody remembers organizing', 'a missing bell', 'a sealed cellar door', 'a forged map', 'a dream shared by two villagers', 'a debt older than the village',
  ],
  forbidden_trope: [
    'chosen-one destiny', 'evil wizard final boss', 'it was all a dream', 'amnesia reveal', 'the mayor is simply corrupt',
    'bandits with no motive', 'a dark lord', 'a prophecy', 'secret royal heritage', 'villain monologue',
  ],
} as const;

export interface SeedDraw {
  lens: string;
  constraint: string;
  wildcard: string;
  forbidden_trope: string;
  spotlight_npc: Id;
  weather_season: Id;
}

/** One draw per slot. Never reuses a lens from the player's last 3 runs. */
export function drawSeed(rng: Rng, npcIds: Id[], seasons: Id[], recentLenses: string[] = []): SeedDraw {
  const banned = new Set(recentLenses.slice(-3));
  const lenses = SEED_DECK.lens.filter((l) => !banned.has(l));
  return {
    lens: rng.pick(lenses.length ? lenses : SEED_DECK.lens),
    constraint: rng.pick(SEED_DECK.constraint),
    wildcard: rng.pick(SEED_DECK.wildcard),
    forbidden_trope: rng.pick(SEED_DECK.forbidden_trope),
    spotlight_npc: rng.pick([...npcIds].sort()),
    weather_season: rng.pick(seasons),
  };
}
