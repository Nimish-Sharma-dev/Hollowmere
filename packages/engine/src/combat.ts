import type { ContentBundle, EnemyDef, Id, ItemDef } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import { addItem, count, removeItem } from './inventory.ts';
import type { Stack } from './inventory.ts';
import { Rng } from './rng.ts';
import { clamp } from './stats.ts';
import { fail, withRng } from './state.ts';
import type { GameState, Result } from './state.ts';

export interface Vec {
  x: number;
  y: number;
}

export type EnemyAi = 'idle' | 'chase' | 'windup' | 'recover' | 'flee' | 'fled' | 'dead';

export interface Fighter {
  id: string;
  def: Id | null;
  pos: Vec;
  hp: number;
  maxHp: number;
  facing: Vec;
  /** player only */
  atkCd: number;
  iframes: number;
  dodgeCd: number;
  /** enemy only */
  ai: EnemyAi | null;
  aiTimer: number;
  /** steps until this enemy can be staggered again (prevents stun-lock) */
  staggerCd: number;
}

export interface WeaponStats {
  damage: number;
  range: number;
  cooldown: number;
  knockback: number;
  ranged: boolean;
  ammo: Id | null;
}

export interface CombatState {
  step: number;
  rng: number;
  player: Fighter;
  enemies: Fighter[];
  weapon: WeaponStats;
  /** arrows available at start / now (ranged weapons) */
  ammoStart: number;
  ammo: number;
  loot: Stack[];
  over: 'ongoing' | 'won' | 'lost';
}

export interface PlayerInput {
  /** movement direction; need not be normalized */
  move?: Vec;
  attack?: boolean;
  dodge?: boolean;
}

const len = (v: Vec): number => Math.sqrt(v.x * v.x + v.y * v.y);
const dist = (a: Vec, b: Vec): number => len({ x: a.x - b.x, y: a.y - b.y });
function unit(v: Vec): Vec {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}
function inBounds(p: Vec): Vec {
  const { w, h } = CONFIG.combat.arena;
  return { x: clamp(p.x, -w / 2, w / 2), y: clamp(p.y, -h / 2, h / 2) };
}

export function weaponStats(item: ItemDef | undefined): WeaponStats {
  const w = item?.weapon;
  if (!w) return { ...CONFIG.combat.unarmed, ranged: false, ammo: null };
  return { damage: w.damage, range: w.range, cooldown: w.cooldown, knockback: w.knockback, ranged: !!w.ranged, ammo: w.ranged?.ammo ?? null };
}

/** Build an encounter from the player's current state. Positions use the main RNG stream. */
export function startEncounter(state: GameState, content: ContentBundle, enemyIds: Id[]): Result<{ combat: CombatState }> {
  if (!state.player.alive) return fail('player_dead');
  if (enemyIds.length === 0) return fail('no_enemies');
  const defs: EnemyDef[] = [];
  for (const id of enemyIds) {
    const d = content.enemies[id];
    if (!d) return fail('unknown_enemy');
    defs.push(d);
  }
  const weaponItem = state.player.equipped.weapon ? content.items[state.player.equipped.weapon] : undefined;
  const weapon = weaponStats(weaponItem);
  const ammo = weapon.ammo ? count(state.player.inventory, weapon.ammo) : 0;
  const { seed, enemies } = withRng(state, (rng) => {
    const list: Fighter[] = defs.map((d, i) => ({
      id: `${d.id}_${i + 1}`,
      def: d.id,
      pos: { x: 6 + rng.int(0, 3), y: (i - (defs.length - 1) / 2) * 2 },
      hp: d.hp,
      maxHp: d.hp,
      facing: { x: -1, y: 0 },
      atkCd: 0,
      iframes: 0,
      dodgeCd: 0,
      ai: 'idle' as EnemyAi,
      aiTimer: 0,
      staggerCd: 0,
    }));
    return { seed: rng.int(0, 0x7fffffff), enemies: list };
  });
  const hp = Math.max(1, Math.round(state.player.stats.health));
  const combat: CombatState = {
    step: 0,
    rng: seed,
    player: { id: 'player', def: null, pos: { x: 0, y: 0 }, hp, maxHp: CONFIG.combat.playerMaxHp, facing: { x: 1, y: 0 }, atkCd: 0, iframes: 0, dodgeCd: 0, ai: null, aiTimer: 0, staggerCd: 0 },
    enemies,
    weapon,
    ammoStart: ammo,
    ammo,
    loot: [],
    over: 'ongoing',
  };
  return { ok: true, combat };
}

