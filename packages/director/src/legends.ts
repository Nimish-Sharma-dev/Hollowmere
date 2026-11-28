import type { Id } from '../../shared/src/index.ts';
import type { GameState } from '../../engine/src/state.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import { MONUMENTS } from './schemas.ts';
import type { Archetype } from './bible.ts';
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { P7A_SCHEMA } from './schemas.ts';
import { validate } from './schema.ts';

export type MonumentType = (typeof MONUMENTS)[number];

export interface GhostLegend {
  id: string;
  runId: string;
  legendText: string;
  tags: {
    archetype: Archetype;
    deedType: 'kindness' | 'cruelty' | 'sacrifice' | 'folly';
    endingFamily: string;
  };
  monumentType: MonumentType;
  createdAt: string;
}

export interface RunSummary {
  runId: string;
  archetype: Archetype;
  endingFamily: string;
  deeds: string[];
  savedNpcIds: Id[];
  abandonedNpcIds: Id[];
  daysSurvived: number;
}

export interface PlacedMonument {
  monumentId: string;
  legendId: string;
  monumentType: MonumentType;
  legendText: string;
  location: string;
}

const FALLBACK_TALES: Record<Archetype, { text: string; deedType: 'kindness' | 'cruelty' | 'sacrifice' | 'folly'; monument: MonumentType }> = {
  shepherd: {
    text: 'They say a stranger once gave their own firewood to the chapel during a bitter blizzard. The village survived that winter, though the stranger was gone before the thaw.',
    deedType: 'sacrifice',
    monument: 'carving',
  },
  peacemaker: {
    text: 'An outsider walked between the quarreling clans at the meeting hall and demanded peace. For one quiet season, no blade was drawn within the palisade.',
    deedType: 'kindness',
    monument: 'statue',
  },
  scavenger: {
    text: 'A quiet wanderer picked the ruins clean and left caches of iron behind the forge. Even now, travelers still find an occasional nail marked with their scratch.',
    deedType: 'kindness',
    monument: 'story',
  },
  lone_wolf: {
    text: 'They say a traveler lived on the frozen ridge for months and spoke to no one. One spring morning their fire had died, leaving only an empty shelter in the snow.',
    deedType: 'folly',
    monument: 'grave',
  },
  tyrant: {
    text: 'A ruthless figure took what they needed by threats and cold steel before disappearing into the pines. The elders still warn children not to wander the trail they walked.',
    deedType: 'cruelty',
    monument: 'song',
  },
  trickster: {
    text: 'An unknown rogue fooled the hoarder and stole half the grain away under cover of storm. Some say the grain was never found, but the poor did not starve that week.',
    deedType: 'kindness',
    monument: 'story',
  },
};

export function fallbackGhostLegend(summary: RunSummary, seed = 42): GhostLegend {
  const rng = new Rng(hashSeed(seed, 'ghost_legend', summary.runId));
  const template = FALLBACK_TALES[summary.archetype] ?? FALLBACK_TALES.shepherd;

  const monuments: MonumentType[] = [...MONUMENTS];
  const chosenMonument = rng.pick(monuments);

  return {
    id: `legend_${summary.runId.slice(0, 8)}`,
    runId: summary.runId,
    legendText: template.text,
    tags: {
      archetype: summary.archetype,
      deedType: template.deedType,
      endingFamily: summary.endingFamily,
    },
    monumentType: chosenMonument,
    createdAt: new Date().toISOString(),
  };
}

export async function generateGhostLegend(
  summary: RunSummary,
  client: LlmClient | null,
  seed = 42
): Promise<{ legend: GhostLegend; source: 'llm' | 'fallback'; records: CallRecord[] }> {
  let records: CallRecord[] = [];

  if (client) {
    const res = await client.complete('P7a', {
      run_summary: {
        archetype: summary.archetype,
        ending_family: summary.endingFamily,
        defining_deeds: summary.deeds.slice(0, 3),
        saved_npcs: summary.savedNpcIds,
        abandoned_npcs: summary.abandonedNpcIds,
        days_survived: summary.daysSurvived,
      },
    });
    records = res.records;

    if (res.ok) {
      const errs = validate(P7A_SCHEMA, res.json);
      if (errs.length === 0) {
        const out = res.json as {
          legend_text: string;
          tags: { archetype: Archetype; deed_type: 'kindness' | 'cruelty' | 'sacrifice' | 'folly'; ending_family: string };
          monument_type: MonumentType;
        };

        return {
          legend: {
            id: `legend_${summary.runId.slice(0, 8)}`,
            runId: summary.runId,
            legendText: out.legend_text,
            tags: {
              archetype: out.tags.archetype,
              deedType: out.tags.deed_type,
              endingFamily: out.tags.ending_family,
            },
            monumentType: out.monument_type,
            createdAt: new Date().toISOString(),
          },
          source: 'llm',
          records,
        };
      }
    }
  }

  const fallback = fallbackGhostLegend(summary, seed);
  return { legend: fallback, source: 'fallback', records };
}

/** Places ghost monuments from historical runs into a new game state */
export function placeGhostMonuments(
  state: GameState,
  legendsPool: GhostLegend[],
  maxMonuments = 2,
  seed = 42
): PlacedMonument[] {
  if (legendsPool.length === 0) return [];
  const rng = new Rng(hashSeed(seed, 'place_monuments', state.seed));

  const eligible = [...legendsPool];
  rng.shuffle(eligible);
  const selected = eligible.slice(0, maxMonuments);

  const locations = ['cemetery', 'chapel_path', 'ridge_overlook', 'old_crossroads'];
  const placed: PlacedMonument[] = [];

  for (let i = 0; i < selected.length; i++) {
    const leg = selected[i]!;
    const loc = locations[i % locations.length]!;
    const monumentId = `monument_${leg.id}`;

    // Place structure in world
    state.structures.push({
      id: monumentId,
      kind: leg.monumentType,
    });

    placed.push({
      monumentId,
      legendId: leg.id,
      monumentType: leg.monumentType,
      legendText: leg.legendText,
      location: loc,
    });
  }

  return placed;
}
