import { isId } from '../../shared/src/index.ts';
import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { validateEvent } from '../../engine/src/events.ts';

export interface Issue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

/** Static checks on a content bundle. Errors must be fixed; warnings are design smells. */
export function lintContent(c: ContentBundle): Issue[] {
  const out: Issue[] = [];
  const err = (where: string, message: string): void => void out.push({ level: 'error', where, message });
  const warn = (where: string, message: string): void => void out.push({ level: 'warning', where, message });

  const tables: [string, Record<Id, { id: Id }>][] = [
    ['item', c.items], ['recipe', c.recipes], ['node', c.nodes], ['enemy', c.enemies],
    ['structure', c.structures], ['npc', c.npcs], ['event', c.events],
  ];
  for (const [kind, table] of tables) {
    for (const [key, def] of Object.entries(table)) {
      if (!isId(key)) err(`${kind} ${key}`, 'key is not snake_case');
      if (def.id !== key) err(`${kind} ${key}`, `id "${def.id}" does not match its key`);
    }
  }
  const seenLoc = new Set<string>();
  for (const l of c.locations) {
    if (!isId(l)) err(`location ${l}`, 'not snake_case');
    if (seenLoc.has(l)) err(`location ${l}`, 'duplicate');
    seenLoc.add(l);
  }
  const item = (where: string, id: Id): void => {
    if (!c.items[id]) err(where, `unknown item "${id}"`);
  };

  for (const it of Object.values(c.items)) {
    if (!(it.stack >= 1) || !Number.isInteger(it.stack)) err(`item ${it.id}`, 'stack must be a positive integer');
    if (it.kind === 'food' && !it.food) err(`item ${it.id}`, 'food item without food stats');
    if (it.kind === 'weapon' && !it.weapon) err(`item ${it.id}`, 'weapon item without weapon stats');
    if (it.kind === 'tool' && !it.tool) err(`item ${it.id}`, 'tool item without tool stats');
    if (it.kind === 'clothing' && it.warmth === undefined) err(`item ${it.id}`, 'clothing without warmth');
    if (it.kind === 'remedy' && !it.remedy) err(`item ${it.id}`, 'remedy without heal value');
    if (it.weapon?.ranged) item(`item ${it.id}`, it.weapon.ranged.ammo);
  }
  for (const r of Object.values(c.recipes)) {
    item(`recipe ${r.id}`, r.output.item);
    for (const i of r.inputs) item(`recipe ${r.id}`, i.item);
    if (r.inputs.length === 0) err(`recipe ${r.id}`, 'no inputs');
    if (r.output.qty < 1 || r.inputs.some((i) => i.qty < 1)) err(`recipe ${r.id}`, 'quantities must be >= 1');
  }
  const toolTypes = new Set(Object.values(c.items).flatMap((i) => (i.tool ? [i.tool.type] : [])));
  for (const n of Object.values(c.nodes)) {
    for (const y of n.yields) {
      item(`node ${n.id}`, y.item);
      if (y.min > y.max || y.min < 0) err(`node ${n.id}`, `bad yield range for ${y.item}`);
    }
    if (n.tool && !toolTypes.has(n.tool)) err(`node ${n.id}`, `no item provides tool type "${n.tool}"`);
    if (n.uses < 1) err(`node ${n.id}`, 'uses must be >= 1');
  }
  for (const e of Object.values(c.enemies)) {
    for (const d of e.drops) {
      item(`enemy ${e.id}`, d.item);
      if (d.chance < 0 || d.chance > 1 || d.min > d.max) err(`enemy ${e.id}`, `bad drop ${d.item}`);
    }
    if (e.hp <= 0 || e.damage <= 0 || e.speed <= 0) err(`enemy ${e.id}`, 'hp, damage and speed must be positive');
    if (e.attackRange > e.sight) warn(`enemy ${e.id}`, 'attack range exceeds sight range');
  }
  for (const s of Object.values(c.structures)) for (const i of s.cost) item(`structure ${s.id}`, i.item);

  for (const n of Object.values(c.npcs)) {
    for (const k of ['home', 'work', 'gather'] as const) if (!seenLoc.has(n[k])) err(`npc ${n.id}`, `${k} location "${n[k]}" is not in locations`);
    if (n.allowedRoles.length < 3) err(`npc ${n.id}`, `needs at least 3 allowed roles (has ${n.allowedRoles.length})`);
    if (new Set(n.allowedRoles).size !== n.allowedRoles.length) err(`npc ${n.id}`, 'duplicate allowed role');
    for (const r of n.allowedRoles) if (!isId(r)) err(`npc ${n.id}`, `role "${r}" is not snake_case`);
    if (!n.name.trim()) err(`npc ${n.id}`, 'empty name');
    if (!n.title?.trim()) err(`npc ${n.id}`, 'missing title');
    if (!n.personality || n.personality.length < 40) err(`npc ${n.id}`, 'personality missing or too short (min 40 chars)');
    if (!n.speechStyle || n.speechStyle.length < 30) err(`npc ${n.id}`, 'speechStyle missing or too short (min 30 chars)');
    if (!n.tics || n.tics.length < 3) err(`npc ${n.id}`, 'needs at least 3 tics');
    if (!n.arrival || n.arrival.length < 30 || n.arrival.length > 200) err(`npc ${n.id}`, 'arrival line missing or not 30 to 200 characters');
    else if (!n.arrival.includes(n.name.split(' ').pop()!)) err(`npc ${n.id}`, 'arrival line should name the NPC');
    if (n.tics && new Set(n.tics).size !== n.tics.length) err(`npc ${n.id}`, 'duplicate tics');
  }
  if (Object.keys(c.npcs).length === 0) err('npcs', 'no NPCs defined');
  const referenced = new Set<Id>(c.thresholds.map((t) => t.event));
  for (const ev of Object.values(c.events)) for (const m of ev.effects) {
    const mm = /^schedule event ([a-z][a-z0-9_]*) in \d+$/.exec(m);
    if (mm) referenced.add(mm[1]!);
  }
  for (const ev of Object.values(c.events)) {
    for (const m of validateEvent(ev, c)) err(`event ${ev.id}`, m);
    if (ev.effects.length === 0) err(`event ${ev.id}`, 'no effects');
    if (ev.beats.length === 0) warn(`event ${ev.id}`, 'no text beats');
    if (!ev.requirements && !ev.cooldownDays && ev.maxRuns === undefined && !referenced.has(ev.id)) warn(`event ${ev.id}`, 'no requirements, cooldown or run limit, and not triggered by a threshold or schedule: it could fire constantly');
  }
  for (const t of c.thresholds) {
    if (!isId(t.id)) err(`threshold ${t.id}`, 'id is not snake_case');
    if (!c.events[t.event]) err(`threshold ${t.id}`, `unknown event "${t.event}"`);
    if (t.conditions.length === 0) err(`threshold ${t.id}`, 'no conditions');
  }
  // events with slots should be fillable by at least one card-level assignment
  const cov = coverage(c);
  for (const e of cov.events) {
    if (e.assignments === 0) err(`event ${e.id}`, 'no NPC combination can ever fill its slots');
    for (const sl of e.slots) if (sl.candidates < 2) err(`event ${e.id}`, `slot "${sl.slot}" has only ${sl.candidates} possible NPC(s); every slot needs at least 2`);
  }
  for (const [id, v] of Object.entries(cov.npcs)) if (v.events === 0) warn(`npc ${id}`, 'can appear in no event');
  const usedRoles = new Set(Object.keys(cov.roles));
  for (const n of Object.values(c.npcs)) for (const r of n.allowedRoles) if (!usedRoles.has(r)) warn(`npc ${n.id}`, `role "${r}" is used by no event slot`);
  return out;
}

