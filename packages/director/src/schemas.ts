import { arr, bool, idStr, lit, nullable, num, obj, rec, str } from './schema.ts';
import type { Validator } from './schema.ts';

export const ARCHETYPES = ['lone_wolf', 'peacemaker', 'scavenger', 'tyrant', 'shepherd', 'trickster'] as const;
export const STATS = ['hope', 'fear', 'hunger', 'trust', 'unity'] as const;
export const STANCES = ['mirror', 'challenge', 'wildcard'] as const;
export const MOODS = ['calm', 'warm', 'wary', 'angry', 'afraid', 'sad', 'amused'] as const;
export const ANGLES = ['ask', 'deflect', 'confess', 'tease', 'warn', 'bargain', 'gossip', 'test'] as const;
export const INTENTS = ['ask', 'help', 'threaten', 'bargain', 'gossip', 'greet'] as const;
export const RELATION_TYPES = ['loves', 'fears', 'owes', 'resents', 'protects', 'distrusts'] as const;
export const MONUMENTS = ['grave', 'statue', 'song', 'carving', 'story'] as const;

const archetypeScores = (min: number, max: number): Validator => obj(Object.fromEntries(ARCHETYPES.map((a) => [a, num(min, max)])));
const villageStats: Validator = obj(Object.fromEntries(STATS.map((s) => [s, num(0, 10)])));
const fingerprint: Validator = obj({ crisis_id: idStr, antagonist_npc_id: idStr, ending_family: idStr, tone: idStr, twist_id: idStr });

export const P1_SCHEMA: Validator = obj({
  values: arr(str(), { max: 3 }),
  fears: arr(str(), { max: 2 }),
  archetype_scores: archetypeScores(0, 1),
  core_motivation: lit('safety', 'power', 'freedom', 'home'),
  backstory_seed: str({ min: 1 }),
  contradiction: nullable(str()),
  story_hook: str({ min: 1 }),
  spawn_preference: obj({ spawn_id: idStr, reason: str() }),
  starting_kit_id: idStr,
});

export const P2_SCHEMA: Validator = obj({
  schema_version: lit('1.0'),
  player_read: obj({ values: str(), likely_behaviour: str(), contradiction: nullable(str()) }),
  candidates: arr(
    obj({
      key: str({ min: 1 }),
      premise: str({ min: 1 }),
      crisis_id: idStr,
      antagonist_npc_id: idStr,
      central_relationship: arr(idStr, { min: 2, max: 2 }),
      tone: idStr,
      ending_family: idStr,
      twist_id: idStr,
      novelty_note: str(),
    }),
    { min: 4, max: 4 },
  ),
  chosen: str({ min: 1 }),
  choice_reason: str({ min: 1 }),
  cast_roles: arr(
    obj({ npc_id: idStr, role_id: idStr, hidden_motive: str(), secret_id: nullable(idStr), initial_attitude: num(-2, 2, true), first_impression_line: str() }),
    { min: 1 },
  ),
  crisis: obj({
    crisis_id: idStr,
    severity: num(1, 5, true),
    clock_days: num(5, 20, true),
    clues: arr(obj({ clue_id: idStr, location_id: idStr, npc_id: nullable(idStr), reveals_secret_id: idStr })),
  }),
  secrets: arr(obj({ secret_id: idStr, holder_npc_id: idStr, truth: str({ min: 1 }), clue_ids: arr(idStr, { min: 2 }) })),
  relationship_graph: arr(obj({ a: idStr, b: idStr, type: lit(...RELATION_TYPES), strength: num(1, 5, true) })),
  start: obj({ spawn_id: idStr, kit_id: idStr, weather_season_id: idStr, village_stats: villageStats }),
  arc: obj({
    act1_event_tags: arr(str()),
    midpoint_twist_id: idStr,
    act2_event_tags: arr(str()),
    act3_event_tags: arr(str()),
    possible_endings: arr(idStr, { min: 3 }),
  }),
  archetype_guess: archetypeScores(0, 1),
  opening_narration: str({ min: 1 }),
  fingerprint,
  library_gap: arr(str()),
});

export const P3_SCHEMA: Validator = obj({
  diagnosis: str({ min: 1 }),
  options_considered: arr(obj({ event_id: idStr, stance: lit(...STANCES), pitch: str(), risk: str() }), { min: 3, max: 3 }),
  chosen_event_id: idStr,
  stance: lit(...STANCES),
  slot_assignments: rec(idStr),
  npc_spawns: arr(idStr),
  tone: idStr,
  difficulty_adjust: num(-10, 10),
  dilemma_template_id: nullable(idStr),
  rumor_seed: nullable(str()),
  foreshadow_clue_id: nullable(idStr),
  player_facing_cause: str({ min: 1 }),
  plan_ahead: arr(str(), { min: 2, max: 2 }),
  library_gap: arr(str()),
});

export const P4_SCHEMA: Validator = obj({
  lines: arr(str({ min: 1, max: 400 }), { min: 1, max: 2 }),
  mood: lit(...MOODS),
  memory_candidate: nullable(str({ max: 160 })),
  trust_delta: num(-1, 1, true),
  reveals_clue_id: nullable(idStr),
  offers_action_id: nullable(idStr),
});

export const P5_SCHEMA: Validator = obj({
  memories: arr(obj({ npc_id: idStr, fact: str({ min: 1, max: 160 }), valence: num(-2, 2, true) })),
  rumors: arr(obj({ text: str({ min: 1 }), mutation: idStr, origin_npc_id: idStr, spreads_to: arr(idStr), accuracy: num(0, 1), points_to_secret_id: nullable(idStr) })),
});

export const P6_SCHEMA: Validator = obj({ modifier_id: idStr, town_crier_line: str({ min: 1, max: 200 }), flavour_line: str({ min: 1, max: 200 }), mood_colour_id: idStr });

export const P7A_SCHEMA: Validator = obj({
  legend_text: str({ min: 1, max: 400 }),
  tags: obj({ archetype: idStr, deed_type: idStr, ending_family: idStr }),
  monument_type: lit(...MONUMENTS),
});

export const P7B_SCHEMA: Validator = obj({
  title: str({ min: 1 }),
  pages: arr(obj({ page: num(1, 12, true), heading: str({ min: 1 }), text: str({ min: 1, max: 600 }), scene_id: idStr }), { min: 6, max: 6 }),
  epitaph: str({ min: 1, max: 120 }),
  share_card: obj({ headline: str({ min: 1 }), archetype: idStr, ending_family: idStr }),
});

export const P8_SCHEMA: Validator = obj({
  scores: obj({ villain: num(0, 10), crisis: num(0, 10), relationships: num(0, 10), tone: num(0, 10), opening: num(0, 10), ending_potential: num(0, 10) }),
  average: num(0, 10),
  would_players_say_same_game: bool,
  shared_elements: arr(str()),
  suggestions_to_increase_divergence: arr(str()),
});

export const P9_SCHEMA: Validator = obj({ choice_id: idStr, reason_in_character: str({ min: 1 }), typed_text_if_asked: nullable(str({ max: 120 })) });
