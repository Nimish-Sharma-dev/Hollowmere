import type { Id } from '../../shared/src/index.ts';
import type { GameState } from '../../engine/src/state.ts';
import { adjustVillage, adjustTrust } from '../../engine/src/village.ts';
import { ARCHETYPES } from './schemas.ts';
import type { Archetype } from './bible.ts';

export interface DilemmaChoice {
  id: Id;
  label: string;
  description: string;
  archetypeWeights: Partial<Record<Archetype, number>>;
  effects: {
    villageStats?: Partial<GameState['village']>;
    npcTrust?: Record<Id, number>;
    flags?: string[];
  };
}

export interface DilemmaTemplate {
  id: Id;
  title: string;
  prompt: string;
  involvedNpcIds: Id[];
  choices: DilemmaChoice[];
}

export const DILEMMA_TEMPLATES: Record<Id, DilemmaTemplate> = {
  confront_hoarder: {
    id: 'confront_hoarder',
    title: 'The Hidden Granary',
    prompt: 'You discover a cache of grain hoarded away while the village goes hungry.',
    involvedNpcIds: ['alder', 'maren'],
    choices: [
      {
        id: 'distribute_food',
        label: 'Distribute it to the starving villagers',
        description: 'Take the grain and open it to everyone in the square.',
        archetypeWeights: { shepherd: 3, peacemaker: 2 },
        effects: {
          villageStats: { hunger: -2, hope: 2, unity: 1 },
          flags: ['hoard_distributed'],
        },
      },
      {
        id: 'blackmail_hoarder',
        label: 'Demand a cut to keep quiet',
        description: 'Keep the secret in exchange for winter provisions.',
        archetypeWeights: { trickster: 3, scavenger: 2 },
        effects: {
          flags: ['hoarder_blackmailed'],
        },
      },
      {
        id: 'arrest_hoarder',
        label: 'Demand public punishment',
        description: 'Expose the hoarder and demand Captain Voss take severe action.',
        archetypeWeights: { tyrant: 3, lone_wolf: 1 },
        effects: {
          villageStats: { fear: 2, unity: -1 },
          flags: ['hoarder_punished'],
        },
      },
    ],
  },
  share_winter_fuel: {
    id: 'share_winter_fuel',
    title: 'The Frozen Night',
    prompt: 'A blizzard hits. A shivering family asks for half your firewood supply.',
    involvedNpcIds: ['pip', 'edda'],
    choices: [
      {
        id: 'share_all',
        label: 'Share your wood freely',
        description: 'Give them what they need, even if it leaves you cold.',
        archetypeWeights: { shepherd: 3, peacemaker: 2 },
        effects: {
          villageStats: { hope: 1, unity: 2 },
          flags: ['wood_shared'],
        },
      },
      {
        id: 'barter_wood',
        label: 'Sell it for scrap and iron',
        description: 'Nothing is free in winter. Name a steep price.',
        archetypeWeights: { scavenger: 3, trickster: 1 },
        effects: {
          flags: ['wood_sold'],
        },
      },
      {
        id: 'turn_away',
        label: 'Bar the door',
        description: 'Survival requires selfishness. You cannot save everyone.',
        archetypeWeights: { lone_wolf: 3, tyrant: 1 },
        effects: {
          villageStats: { hope: -1, fear: 1 },
          flags: ['refused_shelter'],
        },
      },
    ],
  },
};

export interface ArchetypeTracker {
  scores: Record<Archetype, number>;
  totalActions: number;
}

export function newArchetypeTracker(): ArchetypeTracker {
  return {
    scores: {
      lone_wolf: 0,
      peacemaker: 0,
      scavenger: 0,
      tyrant: 0,
      shepherd: 0,
      trickster: 0,
    },
    totalActions: 0,
  };
}

export function recordArchetypeAction(tracker: ArchetypeTracker, archetype: Archetype, points = 1): void {
  tracker.scores[archetype] += points;
  tracker.totalActions += points;
}

export function getDominantArchetype(tracker: ArchetypeTracker): Archetype {
  let top: Archetype = 'lone_wolf';
  let max = -1;
  for (const a of ARCHETYPES) {
    if (tracker.scores[a] > max) {
      max = tracker.scores[a];
      top = a;
    }
  }
  return top;
}

export function getNormalizedArchetypeScores(tracker: ArchetypeTracker): Record<Archetype, number> {
  const sum = Object.values(tracker.scores).reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const uniform = 1 / ARCHETYPES.length;
    return Object.fromEntries(ARCHETYPES.map((a) => [a, Math.round(uniform * 100) / 100])) as Record<Archetype, number>;
  }
  return Object.fromEntries(
    ARCHETYPES.map((a) => [a, Math.round((tracker.scores[a] / sum) * 100) / 100])
  ) as Record<Archetype, number>;
}

export function resolveDilemma(
  state: GameState,
  dilemmaId: Id,
  choiceId: Id,
  tracker?: ArchetypeTracker
): { ok: boolean; reason?: string } {
  const dilemma = DILEMMA_TEMPLATES[dilemmaId];
  if (!dilemma) return { ok: false, reason: `unknown dilemma ${dilemmaId}` };

  const choice = dilemma.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, reason: `unknown choice ${choiceId} for dilemma ${dilemmaId}` };

  // 1. Apply village stats
  if (choice.effects.villageStats) {
    for (const [stat, delta] of Object.entries(choice.effects.villageStats)) {
      adjustVillage(state, stat as keyof GameState['village'], delta as number);
    }
  }

  // 2. Apply NPC trust
  if (choice.effects.npcTrust) {
    for (const [npcId, delta] of Object.entries(choice.effects.npcTrust)) {
      adjustTrust(state, npcId, delta);
    }
  }

  // 3. Apply flags
  if (choice.effects.flags) {
    for (const f of choice.effects.flags) {
      state.flags[f] = true;
    }
  }

  // 4. Update archetype tracker
  if (tracker && choice.archetypeWeights) {
    for (const [a, pts] of Object.entries(choice.archetypeWeights)) {
      recordArchetypeAction(tracker, a as Archetype, pts as number);
    }
  }

  // Remove from pending dilemmas
  const idx = state.pendingDilemmas.indexOf(dilemmaId);
  if (idx >= 0) state.pendingDilemmas.splice(idx, 1);

  return { ok: true };
}