export interface EventCoverage {
  id: Id;
  slots: { slot: string; candidates: number }[];
  /** distinct NPC-to-slot fillings possible if NPCs could take any of their allowed roles */
  assignments: number;
}

export interface Coverage {
  events: EventCoverage[];
  /** role -> events that use it */
  roles: Record<string, Id[]>;
  /** tag -> events carrying it (tone, kind, ...) */
  tags: Record<string, Id[]>;
  npcs: Record<Id, { roles: number; events: number }>;
  totalAssignments: number;
}

/** Card-level potential: how much variety the content can produce before any run assigns roles. */
export function coverage(c: ContentBundle): Coverage {
  const roles: Record<string, Id[]> = {};
  const tags: Record<string, Id[]> = {};
  const events: EventCoverage[] = [];
  const npcEvents: Record<Id, Set<Id>> = {};
  const npcIds = Object.keys(c.npcs).sort();
  for (const n of npcIds) npcEvents[n] = new Set();

  for (const id of Object.keys(c.events).sort()) {
    const ev = c.events[id]!;
    for (const t of ev.tags) (tags[t] ??= []).push(id);
    const slotNames = Object.keys(ev.slots).sort();
    const cands = slotNames.map((s) => npcIds.filter((n) => c.npcs[n]!.allowedRoles.some((r) => ev.slots[s]!.roles.includes(r))));
    for (const s of slotNames) for (const r of ev.slots[s]!.roles) (roles[r] ??= []).includes(id) || roles[r]!.push(id);
    let count = 0;
    const used = new Set<Id>();
    const go = (i: number): void => {
      if (i === slotNames.length) {
        count++;
        return;
      }
      for (const n of cands[i]!) {
        if (used.has(n)) continue;
        used.add(n);
        go(i + 1);
        used.delete(n);
      }
    };
    go(0);
    cands.forEach((list) => list.forEach((n) => npcEvents[n]!.add(id)));
    events.push({ id, slots: slotNames.map((slot, i) => ({ slot, candidates: cands[i]!.length })), assignments: count });
  }
  const npcs: Coverage['npcs'] = {};
  for (const n of npcIds) npcs[n] = { roles: c.npcs[n]!.allowedRoles.length, events: npcEvents[n]!.size };
  return { events, roles, tags, npcs, totalAssignments: events.reduce((a, e) => a + e.assignments, 0) };
}

