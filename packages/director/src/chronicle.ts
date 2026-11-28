import type { Id } from '../../shared/src/index.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { P7B_SCHEMA } from './schemas.ts';
import { validate } from './schema.ts';

export interface ChroniclePage {
  page: number; // 1..6
  heading: string;
  text: string;
  scene_id: Id;
}

export interface Chronicle {
  title: string;
  pages: ChroniclePage[];
  epitaph: string;
  shareCard: {
    headline: string;
    archetype: Id;
    endingFamily: Id;
  };
}

export interface ChronicleInput {
  runId: string;
  playerTitle: string;
  archetype: Id;
  endingFamily: Id;
  keyBeats: { day: number; location: string; npcs: Id[]; eventId: Id }[];
  villagerQuotes: { npcId: Id; quote: string }[];
  unfoundSecret?: string;
}

export function fallbackChronicle(input: ChronicleInput, seed = 42): Chronicle {
  const rng = new Rng(hashSeed(seed, 'chronicle', input.runId));

  const pages: ChroniclePage[] = [
    {
      page: 1,
      heading: 'The Arrival',
      text: `When the stranger arrived at the frost-bound palisade of Hollowmere, few looked up from their work. The bitter wind carried no name, only a traveler with hollow eyes and a traveler's pack.`,
      scene_id: 'gate_arrival',
    },
    {
      page: 2,
      heading: 'The First Frost',
      text: `Days passed in the shadow of the old mill. While the stores dwindled, the stranger gathered wood and stone, proving that two working hands were worth more than ten prayers.`,
      scene_id: 'village_square',
    },
    {
      page: 3,
      heading: 'The Turn',
      text: `Trust in the valley fractured when secrets began to leak from dark cellars. The stranger stood at the center of the dispute, choosing who would eat and who would watch from the cold.`,
      scene_id: 'meeting_hall',
    },
    {
      page: 4,
      heading: 'The Heavy Price',
      text: `Survival was never free in Hollowmere. Every loaf of bread given was a debt remembered, and every locked door made enemies who held their grudges close to the chest.`,
      scene_id: 'forge_interior',
    },
    {
      page: 5,
      heading: 'The Ending',
      text: `When the final crisis culminated in the chapel square, the fate of the village was sealed. Some survived to tell the tale, but the settlement would never again be as it was before.`,
      scene_id: 'chapel_interior',
    },
    {
      page: 6,
      heading: 'The Aftermath',
      text: input.villagerQuotes.length > 0
        ? `The villagers still do not agree. "${input.villagerQuotes[0]!.quote}" Maren still remembers, while others swear the stranger was not human at all.`
        : `The settlement survived the freeze. Long after the stranger departed into the snowdrifts, their name was carved into the hearth logs of Hollowmere.`,
      scene_id: 'cemetery_monument',
    },
  ];

  return {
    title: input.playerTitle || `The Chronicle of ${input.archetype.replace('_', ' ').toUpperCase()}`,
    pages,
    epitaph: `Here walked a ${input.archetype.replace('_', ' ')}, whose footprints remain upon the frozen earth.`,
    shareCard: {
      headline: `The Story of ${input.playerTitle || 'a Wanderer'}`,
      archetype: input.archetype,
      endingFamily: input.endingFamily,
    },
  };
}

export async function generateChronicle(
  input: ChronicleInput,
  client: LlmClient | null,
  seed = 42
): Promise<{ chronicle: Chronicle; source: 'llm' | 'fallback'; records: CallRecord[] }> {
  let records: CallRecord[] = [];

  if (client) {
    const res = await client.complete('P7b', {
      run_bible: { archetype: input.archetype, ending_family: input.endingFamily },
      archetype_scores: { [input.archetype]: 1 },
      final_village_state: { hope: 5, fear: 5, hunger: 5, trust: 5, unity: 5 },
      key_events: input.keyBeats.slice(0, 6),
      missed_secrets: [input.unfoundSecret ?? 'The truth behind the sealed cellar'],
      npc_opinions: input.villagerQuotes,
      scene_library: ['gate_arrival', 'village_square', 'meeting_hall', 'forge_interior', 'chapel_interior', 'cemetery_monument'],
    });
    records = res.records;

    if (res.ok) {
      const errs = validate(P7B_SCHEMA, res.json);
      if (errs.length === 0) {
        const raw = res.json as {
          title: string;
          pages: ChroniclePage[];
          epitaph: string;
          share_card: { headline: string; archetype: Id; ending_family: Id };
        };

        return {
          chronicle: {
            title: raw.title,
            pages: raw.pages,
            epitaph: raw.epitaph,
            shareCard: {
              headline: raw.share_card.headline,
              archetype: raw.share_card.archetype,
              endingFamily: raw.share_card.ending_family,
            },
          },
          source: 'llm',
          records,
        };
      }
    }
  }

  const fallback = fallbackChronicle(input, seed);
  return { chronicle: fallback, source: 'fallback', records };
}

/** Formats a Chronicle storybook into a clean visual layout representation */
export function renderChronicleBook(chronicle: Chronicle): string {
  const lines: string[] = [];
  const border = '═'.repeat(64);
  const thin = '─'.repeat(64);

  lines.push(`╔${border}╗`);
  lines.push(`║ ${chronicle.title.toUpperCase().padEnd(62)} ║`);
  lines.push(`╠${border}╣`);

  for (const page of chronicle.pages) {
    lines.push(`║ Page ${page.page}: ${page.heading.padEnd(54)} ║`);
    lines.push(`║ Scene: [${page.scene_id}]`.padEnd(65) + '║');
    lines.push(`╟${thin}╢`);

    // Wrap words nicely
    const words = page.text.split(' ');
    let currentLine = '║ ';
    for (const w of words) {
      if (currentLine.length + w.length + 1 > 63) {
        lines.push(currentLine.padEnd(65) + '║');
        currentLine = `║ ${w} `;
      } else {
        currentLine += `${w} `;
      }
    }
    if (currentLine.trim() !== '║') {
      lines.push(currentLine.padEnd(65) + '║');
    }
    lines.push(`╟${thin}╢`);
  }

  lines.push(`║ Epitaph: "${chronicle.epitaph}"`.padEnd(65) + '║');
  lines.push(`║ Share:   "${chronicle.shareCard.headline}" (${chronicle.shareCard.archetype})`.padEnd(65) + '║');
  lines.push(`╚${border}╝`);

  return lines.join('\n');
}
