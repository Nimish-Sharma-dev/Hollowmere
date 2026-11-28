import type { Id } from '../../shared/src/index.ts';
import { ARCHETYPES } from './schemas.ts';
import { ENDINGS } from './lore.ts';
import type { RunBible, Archetype } from './bible.ts';

export type EndingFamily = (typeof ENDINGS)[number];

export interface TitleReveal {
  archetype: Archetype;
  title: string;        // e.g. "The Shepherd"
  epithet: string;      // contextual title variant e.g. "The Hearthkeeper"
  reason: string;       // 1-2 sentence explanation of why the title was granted
  secondaryTrait?: string;
}

export interface EndingEvaluationInput {
  bible?: RunBible | null;
  state: {
    village: Record<'hope' | 'fear' | 'hunger' | 'trust' | 'unity', number>;
    player: { alive: boolean; stats?: { health: number; hunger: number; warmth: number; energy: number } };
    npcs?: Record<Id, { alive: boolean; trust?: number }>;
    daysSurvived?: number;
    crisisResolved?: boolean;
    villagersExpelled?: boolean;
    abandonedVillage?: boolean;
  };
  archetypeScores: Record<Archetype, number>;
  definingDeeds?: string[];
}

export interface EndingEvaluationResult {
  endingFamily: EndingFamily;
  titleReveal: TitleReveal;
  dominantArchetype: Archetype;
  narrativeHeadline: string;
  summaryText: string;
  villageCondition: 'thriving' | 'scarred' | 'ruined' | 'subjugated' | 'abandoned';
  affinityScores: Record<EndingFamily, number>;
}

export const BASE_TITLES: Record<Archetype, string> = {
  lone_wolf: 'The Lone Wolf',
  peacemaker: 'The Peacemaker',
  scavenger: 'The Scavenger',
  tyrant: 'The Tyrant',
  shepherd: 'The Shepherd',
  trickster: 'The Trickster',
};

export const CONTEXTUAL_EPITHETS: Record<Archetype, Record<EndingFamily, string>> = {
  lone_wolf: {
    shepherd_saved: 'The Reluctant Protector',
    scarred_survival: 'The Silent Survivor',
    exile: 'The Banished Hunter',
    tyrants_peace: 'The Grim Enforcer',
    village_falls: 'The Solitary Ghost',
    quiet_redemption: 'The Solitary Pilgrim',
  },
  peacemaker: {
    shepherd_saved: 'The Bridge Builder',
    scarred_survival: 'The Broken Arbiter',
    exile: 'The Wandering Envoy',
    tyrants_peace: 'The Silent Judge',
    village_falls: 'The Unheard Voice',
    quiet_redemption: 'The Quiet Healer',
  },
  scavenger: {
    shepherd_saved: 'The Resourceful Provider',
    scarred_survival: 'The Scrap Warden',
    exile: 'The Cursed Wanderer',
    tyrants_peace: 'The Quartermaster',
    village_falls: 'The Carrion Crow',
    quiet_redemption: 'The Penitent Forager',
  },
  tyrant: {
    shepherd_saved: 'The Strict Guardian',
    scarred_survival: 'The Hard Master',
    exile: 'The Cast-Out Warlord',
    tyrants_peace: 'The Iron Sovereign',
    village_falls: 'The Ruined Despot',
    quiet_redemption: 'The Chastened King',
  },
  shepherd: {
    shepherd_saved: 'The Hearthkeeper',
    scarred_survival: 'The Winter Warden',
    exile: 'The Forsaken Shepherd',
    tyrants_peace: 'The Iron Shepherd',
    village_falls: 'The Last Guardian',
    quiet_redemption: 'The Merciful Shepherd',
  },
  trickster: {
    shepherd_saved: 'The Clever Fox',
    scarred_survival: 'The Lucky Knave',
    exile: 'The Slippery Phantom',
    tyrants_peace: 'The Whispering Chancellor',
    village_falls: 'The Jester of Hollowmere',
    quiet_redemption: 'The Reformed Rogue',
  },
};