function killEnemy(c: CombatState, content: ContentBundle, e: Fighter, rng: Rng): void {
  e.ai = 'dead';
  e.hp = 0;
  const def = e.def ? content.enemies[e.def] : undefined;
  for (const d of def?.drops ?? []) {
    if (!rng.chance(d.chance)) continue;
    const qty = rng.int(d.min, d.max);
    if (qty <= 0) continue;
    const ex = c.loot.find((l) => l.item === d.item);
    if (ex) ex.qty += qty;
    else c.loot.push({ item: d.item, qty });
  }
}

function nearestAlive(c: CombatState, from: Vec, maxDist: number): Fighter | null {
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const e of c.enemies) {
    if (e.ai === 'dead' || e.ai === 'fled') continue;
    const d = dist(from, e.pos);
    if (d <= maxDist && d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** One fixed-timestep combat update (20 per second). Deterministic given the input sequence. */
export function stepCombat(c: CombatState, content: ContentBundle, input: PlayerInput = {}): void {
  if (c.over !== 'ongoing') return;
  const K = CONFIG.combat;
  const rng = new Rng(c.rng);
  c.step += 1;
  const p = c.player;
  if (p.atkCd > 0) p.atkCd -= 1;
  if (p.iframes > 0) p.iframes -= 1;
  if (p.dodgeCd > 0) p.dodgeCd -= 1;

  // ── player: dodge or move ──
  const mv = unit(input.move ?? { x: 0, y: 0 });
  if (input.dodge && p.dodgeCd === 0) {
    const dir = mv.x !== 0 || mv.y !== 0 ? mv : { x: -p.facing.x, y: -p.facing.y };
    p.pos = inBounds({ x: p.pos.x + dir.x * K.dodgeDistance, y: p.pos.y + dir.y * K.dodgeDistance });
    p.iframes = K.dodgeIframes;
    p.dodgeCd = K.dodgeCooldown;
  } else if (mv.x !== 0 || mv.y !== 0) {
    p.pos = inBounds({ x: p.pos.x + mv.x * K.playerSpeed, y: p.pos.y + mv.y * K.playerSpeed });
    p.facing = mv;
  }

  // ── player: attack (auto-aims at the nearest enemy in range) ──
  if (input.attack && p.atkCd === 0) {
    const w = c.weapon;
    const canFire = !w.ranged || c.ammo > 0;
    if (canFire) {
      const target = nearestAlive(c, p.pos, w.range);
      p.atkCd = target ? w.cooldown : Math.ceil(w.cooldown / 2);
      if (target) {
        if (w.ranged) c.ammo -= 1;
        p.facing = unit({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
        target.hp -= w.damage;
        if (target.hp <= 0) {
          killEnemy(c, content, target, rng);
        } else {
          const kb = unit({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
          target.pos = inBounds({ x: target.pos.x + kb.x * w.knockback, y: target.pos.y + kb.y * w.knockback });
          // only a solid hit interrupts a wind-up, and not again for a while (no stun-lock)
          if (target.ai === 'windup' && target.staggerCd === 0 && w.damage >= K.staggerMinHpFraction * target.maxHp) {
            target.ai = 'recover';
            target.aiTimer = K.staggerSteps;
            target.staggerCd = K.staggerImmunity;
          }
        }
      }
    }
  }

  // ── enemies (stable order) ──
  for (const e of c.enemies) {
    if (e.ai === 'dead' || e.ai === 'fled') continue;
    const def = content.enemies[e.def ?? ''];
    if (!def) continue;
    if (e.staggerCd > 0) e.staggerCd -= 1;
    const toPlayer = { x: p.pos.x - e.pos.x, y: p.pos.y - e.pos.y };
    const d = len(toPlayer);
    const dir = unit(toPlayer);
    if (def.fleeBelow !== undefined && e.ai !== 'flee' && e.hp / e.maxHp <= def.fleeBelow) e.ai = 'flee';

    switch (e.ai) {
      case 'idle':
        if (d <= def.sight) e.ai = 'chase';
        break;
      case 'chase':
        if (d > def.sight * 1.6) {
          e.ai = 'idle';
        } else if (d <= def.attackRange) {
          e.ai = 'windup';
          e.aiTimer = K.windupSteps;
        } else {
          const stepLen = Math.max(0, Math.min(def.speed, d - def.attackRange * 0.8));
          e.pos = inBounds({ x: e.pos.x + dir.x * stepLen, y: e.pos.y + dir.y * stepLen });
          e.facing = dir;
        }
        break;
      case 'windup':
        e.aiTimer -= 1;
        if (e.aiTimer <= 0) {
          if (d <= def.attackRange + K.hitSlack && p.iframes === 0) {
            p.hp -= def.damage;
            p.pos = inBounds({ x: p.pos.x + dir.x * K.enemyKnockback, y: p.pos.y + dir.y * K.enemyKnockback });
          }
          e.ai = 'recover';
          e.aiTimer = def.attackCooldown;
        }
        break;
      case 'recover':
        e.aiTimer -= 1;
        if (e.aiTimer <= 0) e.ai = 'chase';
        break;
      case 'flee':
        if (d > def.sight * 1.2) {
          e.ai = 'fled';
        } else {
          e.pos = inBounds({ x: e.pos.x - dir.x * def.speed, y: e.pos.y - dir.y * def.speed });
        }
        break;
      default:
        break;
    }
  }

  c.rng = rng.s;
  if (p.hp <= 0) {
    p.hp = 0;
    c.over = 'lost';
  } else if (c.enemies.every((e) => e.ai === 'dead' || e.ai === 'fled')) {
    c.over = 'won';
  }
}

/** Write the encounter outcome back into the game state: health, ammo used, loot, death. */
export function finishEncounter(state: GameState, content: ContentBundle, c: CombatState): Result<{ outcome: 'won' | 'lost'; loot: Stack[]; lostLoot: Stack[] }> {
  if (c.over === 'ongoing') return fail('combat_not_over');
  const p = state.player;
  p.stats.health = clamp(c.player.hp, 0, 100);
  if (c.weapon.ammo && c.ammoStart > c.ammo) removeItem(p.inventory, c.weapon.ammo, c.ammoStart - c.ammo);
  const lostLoot: Stack[] = [];
  if (c.over === 'lost') {
    p.alive = false;
    p.deathCause = 'combat';
    return { ok: true, outcome: 'lost', loot: [], lostLoot: c.loot.map((l) => ({ ...l })) };
  }
  const loot: Stack[] = [];
  for (const l of c.loot) {
    const def = content.items[l.item];
    if (!def) continue;
    const added = addItem(p.inventory, def, l.qty);
    if (added > 0) loot.push({ item: l.item, qty: added });
    if (added < l.qty) lostLoot.push({ item: l.item, qty: l.qty - added });
  }
  return { ok: true, outcome: 'won', loot, lostLoot };
}

/** Run an encounter to its end with a scripted policy (used by tests and the balance harness). */
export function runEncounter(c: CombatState, content: ContentBundle, policy: (c: CombatState, content: ContentBundle) => PlayerInput): number {
  while (c.over === 'ongoing' && c.step < CONFIG.combat.maxSteps) stepCombat(c, content, policy(c, content));
  return c.step;
}

/** Baseline bot: closes in and attacks, never dodges. Measures the raw damage race. */
export function naivePolicy(c: CombatState, content: ContentBundle): PlayerInput {
  const { dodge: _ignored, ...rest } = botPolicy(c, content);
  return rest;
}

/** Reference bot: closes in, attacks when ready, dodges a landing blow if it can. */
export function botPolicy(c: CombatState, content: ContentBundle): PlayerInput {
  const p = c.player;
  let target: Fighter | null = null;
  let best = Infinity;
  for (const e of c.enemies) {
    if (e.ai === 'dead' || e.ai === 'fled') continue;
    const d = dist(p.pos, e.pos);
    if (d < best) {
      best = d;
      target = e;
    }
  }
  if (!target) return {};
  const def = content.enemies[target.def ?? ''];
  const toT = unit({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
  if (def && target.ai === 'windup' && target.aiTimer <= 2 && best <= def.attackRange + CONFIG.combat.hitSlack && p.dodgeCd === 0) {
    return { dodge: true, move: { x: -toT.x, y: -toT.y } };
  }
  if (best > c.weapon.range * 0.9) return { move: toT };
  return { attack: true };
}
