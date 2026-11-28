import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import { currentPhase } from '../../engine/src/state.ts';
import type { GameState } from '../../engine/src/state.ts';
import { adjustTrust, npcLocation } from '../../engine/src/village.ts';
import type { RunBible } from './bible.ts';
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { ANGLES, INTENTS, MOODS } from './schemas.ts';
import { validate } from './schema.ts';
import { P4_SCHEMA } from './schemas.ts';
import { sanitizeTyped } from './sanitize.ts';

export type Angle = (typeof ANGLES)[number];
export type Intent = (typeof INTENTS)[number];

/** actions an NPC may offer in conversation; anything else a model invents is rejected */
export const KNOWN_ACTIONS = ['trade', 'ask_about_rumor', 'request_help', 'end_conversation'] as const;

export interface DialogueOutput {
  lines: string[];
  mood: (typeof MOODS)[number];
  memory_candidate: string | null;
  trust_delta: number;
  reveals_clue_id: Id | null;
  offers_action_id: Id | null;
}

export interface DialogueContext {
  state: GameState;
  content: ContentBundle;
  bible: RunBible;
  npcId: Id;
  intent: Intent;
  angle: Angle;
  /** free text the player typed, if any (untrusted) */
  typedText?: unknown;
  /** true when the story has reached the point where this NPC may give up a clue */
  clueGateOpen: boolean;
  seed: number;
}

export interface DialogueResult {
  lines: string[];
  mood: DialogueOutput['mood'];
  source: 'llm' | 'fallback';
  fallbackReason: string | null;
  trustApplied: number;
  clueRevealed: Id | null;
  actionOffered: Id | null;
  records: CallRecord[];
  /** true when a pre-generated reply was used instead of a fresh model call */
  usedPrefetch: boolean;
}

/** Template lines by angle (placeholder bank; the plan wants 6+ per NPC per angle later, T015). */
const TEMPLATES: Record<Angle, string[]> = {
  ask: ['{name} considers that for a moment. "I will tell you what I can."', '"That is a fair question," {name} says, choosing the words.', '{name} looks at you. "Ask it plainly, and I will answer plainly."'],
  deflect: ['"Not now," {name} says, and turns the talk elsewhere.', '{name} shrugs. "Does it matter? There is work to do."', '"You would be better off asking someone else," {name} says.'],
  confess: ['{name} lowers their voice. "There is something I have not said."', '"I should have told you sooner," {name} admits.', '{name} hesitates, then nods. "You deserve to hear it."'],
  tease: ['{name} almost smiles. "You are persistent, I will give you that."', '"Careful," {name} says lightly. "You might learn something."', '{name} raises an eyebrow. "Is that how you open a conversation?"'],
  warn: ['"Watch yourself," {name} says quietly.', '{name} glances around. "Not everyone here means well."', '"Be careful who you trust," {name} murmurs.'],
  bargain: ['"Everything has a price," {name} says. "Name yours."', '{name} folds their arms. "What are you offering?"', '"We can talk terms," {name} allows.'],
  gossip: ['{name} leans in. "You did not hear it from me, but..."', '"People are talking," {name} says.', '{name} lowers their voice. "Have you heard what they are saying?"'],
  test: ['{name} studies you. "Tell me why I should trust you."', '"Prove it," {name} says, and waits.', '{name} says nothing for a long moment, watching.'],
};

export function fallbackDialogue(ctx: Pick<DialogueContext, 'content' | 'npcId' | 'angle' | 'seed'>): DialogueOutput {
  const card = ctx.content.npcs[ctx.npcId]!;
  const rng = new Rng(hashSeed(ctx.seed, 'fallback_dialogue', ctx.npcId, ctx.angle));
  const line = rng.pick(TEMPLATES[ctx.angle]).replace('{name}', card.name);
  const tic = card.tics && rng.chance(0.5) ? ` ${card.name} ${rng.pick(card.tics)}.` : '';
  return { lines: [(line + tic).slice(0, 400)], mood: 'calm', memory_candidate: null, trust_delta: 0, reveals_clue_id: null, offers_action_id: null };
}

/** Clues this NPC may reveal: those of secrets they hold, and only when the gate is open. */
export function revealableClues(bible: RunBible, npcId: Id): Id[] {
  return bible.secrets.filter((s) => s.holder_npc_id === npcId).flatMap((s) => s.clue_ids);
}

/** Semantic checks beyond the schema: ids must be ones the game offered. */
export function checkDialogue(out: DialogueOutput, ctx: DialogueContext): string[] {
  const errs: string[] = [];
  if (out.reveals_clue_id !== null) {
    if (!ctx.clueGateOpen) errs.push('clue revealed while the gate is closed');
    else if (!revealableClues(ctx.bible, ctx.npcId).includes(out.reveals_clue_id)) errs.push(`clue ${out.reveals_clue_id} is not this NPC's to reveal`);
  }
  if (out.offers_action_id !== null && !(KNOWN_ACTIONS as readonly string[]).includes(out.offers_action_id)) errs.push(`unknown action ${out.offers_action_id}`);
  return errs;
}