const TITLE_REASONS: Record<Archetype, Record<EndingFamily, string>> = {
  lone_wolf: {
    shepherd_saved: 'Despite keeping your distance, your solitary hands quietly solved the crises no one else dared face.',
    scarred_survival: 'You relied on no one and asked for nothing, dragging yourself through the deep frost alone.',
    exile: 'You walked in shadows and kept your own counsel, until the village decided you belonged to the cold roads alone.',
    tyrants_peace: 'Your cold indifference was mistaken for authority, and you enforced silence where words had failed.',
    village_falls: 'In the end, self-preservation was the only creed you answered to as the walls fell around you.',
    quiet_redemption: 'You stepped out of the wilderness long enough to mend a wound you did not cause, then vanished into the thaw.',
  },
  peacemaker: {
    shepherd_saved: 'You built bridges where others dug trenches, uniting estranged neighbors to save the village together.',
    scarred_survival: 'Your compromises were painful and imperfect, but they bought enough time for the village to endure.',
    exile: 'Your refusal to take a side turned both factions against you, leaving you an envoy with no home.',
    tyrants_peace: 'In your pursuit of quiet, you permitted the silence of fear to replace the clamor of free men.',
    village_falls: 'Words alone could not stay the blade or fill the granary when the bitter crisis struck.',
    quiet_redemption: 'You listened when everyone else was shouting, bringing long-buried truths into the light without bloodshed.',
  },
  scavenger: {
    shepherd_saved: 'You scoured the frozen valley to bring home what everyone else had given up for lost.',
    scarred_survival: 'You knew the value of every crust, nail, and scrap, turning the village refuse into its salvation.',
    exile: 'Your hands were always in someone else\'s stores, until the village locked its gates behind you.',
    tyrants_peace: 'You hoarded the valley\'s wealth and turned scarcity into absolute leverage over every hungry mouth.',
    village_falls: 'You picked the bones clean while the village crumbled, walking away with everything except a future.',
    quiet_redemption: 'After a lifetime of taking, you returned what you found and asked for nothing in return.',
  },
  tyrant: {
    shepherd_saved: 'Your harsh discipline forced the village to endure what softer hearts could never survive.',
    scarred_survival: 'Your iron demands extracted a steep toll, keeping the village alive while bleeding it of its warmth.',
    exile: 'The village chose the perils of the wilderness over another day under your iron thumb.',
    tyrants_peace: 'You forged order from chaos through sheer force of will, choosing fear over the fragile luxury of consent.',
    village_falls: 'Your demands broke what little trust remained, leaving behind a hollow ruin where a village once stood.',
    quiet_redemption: 'Having tasted absolute power, you laid your weapons down and chose humility when it mattered most.',
  },
  shepherd: {
    shepherd_saved: 'When the bitter cold threatened to extinguish Hollowmere, you gathered the frightened, fed the hearth, and carried the village through intact.',
    scarred_survival: 'You threw yourself into the storm to shield others, taking the wounds upon yourself so the survivors might see the spring.',
    exile: 'You gave everything you had to ungrateful hands, and were cast out into the cold once your strength was spent.',
    tyrants_peace: 'You protected the flock with an iron fence, forgetting that a cage is still a cage.',
    village_falls: 'You stood vigil until the last light died, refusing to leave even when the village could no longer be saved.',
    quiet_redemption: 'You chose patience and quiet forgiveness over vengeance, healing old fractures with steady kindness.',
  },
  trickster: {
    shepherd_saved: 'Your sleight of hand and clever bluffs kept catastrophe at bay until help arrived.',
    scarred_survival: 'You gambled with desperate stakes and barely escaped with your life, leaving the village altered forever.',
    exile: 'When your web of half-truths unraveled, the villagers found they could forgive anything except your laughter.',
    tyrants_peace: 'You whispered into every ear until the village bowed to illusions and suspicions of your own design.',
    village_falls: 'You played games with wolves while the sheep starved, laughing all the way to the ashes.',
    quiet_redemption: 'You used cunning and misdirection not for petty gain, but to expose the real villain and save the innocent.',
  },
};

