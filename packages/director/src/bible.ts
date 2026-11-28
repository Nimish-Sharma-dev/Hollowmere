import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { Rng, hashSeed } from '../../engine/src/rng.ts';
import { checkFingerprint, distance, fingerprintString } from './fingerprint.ts';
import type { Fingerprint, FingerprintCheck, RecentRun } from './fingerprint.ts';
import type { Crisis, Lore, Twist } from './lore.ts';
import { drawSeed } from './seed.ts';
import type { SeedDraw } from './seed.ts';
import { ARCHETYPES, RELATION_TYPES, P2_SCHEMA, P8_SCHEMA } from './schemas.ts';
import { validate } from './schema.ts';

export type Archetype = (typeof ARCHETYPES)[number];

/** Output of prompt P1 */
export interface OnboardingProfile {
  values: string[];
  fears: string[];
  archetype_scores: Record<Archetype, number>;
  core_motivation: 'safety' | 'power' | 'freedom' | 'home';
  backstory_seed: string;
  contradiction: string | null;
  story_hook: string;
  spawn_preference: { spawn_id: Id; reason: string };
  starting_kit_id: Id;
}

export interface Candidate {
  key: string;
  premise: string;
  crisis_id: Id;
  antagonist_npc_id: Id;
  central_relationship: [Id, Id];
  tone: string;
  ending_family: string;
  twist_id: Id;
  novelty_note: string;
}
export interface CastRole {
  npc_id: Id;
  role_id: string;
  hidden_motive: string;
  secret_id: Id | null;
  initial_attitude: number;
  first_impression_line: string;
}
export interface ClueRef {
  clue_id: Id;
  location_id: Id;
  npc_id: Id | null;
  reveals_secret_id: Id;
}
export interface BibleSecret {
  secret_id: Id;
  holder_npc_id: Id;
  truth: string;
  clue_ids: Id[];
}
export interface Edge {
  a: Id;
  b: Id;
  type: (typeof RELATION_TYPES)[number];
  strength: number;
}
export interface RunBible {
  schema_version: '1.0';
  player_read: { values: string; likely_behaviour: string; contradiction: string | null };
  candidates: Candidate[];
  chosen: string;
  choice_reason: string;
  cast_roles: CastRole[];
  crisis: { crisis_id: Id; severity: number; clock_days: number; clues: ClueRef[] };
  secrets: BibleSecret[];
  relationship_graph: Edge[];
  start: { spawn_id: Id; kit_id: Id; weather_season_id: Id; village_stats: Record<'hope' | 'fear' | 'hunger' | 'trust' | 'unity', number> };
  arc: { act1_event_tags: string[]; midpoint_twist_id: Id; act2_event_tags: string[]; act3_event_tags: string[]; possible_endings: Id[] };
  archetype_guess: Record<Archetype, number>;
  opening_narration: string;
  fingerprint: Fingerprint;
  library_gap: string[];
}

export function profileKeyOf(p?: OnboardingProfile | null): string {
  if (!p) return 'none';
  let top: Archetype = ARCHETYPES[0];
  for (const a of ARCHETYPES) if (p.archetype_scores[a] > p.archetype_scores[top]) top = a;
  return `${p.core_motivation}:${top}`;
}

/** The fallback builder is stricter than the validator: distance >= 3 from each of the last 10 runs, whoever played them. */
export const STRICT_WINDOW = 10;
export const STRICT_MIN_DISTANCE = 3;

const BASE_STATS = { hope: 5, fear: 3, hunger: 3, trust: 4, unity: 5 } as const;

export interface BuildOptions {
  seed: number;
  recents?: RecentRun[];
  profile?: OnboardingProfile | null;
  /** lenses used by this player's last runs (a lens never repeats within 3 runs) */
  recentLenses?: string[];
}
export interface BuildResult {
  bible: RunBible;
  seedDraw: SeedDraw;
  profileKey: string;
  /** true only if no combination satisfied the fingerprint rules (the best available was used) */
  relaxed: boolean;
  check: FingerprintCheck;
}

interface Combo {
  /** satisfies both the standard fingerprint rules and the stricter fallback rule */
  good: boolean;
  fp: Fingerprint;
  role: string;
  score: number;
  check: FingerprintCheck;
}

/**
 * Can this twist land in a run where `antag` holds `antagRole` in `crisis`?
 * The villain may satisfy it with their own role. Anyone else may only take a role that is not an antagonist
 * role of the crisis (a bible has exactly one villain).
 */