export function formatCoverage(cov: Coverage): string {
  const w1 = Math.max(12, ...cov.events.map((e) => e.id.length)) + 2;
  const slotText = (e: EventCoverage): string => (e.slots.length ? e.slots.map((s) => `${s.slot}:${s.candidates}`).join(' ') : '(no slots)');
  const w2 = Math.max(20, ...cov.events.map((e) => slotText(e).length)) + 2;
  const lines = ['EVENT COVERAGE', 'event'.padEnd(w1) + 'slots (candidates)'.padEnd(w2) + 'possible assignments'];
  for (const e of cov.events) lines.push(e.id.padEnd(w1) + slotText(e).padEnd(w2) + e.assignments);
  lines.push('', 'NPC INVOLVEMENT', 'npc'.padEnd(14) + 'roles'.padEnd(8) + 'events they can appear in');
  for (const [id, v] of Object.entries(cov.npcs)) lines.push(id.padEnd(14) + String(v.roles).padEnd(8) + v.events);
  const wt = Math.max(14, ...Object.keys(cov.tags).map((t) => t.length)) + 2;
  lines.push('', 'EVENTS PER TAG', ...Object.entries(cov.tags).sort().map(([t, ids]) => `${t.padEnd(wt)}${String(ids.length).padEnd(4)}(${ids.join(', ')})`));
  const wr = Math.max(14, ...Object.keys(cov.roles).map((r) => r.length)) + 2;
  lines.push('', 'EVENTS PER ROLE (a role that appears in a slot)', ...Object.entries(cov.roles).sort().map(([r, ids]) => `${r.padEnd(wr)}${ids.length}`));
  lines.push('', `Total card-level assignments across events: ${cov.totalAssignments}`);
  return lines.join('\n');
}