function buildVars(ctx: DialogueContext, typed: string): Record<string, unknown> {
  const card = ctx.content.npcs[ctx.npcId]!;
  const npc = ctx.state.npcs[ctx.npcId]!;
  const cast = ctx.bible.cast_roles.find((c) => c.npc_id === ctx.npcId);
  const secret = ctx.bible.secrets.find((s) => s.holder_npc_id === ctx.npcId);
  return {
    npc_name: card.name,
    npc_card: { name: card.name, title: card.title, personality: card.personality, speech_style: card.speechStyle, tics: card.tics },
    role: npc.role,
    secret_state: secret ? { holds_secret: true, truth: secret.truth, motive: cast?.hidden_motive } : { holds_secret: false },
    memory_facts: [],
    trust: npc.trust,
    rumors_known: [],
    world_snapshot: { village: ctx.state.village, weather: ctx.state.weather },
    scene_context: { location: npcLocation(ctx.state, ctx.content, ctx.npcId), phase: currentPhase(ctx.state) },
    player_intent: typed ? `${ctx.intent} ${sanitizeTyped(typed).wrapped}` : ctx.intent,
    angle: ctx.angle,
    clue_gate_open: ctx.clueGateOpen,
  };
}

/** Apply a validated reply to the game. Only trust (clamped) and an allowed clue can change. */
export function applyDialogue(ctx: DialogueContext, out: DialogueOutput): { trustApplied: number; clueRevealed: Id | null } {
  const npc = ctx.state.npcs[ctx.npcId]!;
  const before = npc.trust;
  adjustTrust(ctx.state, ctx.npcId, Math.max(-1, Math.min(1, out.trust_delta)));
  let clue: Id | null = null;
  if (out.reveals_clue_id && ctx.clueGateOpen && !ctx.state.plantedClues.includes(out.reveals_clue_id)) {
    ctx.state.plantedClues.push(out.reveals_clue_id);
    clue = out.reveals_clue_id;
  }
  return { trustApplied: Math.round((npc.trust - before) * 100) / 100, clueRevealed: clue };
}

export interface PrefetchedDialogue {
  npcId: Id;
  intent: Intent;
  angle: Angle;
  output: DialogueOutput;
}

/** The angle the first reply is most likely to need (a wary NPC tests you, otherwise they answer a question). */
export function likelyAngle(state: GameState, npcId: Id): Angle {
  return state.npcs[npcId]!.trust < 0 ? 'test' : 'ask';
}

/**
 * Pre-generation for dialogue (BUILD_PLAN section 9): when a conversation is likely (the player is walking toward
 * an NPC), generate the first reply for a plain greeting in the background. `requestDialogue` uses it only if the
 * player's actual choice matches and it is still valid; otherwise it is thrown away.
 */
export async function prefetchDialogue(base: Omit<DialogueContext, 'intent' | 'angle' | 'typedText'>, client: LlmClient | null): Promise<{ prefetched: PrefetchedDialogue | null; records: CallRecord[] }> {
  if (!client) return { prefetched: null, records: [] };
  const ctx: DialogueContext = { ...base, intent: 'greet', angle: likelyAngle(base.state, base.npcId) };
  const res = await client.complete('P4', buildVars(ctx, ''));
  if (!res.ok) return { prefetched: null, records: res.records };
  const cand = res.json as DialogueOutput;
  if (validate(P4_SCHEMA, cand).length || checkDialogue(cand, ctx).length) return { prefetched: null, records: res.records };
  return { prefetched: { npcId: ctx.npcId, intent: ctx.intent, angle: ctx.angle, output: cand }, records: res.records };
}

/**
 * One NPC reply: sanitize -> (pre-generated reply, or P4 via the client) -> schema + id checks -> apply.
 * Any failure (no client, timeout, bad JSON, bad ids) uses a template line and changes nothing but a line of text.
 */
export async function requestDialogue(ctx: DialogueContext, client: LlmClient | null, prefetched: PrefetchedDialogue | null = null): Promise<DialogueResult> {
  const typed = ctx.typedText === undefined ? '' : sanitizeTyped(ctx.typedText).text;
  let records: CallRecord[] = [];
  let out: DialogueOutput | null = null;
  let reason: string | null = 'no_client';
  let usedPrefetch = false;
  const prefetchUsable = prefetched !== null && prefetched.npcId === ctx.npcId && prefetched.intent === ctx.intent && prefetched.angle === ctx.angle && typed === '' && checkDialogue(prefetched.output, ctx).length === 0;
  if (prefetchUsable && prefetched) {
    out = prefetched.output;
    reason = null;
    usedPrefetch = true;
  } else if (client) {
    const res = await client.complete('P4', buildVars(ctx, typed));
    records = res.records;
    if (!res.ok) reason = res.reason;
    else {
      const schemaErrs = validate(P4_SCHEMA, res.json);
      const cand = res.json as DialogueOutput;
      const semErrs = schemaErrs.length ? schemaErrs : checkDialogue(cand, ctx);
      if (semErrs.length === 0) {
        out = cand;
        reason = null;
      } else reason = `rejected: ${semErrs[0]}`;
    }
  }
  const source: 'llm' | 'fallback' = out ? 'llm' : 'fallback';
  if (!out) {
    out = fallbackDialogue(ctx);
    for (const r of records) r.fallbackUsed = true;
  }
  const applied = applyDialogue(ctx, out);
  return { lines: out.lines, mood: out.mood, source, fallbackReason: reason, trustApplied: applied.trustApplied, clueRevealed: applied.clueRevealed, actionOffered: out.offers_action_id, records, usedPrefetch };
}
