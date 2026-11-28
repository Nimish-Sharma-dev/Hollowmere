import type { ContentBundle } from '../../shared/src/index.ts';
import type { Lore } from './lore.ts';
import { twistFeasible } from './bible.ts';

/** Lint rules from the plan (section 6) that need the story library. Returns problems; empty means healthy. */
export function lintLore(lore: Lore, content: ContentBundle): string[] {
  const e: string[] = [];
  const roles = new Set(Object.values(content.npcs).flatMap((n) => n.allowedRoles));
  for (const c of Object.values(lore.crises)) {
    if (c.antagonistRoles.length === 0 || c.tones.length < 3 || c.endings.length < 3 || c.twists.length < 1) e.push(`crisis ${c.id}: needs antagonist roles, 3+ tones, 3+ endings and a twist`);
    for (const t of c.tones) if (!lore.tones.includes(t)) e.push(`crisis ${c.id}: unknown tone ${t}`);
    for (const x of c.endings) if (!lore.endings.includes(x)) e.push(`crisis ${c.id}: unknown ending ${x}`);
    for (const x of c.twists) if (!lore.twists[x]) e.push(`crisis ${c.id}: unknown twist ${x}`);
    for (const r of c.antagonistRoles) {
      if (!roles.has(r)) e.push(`crisis ${c.id}: no NPC can take antagonist role ${r}`);
      if (!Object.values(lore.secrets).some((s) => s.holderRoles.includes(r) && s.crisisIds.includes(c.id))) e.push(`crisis ${c.id}: no secret fits antagonist role ${r}`);
    }
    const events = Object.values(content.events).filter((ev) => ev.tags.includes(c.eventTag));
    if (events.length < 6) e.push(`crisis ${c.id}: only ${events.length} event(s) tagged ${c.eventTag}; needs at least 6`);
  }
  for (const t of Object.values(lore.twists)) {
    if (t.requires.roles.length === 0) e.push(`twist ${t.id}: needs at least one required role`);
    for (const r of t.requires.roles) if (!roles.has(r)) e.push(`twist ${t.id}: no NPC can take required role ${r}`);
  }
  // every twist a crisis offers must be able to land for at least one villain, or the builder can never use it
  for (const c of Object.values(lore.crises)) {
    for (const id of c.twists) {
      const tw = lore.twists[id];
      if (!tw) continue;
      const usable = c.antagonistRoles.some((r) => Object.keys(content.npcs).some((n) => content.npcs[n]!.allowedRoles.includes(r) && twistFeasible(tw, c, n, r, content)));
      if (!usable) e.push(`crisis ${c.id}: twist ${id} can never land (no villain and cast can carry it)`);
    }
  }
  // roles that name a crisis must name a real one, and every NPC keeps at least one role that fits any run
  for (const [r, cs] of Object.entries(lore.roleCrises)) {
    if (!roles.has(r)) e.push(`roleCrises: no NPC can take role ${r}`);
    for (const c of cs) if (!lore.crises[c]) e.push(`roleCrises: role ${r} names unknown crisis ${c}`);
  }
  for (const n of Object.values(content.npcs)) if (n.allowedRoles.every((r) => lore.roleCrises[r])) e.push(`npc ${n.id}: every allowed role is tied to a specific crisis; give them one that fits any run`);
  for (const s of Object.values(lore.secrets)) {
    if (s.clueIds.length < 2) e.push(`secret ${s.id}: needs at least 2 clues`);
    const options = s.clueIds.map((id) => lore.clues[id]?.locationIds ?? []);
    const union = new Set(options.flat());
    if (union.size < 2) e.push(`secret ${s.id}: clues cannot be placed in 2 different places`);
    for (const id of s.clueIds) if (!lore.clues[id]) e.push(`secret ${s.id}: unknown clue ${id}`);
    for (const r of s.holderRoles) if (!roles.has(r)) e.push(`secret ${s.id}: no NPC can take holder role ${r}`);
    for (const c of s.crisisIds) if (!lore.crises[c]) e.push(`secret ${s.id}: unknown crisis ${c}`);
  }
  for (const c of Object.values(lore.clues)) {
    if (c.locationIds.length < 2) e.push(`clue ${c.id}: needs at least 2 possible locations`);
    for (const l of c.locationIds) if (!content.locations.includes(l)) e.push(`clue ${c.id}: unknown location ${l}`);
  }
  for (const sp of Object.values(lore.spawns)) if (!content.locations.includes(sp.locationId)) e.push(`spawn ${sp.id}: unknown location ${sp.locationId}`);
  for (const k of Object.values(lore.kits)) for (const i of k.items) if (!content.items[i.item]) e.push(`kit ${k.id}: unknown item ${i.item}`);
  for (const r of roles) if (!lore.roleMotives[r]) e.push(`role ${r}: no hidden motive text`);
  if (lore.seasons.length < 3) e.push('needs at least 3 weather/season entries');
  return e;
}