export function twistFeasible(twist: Twist, crisis: Crisis, antag: Id, antagRole: string, content: ContentBundle): boolean {
  return twistHolderOptions(twist, crisis, antag, antagRole, content).length > 0;
}

/** every (npc, role) pair that could carry the twist, given the villain */
function twistHolderOptions(twist: Twist, crisis: Crisis, antag: Id, antagRole: string, content: ContentBundle): { npc: Id; role: string }[] {
  const out: { npc: Id; role: string }[] = [];
  for (const npc of Object.keys(content.npcs).sort()) {
    for (const role of twist.requires.roles) {
      if (npc === antag ? role === antagRole : content.npcs[npc]!.allowedRoles.includes(role) && !crisis.antagonistRoles.includes(role)) out.push({ npc, role });
    }
  }
  return out;
}

/** NPCs in a finished cast that satisfy the twist's requirement */
export function twistHolders(twist: Twist, cast: { npc_id: Id; role_id: string; initial_attitude: number }[]): Id[] {
  return cast.filter((c) => twist.requires.roles.includes(c.role_id) && c.initial_attitude >= (twist.requires.minAttitude ?? -2)).map((c) => c.npc_id);
}

/** The no-LLM Run Bible builder (T019). Deterministic for a seed. */
export function buildFallbackBible(content: ContentBundle, lore: Lore, opts: BuildOptions): BuildResult {
  const rng = new Rng(hashSeed(opts.seed, 'bible'));
  const npcIds = Object.keys(content.npcs).sort();
  const recents = opts.recents ?? [];
  const profileKey = profileKeyOf(opts.profile);
  const draw = drawSeed(rng, npcIds, lore.seasons, opts.recentLenses ?? []);
  const crisisIds = Object.keys(lore.crises).sort();

  // 1. sample fingerprint combinations and score them against recent runs
  const seen = new Map<string, Combo>();
  let anyOk = false;
  for (let i = 0; i < 3000; i++) {
    if (i >= 300 && anyOk) break; // keep sampling past 300 only while nothing satisfies the fingerprint rules
    const crisis = lore.crises[rng.pick(crisisIds)]!;
    const role = rng.pick(crisis.antagonistRoles);
    const holders = npcIds.filter((n) => content.npcs[n]!.allowedRoles.includes(role));
    if (holders.length === 0) continue;
    const tone = crisis.tones.includes(draw.lens) && rng.chance(0.6) ? draw.lens : rng.pick(crisis.tones);
    const antagNpc = rng.pick(holders);
    // a twist is only offered if the cast can actually carry it (someone must hold the role it is about)
    const twists = crisis.twists.filter((t) => twistFeasible(lore.twists[t]!, crisis, antagNpc, role, content));
    if (twists.length === 0) continue;
    const fp: Fingerprint = { crisis_id: crisis.id, antagonist_npc_id: antagNpc, ending_family: rng.pick(crisis.endings), tone, twist_id: rng.pick(twists) };
    const key = fingerprintString(fp);
    if (seen.has(key)) continue;
    const check = checkFingerprint(fp, profileKey, recents);
    const strict = recents.slice(-STRICT_WINDOW).every((r) => distance(fp, r.fingerprint) >= STRICT_MIN_DISTANCE);
    const good = check.ok && strict;
    if (good) anyOk = true;
    seen.set(key, { fp, role, check, good, score: (good ? 100 : 0) + check.similarMin * 10 + check.overallMin + (tone === draw.lens ? 0.5 : 0) + rng.next() * 0.1 });
  }
  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  if (ranked.length < 4) throw new Error('buildFallbackBible: library too small to form 4 candidate directions');
  const top = ranked.slice(0, 4);
  const chosen = top[0]!;
  const crisis = lore.crises[chosen.fp.crisis_id]!;
  const antag = chosen.fp.antagonist_npc_id;

  // 2. cast
  const spotlight = draw.spotlight_npc !== antag ? draw.spotlight_npc : npcIds.filter((n) => n !== antag)[rng.int(0, npcIds.length - 2)]!;
  const used = new Set<string>([chosen.role]);
  const roleOf: Record<Id, string> = { [antag]: chosen.role };
  // reserve the NPC who carries the midpoint twist (the villain, if their own role already does)
  const twist = lore.twists[chosen.fp.twist_id]!;
  const holderOptions = twistHolderOptions(twist, crisis, antag, chosen.role, content);
  const twistHolder = (holderOptions.find((h) => h.npc === antag) ?? rng.pick(holderOptions)).npc;
  if (twistHolder !== antag) {
    const role = rng.pick(holderOptions.filter((h) => h.npc === twistHolder)).role;
    roleOf[twistHolder] = role;
    used.add(role);
  }
  for (const n of npcIds) {
    if (n === antag || roleOf[n] !== undefined) continue;
    const allowed = content.npcs[n]!.allowedRoles;
    // bystanders never take a role that names a crisis this village does not have (no "cult leader" with no cult)
    const fitsHere = (r: string): boolean => !lore.roleCrises[r] || lore.roleCrises[r]!.includes(crisis.id);
    const clean = allowed.filter((r) => !crisis.antagonistRoles.includes(r) && fitsHere(r));
    const pool = clean.length ? clean : allowed.filter(fitsHere).length ? allowed.filter(fitsHere) : allowed;
    const fresh = pool.filter((r) => !used.has(r));
    const role = rng.pick(fresh.length ? fresh : pool);
    roleOf[n] = role;
    used.add(role);
  }

  // 3. secrets (the antagonist's, plus up to two for others, spotlight first)
  const usedSecrets = new Set<Id>();
  const secrets: { secret_id: Id; holder: Id }[] = [];
  const pickSecret = (npc: Id, main: boolean): Id | null => {
    const fits = (s: { crisisIds: Id[] }): boolean => (main ? s.crisisIds.includes(crisis.id) : s.crisisIds.length === 0 || s.crisisIds.includes(crisis.id));
    const options = Object.values(lore.secrets).filter((s) => !usedSecrets.has(s.id) && fits(s) && s.holderRoles.includes(roleOf[npc]!)).map((s) => s.id).sort();
    if (!options.length) return null;
    // the villain's main secret should be the one made for THIS crisis: among the fits, keep the most specific (fewest crises listed)
    const pool = main ? (() => { const least = Math.min(...options.map((o) => lore.secrets[o]!.crisisIds.length)); return options.filter((o) => lore.secrets[o]!.crisisIds.length === least); })() : options;
    const id = rng.pick(pool);
    usedSecrets.add(id);
    return id;
  };
  const mainSecret = pickSecret(antag, true);
  if (!mainSecret) throw new Error(`no secret fits role ${chosen.role} in ${crisis.id}`);
  secrets.push({ secret_id: mainSecret, holder: antag });
  const others = [spotlight, ...rng.shuffle(npcIds.filter((n) => n !== antag && n !== spotlight))];
  for (const n of others) {
    if (secrets.length >= 3) break;
    const s = pickSecret(n, false);
    if (s) secrets.push({ secret_id: s, holder: n });
  }
  // every run needs at least 2 secrets: if the dealt roles fit none, give someone a different (non-villain) role that does
  for (const n of others) {
    if (secrets.length >= 2) break;
    for (const r of content.npcs[n]!.allowedRoles.filter((x) => !crisis.antagonistRoles.includes(x) && (!lore.roleCrises[x] || lore.roleCrises[x]!.includes(crisis.id)))) {
      const previous = roleOf[n]!;
      roleOf[n] = r;
      const s = pickSecret(n, false);
      if (s) {
        secrets.push({ secret_id: s, holder: n });
        break;
      }
      roleOf[n] = previous;
    }
  }
  const secretOf = new Map(secrets.map((s) => [s.holder, s.secret_id]));

  // 4. place the crisis clues in different places
  const mainClues = lore.secrets[mainSecret]!.clueIds;
  const placed = new Set<Id>();
  const clueRefs: ClueRef[] = mainClues.map((cid) => {
    const options = lore.clues[cid]!.locationIds;
    const free = options.filter((l) => !placed.has(l));
    const loc = rng.pick(free.length ? free : options);
    placed.add(loc);
    const npcHere = npcIds.find((n) => n !== antag && [content.npcs[n]!.home, content.npcs[n]!.work, content.npcs[n]!.gather].includes(loc)) ?? null;
    return { clue_id: cid, location_id: loc, npc_id: rng.chance(0.5) ? npcHere : null, reveals_secret_id: mainSecret };
  });

  // 5. attitudes: at least three non-zero
  const att: Record<Id, number> = {};
  for (const n of npcIds) att[n] = n === antag && draw.constraint.includes('antagonist is someone the player likes') ? 2 : rng.int(-2, 2);
  let nonzero = npcIds.filter((n) => att[n] !== 0).length;
  for (const n of rng.shuffle(npcIds)) {
    if (nonzero >= 3) break;
    if (att[n] === 0) {
      att[n] = rng.chance(0.5) ? 1 : -1;
      nonzero++;
    }
  }
  if (twist.requires.minAttitude !== undefined) att[twistHolder] = Math.max(att[twistHolder]!, twist.requires.minAttitude);
  const cast: CastRole[] = npcIds.map((n) => {
    const card = content.npcs[n]!;
    return { npc_id: n, role_id: roleOf[n]!, hidden_motive: lore.roleMotives[roleOf[n]!] ?? 'has a private reason for what they do', secret_id: secretOf.get(n) ?? null, initial_attitude: att[n]!, first_impression_line: card.arrival ?? `${card.name} watches you arrive.` };
  });

  // 6. relationships
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (a: Id, b: Id): void => {
    const k = [a, b].sort().join('|');
    if (a === b || edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push({ a, b, type: rng.pick(RELATION_TYPES), strength: rng.int(1, 5) });
  };
  addEdge(antag, spotlight);
  for (let i = 0; i < 5; i++) addEdge(rng.pick(npcIds), rng.pick(npcIds));

  // 7. start, arc, narration
  const profile = opts.profile ?? null;
  const spawnId = profile && lore.spawns[profile.spawn_preference.spawn_id] ? profile.spawn_preference.spawn_id : rng.pick(Object.keys(lore.spawns).sort());
  const kitId = profile && lore.kits[profile.starting_kit_id] ? profile.starting_kit_id : rng.pick(Object.keys(lore.kits).sort());
  const stats = { ...BASE_STATS, ...crisis.startStats };
  const spawn = lore.spawns[spawnId]!;
  const opening = `${spawn.narration} ${crisis.blurb} ${cast.find((c) => c.npc_id === spotlight)!.first_impression_line}`;
  const uniform = Object.fromEntries(ARCHETYPES.map((a) => [a, 0.17])) as Record<Archetype, number>;

  const candidates: Candidate[] = top.map((c, i) => {
    const cc = lore.crises[c.fp.crisis_id]!;
    return {
      key: 'ABCD'[i]!,
      premise: `${cc.name}: ${content.npcs[c.fp.antagonist_npc_id]!.name} is behind it, in a ${c.fp.tone.replace(/_/g, ' ')} story that may end as ${c.fp.ending_family.replace(/_/g, ' ')}.`,
      crisis_id: c.fp.crisis_id,
      antagonist_npc_id: c.fp.antagonist_npc_id,
      central_relationship: [c.fp.antagonist_npc_id, c.fp.antagonist_npc_id === spotlight ? npcIds.find((n) => n !== antag)! : spotlight],
      tone: c.fp.tone,
      ending_family: c.fp.ending_family,
      twist_id: c.fp.twist_id,
      novelty_note: `distance ${c.check.similarMin} from similar runs, ${c.check.overallMin} from all recent`,
    };
  });
  candidates[0]!.central_relationship = [antag, spotlight];

  const bible: RunBible = {
    schema_version: '1.0',
    player_read: profile
      ? { values: profile.values.join(', ') || 'unspecified', likely_behaviour: `leans ${profileKey.split(':')[1]}`, contradiction: profile.contradiction }
      : { values: 'unknown', likely_behaviour: 'unknown', contradiction: null },
    candidates,
    chosen: 'A',
    choice_reason: `Furthest from recent runs (distance ${chosen.check.similarMin} similar / ${chosen.check.overallMin} overall), matching lens ${draw.lens} where the crisis allows.`,
    cast_roles: cast,
    crisis: { crisis_id: crisis.id, severity: rng.int(2, 4), clock_days: rng.int(crisis.clockDays[0], crisis.clockDays[1]), clues: clueRefs },
    secrets: secrets.map((s) => ({ secret_id: s.secret_id, holder_npc_id: s.holder, truth: lore.secrets[s.secret_id]!.truth, clue_ids: [...lore.secrets[s.secret_id]!.clueIds] })),
    relationship_graph: edges,
    start: { spawn_id: spawnId, kit_id: kitId, weather_season_id: draw.weather_season, village_stats: stats },
    arc: {
      act1_event_tags: [crisis.eventTag, 'setup'],
      midpoint_twist_id: chosen.fp.twist_id,
      act2_event_tags: [`tone_${chosen.fp.tone}`, 'escalation'],
      act3_event_tags: ['confrontation', `ending_${chosen.fp.ending_family}`],
      possible_endings: [...crisis.endings],
    },
    archetype_guess: profile ? profile.archetype_scores : uniform,
    opening_narration: opening,
    fingerprint: chosen.fp,
    library_gap: [],
  };
  return { bible, seedDraw: draw, profileKey, relaxed: !chosen.good, check: chosen.check };
}

/* ───────────── validation ───────────── */

export interface BibleContext {
  content: ContentBundle;
  lore: Lore;
  recents?: RecentRun[];
  profileKey?: string;
  seedDraw?: SeedDraw;
}
export interface BibleValidation {
  ok: boolean;
  errors: string[];
  fingerprint: FingerprintCheck | null;
}

/** Code-side Run Bible checks (PROMPTS.md P2 + section 12). The model never gets the last word. */
export function validateRunBible(b: unknown, ctx: BibleContext): BibleValidation {
  const errors = validate(P2_SCHEMA, b);
  if (errors.length) return { ok: false, errors, fingerprint: null };
  const bible = b as RunBible;
  const { content, lore } = ctx;
  const npcIds = Object.keys(content.npcs);
  const err = (m: string): void => void errors.push(m);
  const crisis = lore.crises[bible.crisis.crisis_id];
  if (!crisis) err(`unknown crisis ${bible.crisis.crisis_id}`);
  const fp = bible.fingerprint;
  if (!lore.tones.includes(fp.tone)) err(`unknown tone ${fp.tone}`);
  if (!lore.endings.includes(fp.ending_family)) err(`unknown ending ${fp.ending_family}`);
  if (!lore.twists[fp.twist_id]) err(`unknown twist ${fp.twist_id}`);
  if (!content.npcs[fp.antagonist_npc_id]) err(`unknown antagonist ${fp.antagonist_npc_id}`);
  if (!lore.spawns[bible.start.spawn_id]) err(`unknown spawn ${bible.start.spawn_id}`);
  if (!lore.kits[bible.start.kit_id]) err(`unknown kit ${bible.start.kit_id}`);
  if (!lore.seasons.includes(bible.start.weather_season_id)) err(`unknown weather_season ${bible.start.weather_season_id}`);

  // cast: every NPC exactly once, with a role from their card
  const castIds = bible.cast_roles.map((c) => c.npc_id);
  if (new Set(castIds).size !== castIds.length) err('duplicate NPC in cast_roles');
  for (const n of npcIds) if (!castIds.includes(n)) err(`cast_roles is missing ${n}`);
  for (const c of bible.cast_roles) {
    const card = content.npcs[c.npc_id];
    if (!card) err(`unknown NPC ${c.npc_id}`);
    else if (!card.allowedRoles.includes(c.role_id)) err(`${c.npc_id} cannot take role ${c.role_id}`);
  }
  const roleOf = Object.fromEntries(bible.cast_roles.map((c) => [c.npc_id, c.role_id]));
  if (crisis) {
    const villains = bible.cast_roles.filter((c) => crisis.antagonistRoles.includes(c.role_id));
    if (villains.length !== 1) err(`expected exactly one antagonist role holder, found ${villains.length}`);
    else if (villains[0]!.npc_id !== fp.antagonist_npc_id) err('fingerprint antagonist is not the NPC holding the antagonist role');
    if (!crisis.tones.includes(fp.tone)) err(`tone ${fp.tone} does not suit ${crisis.id}`);
    if (!crisis.endings.includes(fp.ending_family)) err(`ending ${fp.ending_family} does not suit ${crisis.id}`);
    if (!crisis.twists.includes(fp.twist_id)) err(`twist ${fp.twist_id} does not suit ${crisis.id}`);
    for (const e of bible.arc.possible_endings) if (!lore.endings.includes(e)) err(`unknown possible ending ${e}`);
    if (!bible.arc.possible_endings.includes(fp.ending_family)) err('possible_endings must include the fingerprint ending');
    if (bible.arc.midpoint_twist_id !== fp.twist_id) err('midpoint twist must match the fingerprint twist');
    const tw = lore.twists[fp.twist_id];
    if (tw && twistHolders(tw, bible.cast_roles).length === 0) err(`twist ${fp.twist_id} has no one to land on: it needs an NPC with role ${tw.requires.roles.join(' or ')}${tw.requires.minAttitude !== undefined ? ' who starts friendly toward the player' : ''}`);
  }

  // secrets and clues
  for (const s of bible.secrets) {
    const def = lore.secrets[s.secret_id];
    if (!def) {
      err(`unknown secret ${s.secret_id}`);
      continue;
    }
    if (!def.holderRoles.includes(roleOf[s.holder_npc_id] ?? '')) err(`${s.holder_npc_id} (role ${roleOf[s.holder_npc_id]}) cannot hold ${s.secret_id}`);
    if (crisis && def.crisisIds.length > 0 && !def.crisisIds.includes(crisis.id)) err(`secret ${s.secret_id} does not fit crisis ${crisis.id}`);
    if (s.clue_ids.length < 2) err(`secret ${s.secret_id} needs at least 2 clues`);
    for (const c of s.clue_ids) if (!def.clueIds.includes(c)) err(`clue ${c} does not belong to secret ${s.secret_id}`);
  }
  const holder = bible.secrets.find((s) => s.holder_npc_id === fp.antagonist_npc_id);
  if (!holder) err('the antagonist must hold a secret');
  else {
    if (crisis && !lore.secrets[holder.secret_id]?.crisisIds.includes(crisis.id)) err(`the antagonist's secret ${holder.secret_id} does not fit crisis ${crisis.id}`);
    const refs = bible.crisis.clues.filter((c) => c.reveals_secret_id === holder.secret_id);
    const locs = new Set(refs.map((c) => c.location_id));
    if (locs.size < 2) err('the antagonist\'s secret needs clues in at least 2 different places');
  }
  for (const c of bible.crisis.clues) {
    const def = lore.clues[c.clue_id];
    if (!def) err(`unknown clue ${c.clue_id}`);
    else if (!def.locationIds.includes(c.location_id)) err(`clue ${c.clue_id} cannot be placed at ${c.location_id}`);
    if (!content.locations.includes(c.location_id)) err(`unknown location ${c.location_id}`);
    if (c.npc_id !== null && !content.npcs[c.npc_id]) err(`clue ${c.clue_id} names unknown NPC ${c.npc_id}`);
  }
  for (const c of bible.secrets.flatMap((s) => s.clue_ids)) if (!lore.clues[c]) err(`unknown clue ${c}`);

  // relationships
  for (const e of bible.relationship_graph) {
    if (!content.npcs[e.a] || !content.npcs[e.b]) err(`edge ${e.a}-${e.b} names an unknown NPC`);
    if (e.a === e.b) err(`edge ${e.a}-${e.b} is a self-loop`);
  }
  // attitudes
  if (bible.cast_roles.filter((c) => c.initial_attitude !== 0).length < 3) err('at least 3 NPCs need a non-zero initial attitude');
  // four distinct candidate directions; the chosen one matches the fingerprint
  const keys = bible.candidates.map((c) => fingerprintString({ crisis_id: c.crisis_id, antagonist_npc_id: c.antagonist_npc_id, ending_family: c.ending_family, tone: c.tone, twist_id: c.twist_id }));
  if (new Set(keys).size !== 4) err('the 4 candidates must be distinct');
  const chosen = bible.candidates.find((c) => c.key === bible.chosen);
  if (!chosen) err(`chosen "${bible.chosen}" is not a candidate`);
  else if (fingerprintString({ crisis_id: chosen.crisis_id, antagonist_npc_id: chosen.antagonist_npc_id, ending_family: chosen.ending_family, tone: chosen.tone, twist_id: chosen.twist_id }) !== fingerprintString(fp)) err('fingerprint does not match the chosen candidate');
  // forbidden trope (from the seed draw)
  if (ctx.seedDraw) {
    const text = `${bible.opening_narration} ${bible.candidates.map((c) => c.premise).join(' ')}`.toLowerCase();
    if (text.includes(ctx.seedDraw.forbidden_trope.toLowerCase())) err(`uses the forbidden trope "${ctx.seedDraw.forbidden_trope}"`);
  }
  // anti-repetition
  const fpc = checkFingerprint(fp, ctx.profileKey ?? 'none', ctx.recents ?? []);
  if (!fpc.ok) for (const r of fpc.reasons) err(`fingerprint: ${r}`);
  return { ok: errors.length === 0, errors, fingerprint: fpc };
}

/* ───────────── mock divergence judge (P8 shape, no LLM) ───────────── */

const jaccardDistance = (a: Set<string>, b: Set<string>): number => {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return 1 - inter / union.size;
};

export interface JudgeResult {
  scores: { villain: number; crisis: number; relationships: number; tone: number; opening: number; ending_potential: number };
  average: number;
  would_players_say_same_game: boolean;
  shared_elements: string[];
  suggestions_to_increase_divergence: string[];
}

export function judgeDivergence(a: RunBible, b: RunBible): JudgeResult {
  const roleA = a.cast_roles.find((c) => c.npc_id === a.fingerprint.antagonist_npc_id)?.role_id;
  const roleB = b.cast_roles.find((c) => c.npc_id === b.fingerprint.antagonist_npc_id)?.role_id;
  const villain = a.fingerprint.antagonist_npc_id !== b.fingerprint.antagonist_npc_id ? 10 : roleA !== roleB ? 5 : 0;
  const crisis = a.crisis.crisis_id !== b.crisis.crisis_id ? 10 : a.fingerprint.twist_id !== b.fingerprint.twist_id ? 3 : 0;
  const edges = (x: RunBible): Set<string> => new Set(x.relationship_graph.map((e) => `${[e.a, e.b].sort().join('-')}:${e.type}`));
  const relationships = Math.round(jaccardDistance(edges(a), edges(b)) * 100) / 10;
  const tone = a.fingerprint.tone !== b.fingerprint.tone ? 10 : 0;
  const opening = (a.start.spawn_id !== b.start.spawn_id ? 4 : 0) + (a.start.kit_id !== b.start.kit_id ? 3 : 0) + (a.start.weather_season_id !== b.start.weather_season_id ? 3 : 0);
  const endings = Math.round(jaccardDistance(new Set(a.arc.possible_endings), new Set(b.arc.possible_endings)) * 100) / 10 + (a.fingerprint.ending_family !== b.fingerprint.ending_family ? 3 : 0);
  const ending_potential = Math.min(10, endings);
  const scores = { villain, crisis, relationships, tone, opening, ending_potential };
  const average = Math.round(((villain + crisis + relationships + tone + opening + ending_potential) / 6) * 100) / 100;
  const shared: string[] = [];
  if (villain === 0) shared.push('same antagonist');
  if (crisis === 0) shared.push('same crisis');
  if (tone === 0) shared.push('same tone');
  if (opening === 0) shared.push('same opening');
  const out: JudgeResult = { scores, average, would_players_say_same_game: average < 4, shared_elements: shared, suggestions_to_increase_divergence: shared.map((s) => `vary: ${s}`) };
  const errs = validate(P8_SCHEMA, out);
  if (errs.length) throw new Error(`judge produced an invalid result: ${errs.join('; ')}`);
  return out;
}

export interface GateResult {
  pairs: number;
  meanAverage: number;
  axisMeans: JudgeResult['scores'];
  samePct: number;
  pass: boolean;
}

/** PROMPTS.md P8 gate (starting point): mean average >= 6, no axis mean < 3, "same game" in <= 10% of pairs. */
export function divergenceGate(bibles: RunBible[], pairCount: number, rng: Rng): GateResult {
  const axes = { villain: 0, crisis: 0, relationships: 0, tone: 0, opening: 0, ending_potential: 0 };
  let sum = 0;
  let same = 0;
  for (let i = 0; i < pairCount; i++) {
    const x = rng.int(0, bibles.length - 1);
    let y = rng.int(0, bibles.length - 1);
    if (y === x) y = (y + 1) % bibles.length;
    const r = judgeDivergence(bibles[x]!, bibles[y]!);
    sum += r.average;
    if (r.would_players_say_same_game) same++;
    for (const k of Object.keys(axes) as (keyof typeof axes)[]) axes[k] += r.scores[k];
  }
  for (const k of Object.keys(axes) as (keyof typeof axes)[]) axes[k] = Math.round((axes[k] / pairCount) * 100) / 100;
  const meanAverage = Math.round((sum / pairCount) * 100) / 100;
  const samePct = (same / pairCount) * 100;
  return { pairs: pairCount, meanAverage, axisMeans: axes, samePct, pass: meanAverage >= 6 && Object.values(axes).every((v) => v >= 3) && samePct <= 10 };
}

export { distance };
