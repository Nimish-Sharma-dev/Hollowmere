import type { Id } from '../../shared/src/index.ts';
import type { GameState } from '../../engine/src/state.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { P6_SCHEMA } from './schemas.ts';
import { validate } from './schema.ts';

export interface ModifierDef {
  id: Id;
  name: string;
  description: string;
  townCrierLine: string;
  flavourLine: string;
  moodColourId: string;
  effects: {
    tempOffset?: number;
    hungerMult?: number;
    flag?: string;
  };
}

export const MODIFIER_LIBRARY: Record<Id, ModifierDef> = {
  blood_moon: {
    id: 'blood_moon',
    name: 'Blood Moon',
    description: 'A crimson moon hangs overhead; the wilderness grows restless and aggressive.',
    townCrierLine: 'Hear ye! Bar your shutters and bank your fires—the red eye watches tonight!',
    flavourLine: 'The sky bleeds copper. The shadows stretch long and lean.',
    moodColourId: 'crimson',
    effects: { flag: 'blood_moon_active', tempOffset: -2 },
  },
  heavy_snowfall: {
    id: 'heavy_snowfall',
    name: 'Heavy Snowfall',
    description: 'Thick drifts bury the paths and bitter cold bites into the bone.',
    townCrierLine: 'Hear ye! Heavy drifts upon the north road—conserve your fuel!',
    flavourLine: 'Snow falls in heavy curtains, muffling footsteps and hiding the trees.',
    moodColourId: 'pale_blue',
    effects: { tempOffset: -6, hungerMult: 1.15 },
  },
  market_day: {
    id: 'market_day',
    name: 'Market Day',
    description: 'Traveling traders set up stalls; spirits in the square rise.',
    townCrierLine: 'Hear ye! Peddlers gather at the square—goods and grain for exchange!',
    flavourLine: 'Smoke and the smell of roasted acorns fill the cold square.',
    moodColourId: 'warm_gold',
    effects: { hungerMult: 0.95 },
  },
  fog_of_doubt: {
    id: 'fog_of_doubt',
    name: 'Fog of Doubt',
    description: 'A dense, choking marsh fog settles into the hollow.',
    townCrierLine: 'Hear ye! Marsh fog in the streets—keep lantern light close!',
    flavourLine: 'The mist is damp and sour. Neighbors pass like phantoms without greeting.',
    moodColourId: 'moss_grey',
    effects: { tempOffset: -1 },
  },
  bountiful_harvest: {
    id: 'bountiful_harvest',
    name: 'Bountiful Forage',
    description: 'Wild bushes and late herbs yield unexpectedly rich pickings.',
    townCrierLine: 'Hear ye! Winter berries found in the briars—gather before frost returns!',
    flavourLine: 'Dark red berries hang heavy on the thorns like droplets of hardened wine.',
    moodColourId: 'rich_amber',
    effects: { hungerMult: 0.9 },
  },
  howling_winds: {
    id: 'howling_winds',
    name: 'Howling Winds',
    description: 'Gale-force gusts whip off the ridges, testing every roof.',
    townCrierLine: 'Hear ye! Gale warnings from the ridge—latch all gates and doors!',
    flavourLine: 'The wind screeches through the chinks in the logs like an animal.',
    moodColourId: 'cold_slate',
    effects: { tempOffset: -4 },
  },
  silent_bell: {
    id: 'silent_bell',
    name: 'The Silent Bell',
    description: 'The chapel bell has cracked; morning silence unnerves the elders.',
    townCrierLine: 'Hear ye! The chapel bell strikes not this morn—pray at home!',
    flavourLine: 'The dawn arrives without song or iron chime. The silence feels heavy.',
    moodColourId: 'dull_ash',
    effects: { flag: 'silent_bell' },
  },
  spring_thaw: {
    id: 'spring_thaw',
    name: 'Sudden Thaw',
    description: 'Warm southern air melts the ice, turning dirt roads to slick mire.',
    townCrierLine: 'Hear ye! Ice turns to mire—watch your footing upon the hill!',
    flavourLine: 'Water drips from eaves in a steady patter. The ground gives beneath boots.',
    moodColourId: 'pale_green',
    effects: { tempOffset: 4 },
  },
  pilgrim_passing: {
    id: 'pilgrim_passing',
    name: 'Passing Pilgrims',
    description: 'A ragged procession of wanderers rests briefly outside the palisade.',
    townCrierLine: 'Hear ye! Pilgrims at the boundary—charity welcomes grace!',
    flavourLine: 'Hooded figures kneel in the mud, singing hymns in an old, forgotten tongue.',
    moodColourId: 'ochre',
    effects: { flag: 'pilgrims_visited' },
  },
  iron_scarcity: {
    id: 'iron_scarcity',
    name: 'Iron Scarcity',
    description: 'The forge runs low on bog iron; tools become precious.',
    townCrierLine: 'Hear ye! Blacksmith ration in effect—preserve all blade and nail!',
    flavourLine: 'Maren’s hammer falls seldom today. The forge fire burns thin and low.',
    moodColourId: 'rust_brown',
    effects: { flag: 'iron_scarcity' },
  },
};

