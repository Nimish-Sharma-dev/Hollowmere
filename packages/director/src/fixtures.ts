import { REGISTRY } from './prompts.ts';
import type { PromptId } from './prompts.ts';

/** sample values for every template variable of a prompt (for tests, demos and smoke runs) */
export function sampleVars(id: PromptId): Record<string, unknown> {
  return Object.fromEntries(REGISTRY[id].vars.map((v) => [v, `[[sample ${v}]]`]));
}

/**
 * The fixture set: one valid model output per prompt that does not depend on the story library.
 * (P2 and P3 fixtures are produced by the real fallback builder and fallback Director, see the tests.)
 */
export const PROMPT_FIXTURES: Record<Exclude<PromptId, 'P2' | 'P3'>, unknown> = {
  P1: {
    values: ['loyalty', 'honesty'], fears: ['the cold'],
    archetype_scores: { lone_wolf: 0.2, peacemaker: 0.7, scavenger: 0.3, tyrant: 0.1, shepherd: 0.8, trickster: 0.2 },
    core_motivation: 'home', backstory_seed: 'You once kept a lighthouse and lost it.', contradiction: 'Values honesty but hides a past.', story_hook: 'A letter reached you that was meant for someone else.',
    spawn_preference: { spawn_id: 'gate_arrival', reason: 'You prefer to see who is watching first.' }, starting_kit_id: 'trader',
  },
  P4: { lines: ['Maren taps her hammer against her palm. "Say it plainly."'], mood: 'wary', memory_candidate: 'The stranger asked about the forge.', trust_delta: 0, reveals_clue_id: null, offers_action_id: 'trade' },
  P5: {
    memories: [{ npc_id: 'tobin', fact: 'Saw the player carry water to the chapel.', valence: 1 }],
    rumors: [{ text: 'They say the stranger fed the whole mill.', mutation: 'exaggeration', origin_npc_id: 'tobin', spreads_to: ['pip', 'edda'], accuracy: 0.6, points_to_secret_id: null }],
  },
  P6: { modifier_id: 'low_fog', town_crier_line: 'Fog lies low on the valley this morning.', flavour_line: 'Sound carries oddly in the white.', mood_colour_id: 'grey_blue' },
  P7a: { legend_text: 'They say a stranger once fed the mill and left before the thaw.', tags: { archetype: 'shepherd', deed_type: 'kindness', ending_family: 'shepherd_saved' }, monument_type: 'carving' },
  P7b: {
    title: 'The Winter of the Quiet Stranger',
    pages: [1, 2, 3, 4, 5, 6].map((n) => ({ page: n, heading: `Page ${n}`, text: `A short passage for page ${n}.`, scene_id: `scene_${n}` })),
    epitaph: 'They kept the lamp lit.', share_card: { headline: 'The Quiet Stranger', archetype: 'shepherd', ending_family: 'shepherd_saved' },
  },
  P8: { scores: { villain: 8, crisis: 7, relationships: 6, tone: 7, opening: 5, ending_potential: 6 }, average: 6.5, would_players_say_same_game: false, shared_elements: [], suggestions_to_increase_divergence: [] },
  P9: { choice_id: 'help_neighbour', reason_in_character: 'It is what I would want done for me.', typed_text_if_asked: null },
};