const HEADLINES: Record<EndingFamily, string> = {
  shepherd_saved: 'A Hearth in the Long Night',
  scarred_survival: 'The Scars of Winter',
  exile: 'A Road Away from Hollowmere',
  tyrants_peace: 'Peace of the Iron Fist',
  village_falls: 'The Silence of Hollowmere',
  quiet_redemption: 'Truth in the Morning Mist',
};

const CONDITIONS: Record<EndingFamily, EndingEvaluationResult['villageCondition']> = {
  shepherd_saved: 'thriving',
  scarred_survival: 'scarred',
  exile: 'abandoned',
  tyrants_peace: 'subjugated',
  village_falls: 'ruined',
  quiet_redemption: 'thriving',
};

const SUMMARIES: Record<EndingFamily, string> = {
  shepherd_saved: 'The village of Hollowmere survived the crisis whole and united. The hearths burn bright, the grain is shared, and your name is spoken with gratitude.',
  scarred_survival: 'Hollowmere still stands, though its walls are charred and its people carry quiet grief. It will take generations to mend what this season broke.',
  exile: 'The gates of Hollowmere closed behind you, never to open again. Whatever the village becomes in the spring, it will face without you.',
  tyrants_peace: 'No voice speaks out in Hollowmere tonight. The granary is guarded, the curfew is kept, and order reigns in the shadow of absolute fear.',
  village_falls: 'The roofs have fallen in and the wind howls through empty doorways. Hollowmere is no more than a marker on a lonely map.',
  quiet_redemption: 'The poison has been drawn without tearing the flesh. Villagers who once traded accusations now share bread, and old wounds begin to close.',
};

/** Finds the dominant archetype from a map of scores, breaking ties deterministically in ARCHETYPES order. */
export function dominantArchetype(scores: Record<Archetype, number>): Archetype {
  let best: Archetype = ARCHETYPES[0];
  let max = -Infinity;
  for (const a of ARCHETYPES) {
    const s = scores[a] ?? 0;
    if (s > max) {
      max = s;
      best = a;
    }
  }
  return best;
}

/** Generates the final Title Reveal for a player. */
export function generateTitleReveal(archetype: Archetype, ending: EndingFamily): TitleReveal {
  return {
    archetype,
    title: BASE_TITLES[archetype] ?? 'The Wanderer',
    epithet: CONTEXTUAL_EPITHETS[archetype]?.[ending] ?? BASE_TITLES[archetype] ?? 'The Wanderer',
    reason: TITLE_REASONS[archetype]?.[ending] ?? 'The world watched your journey and remembered what you chose.',
  };
}

/**
 * Evaluates the full ending of a run, determining the ending family, title reveal, and narrative summary.
 */