export interface DailyModifierOutput {
  modifier_id: Id;
  town_crier_line: string;
  flavour_line: string;
  mood_colour_id: string;
}

export interface DailyModifierRecord {
  day: string; // YYYY-MM-DD
  modifier: DailyModifierOutput;
  createdAt: string;
}

export function fallbackDailyModifier(
  dateStr: string,
  lastSeven: Id[],
  seed = 42
): DailyModifierOutput {
  const rng = new Rng(hashSeed(seed, 'daily_modifier', dateStr));
  const allIds = Object.keys(MODIFIER_LIBRARY);
  // Rule: Never repeat a modifier from LAST_SEVEN
  const eligibleIds = allIds.filter((id) => !lastSeven.includes(id));
  const chosenId = eligibleIds.length > 0 ? rng.pick(eligibleIds) : rng.pick(allIds);
  const def = MODIFIER_LIBRARY[chosenId]!;

  return {
    modifier_id: def.id,
    town_crier_line: def.townCrierLine,
    flavour_line: def.flavourLine,
    mood_colour_id: def.moodColourId,
  };
}

export async function resolveDailyModifier(
  dateStr: string,
  lastSeven: Id[],
  client: LlmClient | null,
  seed = 42
): Promise<{ output: DailyModifierOutput; source: 'llm' | 'fallback'; records: CallRecord[] }> {
  let records: CallRecord[] = [];
  if (client) {
    const res = await client.complete('P6', {
      modifier_library: Object.values(MODIFIER_LIBRARY).map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
      })),
      last_seven_modifiers: lastSeven,
      date: dateStr,
      seed_draw: `Seed: ${seed}`,
    });
    records = res.records;

    if (res.ok) {
      const errs = validate(P6_SCHEMA, res.json);
      const cand = res.json as DailyModifierOutput;
      if (errs.length === 0 && MODIFIER_LIBRARY[cand.modifier_id] && !lastSeven.includes(cand.modifier_id)) {
        return { output: cand, source: 'llm', records };
      }
    }
  }

  const fallback = fallbackDailyModifier(dateStr, lastSeven, seed);
  return { output: fallback, source: 'fallback', records };
}

export function applyDailyModifier(state: GameState, modOutput: DailyModifierOutput): void {
  const def = MODIFIER_LIBRARY[modOutput.modifier_id];
  if (!def) return;

  state.modifiers.id = def.id;
  if (def.effects.tempOffset) {
    state.modifiers.tempOffset += def.effects.tempOffset;
  }
  if (def.effects.hungerMult) {
    state.modifiers.hungerMult *= def.effects.hungerMult;
  }
  if (def.effects.flag) {
    state.flags[def.effects.flag] = true;
  }
}
