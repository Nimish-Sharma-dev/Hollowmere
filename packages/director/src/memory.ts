import type { ContentBundle, Id } from '../../shared/src/index.ts';
import type { GameState } from '../../engine/src/state.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { P5_SCHEMA } from './schemas.ts';
import { validate } from './schema.ts';

export const RUMOR_MUTATIONS = [
  'exaggerate',
  'shrink',
  'misattribute',
  'invert_motive',
  'add_rival_spin',
  'add_moral',
  'add_detail',
] as const;

export type RumorMutation = (typeof RUMOR_MUTATIONS)[number];

export interface NpcMemoryEntry {
  fact: string;
  valence: number; // -2..2
  day: number;
  tick: number;
}

export interface RumorEntry {
  id: string;
  text: string;
  mutation: RumorMutation;
  originNpcId: Id;
  spreadsTo: Id[];
  accuracy: number; // 0..1
  pointsToSecretId: Id | null;
  day: number;
  stage: number;
}

export interface PlayerJournal {
  discoveredClues: Id[];
  rumorsHeard: string[];
  relationships: Record<Id, { trust: number; lastMemory: string | null }>;
}

export interface VillageMemoryStore {
  memories: Record<Id, NpcMemoryEntry[]>;
  activeRumors: RumorEntry[];
  journal: PlayerJournal;
}

export function newVillageMemoryStore(): VillageMemoryStore {
  return {
    memories: {},
    activeRumors: [],
    journal: {
      discoveredClues: [],
      rumorsHeard: [],
      relationships: {},
    },
  };
}

export interface P5MemoryOutput {
  memories: { npc_id: Id; fact: string; valence: number }[];
  rumors: {
    text: string;
    mutation: string;
    origin_npc_id: Id;
    spreads_to: Id[];
    accuracy: number;
    points_to_secret_id: Id | null;
  }[];
}

/** Fallback rule-based rumor mutation logic when offline or model call fails */
export function mutateRumorText(originalText: string, mutation: RumorMutation, rng: Rng): string {
  switch (mutation) {
    case 'exaggerate':
      return originalText.replace(/a few|some|one/gi, 'dozens of') + ' and everyone saw it happen!';
    case 'shrink': {
      const words = originalText.split(' ');
      return words.slice(0, Math.max(4, Math.floor(words.length * 0.65))).join(' ') + '...';
    }
    case 'misattribute':
      return `They say the outsider wasn't alone; someone in the village helped them.`;
    case 'invert_motive':
      return `It wasn't done out of mercy; there was malice behind that act.`;
    case 'add_rival_spin':
      return `The guard captain claims it's proof the village order is breaking down.`;
    case 'add_moral':
      return originalText + ' Sin always leaves a footprint.';
    case 'add_detail':
      return originalText.replace('.', '') + ' while the chapel bells were tolling.';
    default:
      return originalText;
  }
}

export function fallbackMemoryAndRumors(
  eventSummary: string,
  witnessIds: Id[],
  state: GameState,
  store: VillageMemoryStore,
  seed: number
): P5MemoryOutput {
  const rng = new Rng(hashSeed(seed, 'fallback_p5', eventSummary));
  const memories: P5MemoryOutput['memories'] = [];

  for (const npcId of witnessIds) {
    const npc = state.npcs[npcId];
    const trust = npc ? npc.trust : 0;
    // Bias fact perception by current trust attitude
    const valence = trust < 0 ? -1 : trust > 1 ? 1 : 0;
    const tone = trust < 0 ? 'suspiciously' : 'openly';
    memories.push({
      npc_id: npcId,
      fact: `Observed the stranger ${tone} during "${eventSummary.slice(0, 30)}"`,
      valence,
    });
  }

  const rumors: P5MemoryOutput['rumors'] = [];
  if (witnessIds.length > 0) {
    const origin = witnessIds[0]!;
    const mutation = rng.pick([...RUMOR_MUTATIONS]);
    const aliveNpcs = Object.keys(state.npcs).filter((id) => state.npcs[id]?.alive && id !== origin);
    const spreadsTo = rng.shuffle(aliveNpcs).slice(0, 2);

    const baseText = `Whispers say the stranger was involved in ${eventSummary.slice(0, 40)}`;
    const mutated = mutateRumorText(baseText, mutation, rng);

    rumors.push({
      text: mutated,
      mutation,
      origin_npc_id: origin,
      spreads_to: spreadsTo,
      accuracy: Math.round((0.2 + 0.6 * rng.next()) * 100) / 100,
      points_to_secret_id: null,
    });
  }

  return { memories, rumors };
}