export function evaluateEnding(input: EndingEvaluationInput): EndingEvaluationResult {
  const { village, player, npcs, villagersExpelled, abandonedVillage, crisisResolved } = input.state;
  const dom = dominantArchetype(input.archetypeScores);

  const totalNpcs = npcs ? Object.keys(npcs).length : 8;
  const aliveNpcs = npcs ? Object.values(npcs).filter((n) => n.alive).length : 8;
  const aliveRatio = totalNpcs > 0 ? aliveNpcs / totalNpcs : 1;

  // Compute affinity scores for each of the 6 endings
  const affinities: Record<EndingFamily, number> = {
    village_falls: 0,
    exile: 0,
    tyrants_peace: 0,
    shepherd_saved: 0,
    quiet_redemption: 0,
    scarred_survival: 0,
  };

  // 1. Village Falls
  if (!player.alive && village.hope < 4) affinities.village_falls += 35;
  if (village.hope <= 1.5) affinities.village_falls += 45;
  if (village.hunger >= 8.5) affinities.village_falls += 35;
  if (village.fear >= 8.5 && village.hope <= 3.0) affinities.village_falls += 30;
  if (aliveRatio < 0.35) affinities.village_falls += 40;
  affinities.village_falls += (10 - village.hope) * 2 + village.hunger * 1.5 + (10 - village.unity);

  // 2. Exile
  if (abandonedVillage || villagersExpelled) affinities.exile += 55;
  if (village.trust <= 2.0) affinities.exile += 40;
  if (dom === 'lone_wolf' && village.trust <= 3.5) affinities.exile += 25;
  if (dom === 'trickster' && village.trust <= 3.0) affinities.exile += 20;
  affinities.exile += (10 - village.trust) * 3 + (10 - village.unity) * 1.5;

  // 3. Tyrant's Peace
  if (player.alive && village.fear >= 6.5) affinities.tyrants_peace += 30;
  if (dom === 'tyrant') affinities.tyrants_peace += 20;
  if (village.fear > village.trust + 1.5) affinities.tyrants_peace += 25;
  if (village.unity >= 5.0 && village.fear >= 5.0) affinities.tyrants_peace += 15;
  affinities.tyrants_peace += village.fear * 2.5 + village.unity * 1.5 + (10 - village.trust) * 1.0;

  // 4. Shepherd Saved
  if (player.alive && village.hope >= 5.5 && village.trust >= 5.0 && aliveRatio >= 0.8) affinities.shepherd_saved += 35;
  if (dom === 'shepherd') affinities.shepherd_saved += 25;
  if (village.hunger <= 4.0 && village.fear <= 4.0) affinities.shepherd_saved += 15;
  affinities.shepherd_saved += village.hope * 2.5 + village.trust * 2.0 + village.unity * 1.5 + (10 - village.hunger) + (10 - village.fear);

  // 5. Quiet Redemption
  if (player.alive && village.trust >= 5.0 && village.fear <= 4.0 && village.hope >= 4.0) affinities.quiet_redemption += 35;
  if (dom === 'peacemaker') affinities.quiet_redemption += 25;
  if (dom === 'trickster') affinities.quiet_redemption += 18;
  if (crisisResolved) affinities.quiet_redemption += 20;
  affinities.quiet_redemption += village.trust * 3.0 + (10 - village.fear) * 2.5 + village.hope * 1.5 + village.unity * 1.0;

  // 6. Scarred Survival
  affinities.scarred_survival += 10;
  if (player.alive && village.hope >= 2.5 && village.hope <= 7.0) affinities.scarred_survival += 20;
  if (aliveRatio > 0.4 && aliveRatio < 0.9) affinities.scarred_survival += 25;
  if (village.fear >= 3.5 || village.hunger >= 4.0) affinities.scarred_survival += 15;
  affinities.scarred_survival += village.hope * 1.5 + (10 - Math.abs(village.trust - 5)) * 1.5 + village.fear * 1.0;

  // Arc guidance bonus from RunBible if applicable
  if (input.bible?.fingerprint.ending_family && input.bible.fingerprint.ending_family in affinities) {
    affinities[input.bible.fingerprint.ending_family as EndingFamily] += 8;
  }

  // Find best ending
  let chosenEnding: EndingFamily = ENDINGS[0];
  let maxAffinity = -Infinity;
  for (const e of ENDINGS) {
    if (affinities[e] > maxAffinity) {
      maxAffinity = affinities[e];
      chosenEnding = e;
    }
  }

  const titleReveal = generateTitleReveal(dom, chosenEnding);

  return {
    endingFamily: chosenEnding,
    titleReveal,
    dominantArchetype: dom,
    narrativeHeadline: HEADLINES[chosenEnding] ?? 'The End of the Road',
    summaryText: SUMMARIES[chosenEnding] ?? 'The story of Hollowmere reaches its conclusion.',
    villageCondition: CONDITIONS[chosenEnding] ?? 'scarred',
    affinityScores: affinities,
  };
}