/** Processes a batch of event memories, mutates rumors, and updates the journal */
export async function processEventMemories(
  eventSummary: string,
  witnessIds: Id[],
  state: GameState,
  content: ContentBundle,
  store: VillageMemoryStore,
  day: number,
  tick: number,
  seed: number,
  client: LlmClient | null
): Promise<{ output: P5MemoryOutput; source: 'llm' | 'fallback'; records: CallRecord[] }> {
  let records: CallRecord[] = [];
  let output: P5MemoryOutput | null = null;
  let source: 'llm' | 'fallback' = 'fallback';

  if (client) {
    const witnesses = witnessIds.map((id) => {
      const card = content.npcs[id];
      const npc = state.npcs[id];
      return { id, name: card?.name ?? id, trust: npc?.trust ?? 0 };
    });

    const existingRumors = store.activeRumors.slice(-5).map((r) => ({ text: r.text, stage: r.stage }));

    const res = await client.complete('P5', {
      event_record: eventSummary,
      witnesses,
      existing_rumors: existingRumors,
    });
    records = res.records;

    if (res.ok) {
      const errs = validate(P5_SCHEMA, res.json);
      if (errs.length === 0) {
        output = res.json as P5MemoryOutput;
        source = 'llm';
      }
    }
  }

  if (!output) {
    output = fallbackMemoryAndRumors(eventSummary, witnessIds, state, store, seed);
  }

  // 1. Store NPC memories
  for (const m of output.memories) {
    if (!store.memories[m.npc_id]) store.memories[m.npc_id] = [];
    store.memories[m.npc_id]!.unshift({
      fact: m.fact,
      valence: m.valence,
      day,
      tick,
    });
    // Cap to 10 most recent facts per NPC (from specs)
    if (store.memories[m.npc_id]!.length > 10) {
      store.memories[m.npc_id] = store.memories[m.npc_id]!.slice(0, 10);
    }
  }

  // 2. Store & advance rumors
  for (const r of output.rumors) {
    const validMutation = (RUMOR_MUTATIONS as readonly string[]).includes(r.mutation)
      ? (r.mutation as RumorMutation)
      : 'exaggerate';

    store.activeRumors.unshift({
      id: `rumor_${day}_${store.activeRumors.length + 1}`,
      text: r.text,
      mutation: validMutation,
      originNpcId: r.origin_npc_id,
      spreadsTo: r.spreads_to,
      accuracy: r.accuracy,
      pointsToSecretId: r.points_to_secret_id,
      day,
      stage: 1,
    });
  }

  // 3. Update Journal
  for (const npcId of Object.keys(state.npcs)) {
    const npc = state.npcs[npcId];
    if (npc) {
      const lastFact = store.memories[npcId]?.[0]?.fact ?? null;
      store.journal.relationships[npcId] = {
        trust: npc.trust,
        lastMemory: lastFact,
      };
    }
  }

  // Add latest rumor to journal if heard
  if (output.rumors.length > 0) {
    const newest = output.rumors[0]!.text;
    if (!store.journal.rumorsHeard.includes(newest)) {
      store.journal.rumorsHeard.push(newest);
    }
  }

  return { output, source, records };
}

/** Mutates active rumors forward by one day (Rumor Propagation Step) */
export function advanceRumorsDaily(store: VillageMemoryStore, seed: number): void {
  const rng = new Rng(hashSeed(seed, 'rumor_daily_advance'));
  for (const rumor of store.activeRumors) {
    rumor.stage++;
    // Evolve the rumor over time
    if (rumor.stage === 2) {
      rumor.text = mutateRumorText(rumor.text, 'shrink', rng);
    } else if (rumor.stage >= 3) {
      rumor.text = mutateRumorText(rumor.text, 'add_moral', rng);
    }
  }
}
