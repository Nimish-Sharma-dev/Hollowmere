import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startEncounter, stepCombat, finishEncounter, runEncounter, botPolicy, naivePolicy, stableStringify, count, CONFIG } from '../src/index.ts';
import type { CombatState, PlayerInput } from '../src/index.ts';
import { newGame } from './helpers.ts';

const BASE_ITEMS = [{ item: 'sword', qty: 1 }, { item: 'bow', qty: 1 }, { item: 'arrow', qty: 10 }];

function setup(enemies: string[], weapon: string | null = null, startItems = BASE_ITEMS) {
  const g = newGame({ startItems, equipped: { weapon } });
  const r = startEncounter(g.state, g.content, enemies);
  assert.ok(r.ok);
  if (!r.ok) throw new Error('unreachable');
  return { ...g, combat: r.combat };
}
const stepN = (c: CombatState, content: ReturnType<typeof setup>['content'], n: number, input: PlayerInput = {}): void => {
  for (let i = 0; i < n; i++) stepCombat(c, content, input);
};

test('startEncounter validates its inputs', () => {
  const g = newGame();
  assert.deepEqual(startEncounter(g.state, g.content, []), { ok: false, reason: 'no_enemies' });
  assert.deepEqual(startEncounter(g.state, g.content, ['dragon']), { ok: false, reason: 'unknown_enemy' });
  g.state.player.alive = false;
  assert.deepEqual(startEncounter(g.state, g.content, ['wolf']), { ok: false, reason: 'player_dead' });
});

test('combat is deterministic for the same state and the same inputs', () => {
  const run = (): string => {
    const { combat, content } = setup(['wolf', 'bandit'], 'sword');
    runEncounter(combat, content, botPolicy);
    return stableStringify(combat);
  };
  assert.equal(run(), run());
});

test('enemy state machine: idle -> chase -> windup -> recover -> chase', () => {
  const { combat, content } = setup(['wolf']);
  const wolf = combat.enemies[0]!;
  wolf.pos = { x: 1.0, y: 0 }; // inside attack range
  stepN(combat, content, 1);
  assert.equal(wolf.ai, 'chase'); // saw the player
  stepN(combat, content, 1);
  assert.equal(wolf.ai, 'windup');
  stepN(combat, content, 3);
  assert.equal(wolf.ai, 'windup'); // still winding up (timer 1)
  stepN(combat, content, 1);
  assert.equal(wolf.ai, 'recover');
  assert.equal(combat.player.hp, 100 - 9); // the hit landed
  stepN(combat, content, 14);
  assert.equal(wolf.ai, 'chase'); // recovered after attackCooldown steps
});

test('enemies out of sight stay idle; chasing enemies close the distance', () => {
  const { combat, content } = setup(['wolf']);
  const wolf = combat.enemies[0]!;
  wolf.pos = { x: 14, y: 0 };
  stepN(combat, content, 20);
  assert.equal(wolf.ai, 'idle');
  assert.equal(wolf.pos.x, 14);
  wolf.pos = { x: 6, y: 0 };
  stepN(combat, content, 10);
  assert.ok(wolf.pos.x < 6);
});

test('dodging grants invincibility frames that cancel a landing hit', () => {
  const { combat, content } = setup(['wolf']);
  const wolf = combat.enemies[0]!;
  wolf.pos = { x: 1.0, y: 0 };
  stepN(combat, content, 5); // wolf is one step from landing its hit
  assert.equal(wolf.ai, 'windup');
  // dash THROUGH the wolf's reach (toward it) so only i-frames can save the player
  stepCombat(combat, content, { dodge: true, move: { x: 1, y: 0 } });
  assert.equal(combat.player.iframes > 0, true);
  assert.equal(wolf.ai, 'recover');
  assert.equal(combat.player.hp, 100);
});

test('the same dash with no dodge is hit', () => {
  const { combat, content } = setup(['wolf']);
  combat.enemies[0]!.pos = { x: 1.0, y: 0 };
  stepN(combat, content, 6);
  assert.equal(combat.player.hp, 91);
});

test('dodge has a cooldown', () => {
  const { combat, content } = setup(['wolf']);
  combat.enemies[0]!.pos = { x: 14, y: 0 };
  stepCombat(combat, content, { dodge: true, move: { x: 0, y: 1 } });
  const y1 = combat.player.pos.y;
  stepCombat(combat, content, { dodge: true, move: { x: 0, y: 1 } });
  assert.ok(Math.abs(y1 - 2) < 1e-9, `first dodge dashes 2 tiles, y=${y1}`);
  assert.ok(Math.abs(combat.player.pos.y - y1) < 0.2, 'second dodge is refused (only a normal step)');
  stepN(combat, content, CONFIG.combat.dodgeCooldown);
  stepCombat(combat, content, { dodge: true, move: { x: 0, y: -1 } });
  assert.ok(combat.player.pos.y < y1);
});

test('a sword hit damages and knocks back the nearest enemy; whiffs are cheaper', () => {
  const { combat, content } = setup(['bear'], 'sword');
  const bear = combat.enemies[0]!;
  bear.pos = { x: 1.2, y: 0 };
  stepCombat(combat, content, { attack: true });
  assert.equal(bear.hp, 120 - 14);
  assert.ok(Math.abs(bear.pos.x - 1.8) < 1e-9, `knockback x=${bear.pos.x}`);
  assert.equal(combat.player.atkCd, 8);

  const far = setup(['bear'], 'sword');
  far.combat.enemies[0]!.pos = { x: 12, y: 0 };
  stepCombat(far.combat, far.content, { attack: true });
  assert.equal(far.combat.enemies[0]!.hp, 120);
  assert.equal(far.combat.player.atkCd, 4); // half cooldown for a whiff
});

test('attacks respect the cooldown', () => {
  const { combat, content } = setup(['bear'], 'sword');
  const bear = combat.enemies[0]!;
  for (let i = 0; i < 8; i++) {
    bear.pos = { x: 1.2, y: 0 }; // keep both in reach (knockback would push them apart)
    combat.player.pos = { x: 0, y: 0 };
    stepCombat(combat, content, { attack: true });
  }
  assert.equal(bear.hp, 120 - 14); // one hit in 8 steps
  bear.pos = { x: 1.2, y: 0 };
  combat.player.pos = { x: 0, y: 0 };
  stepCombat(combat, content, { attack: true });
  assert.equal(bear.hp, 120 - 28);
});

test('a solid hit staggers a winding-up enemy, but not twice in a row (no stun-lock)', () => {
  const { combat, content } = setup(['bandit'], 'sword');
  const wolf = combat.enemies[0]!;
  wolf.pos = { x: 1.0, y: 0 };
  stepN(combat, content, 3); // chase -> windup
  assert.equal(wolf.ai, 'windup');
  stepCombat(combat, content, { attack: true });
  assert.equal(wolf.ai, 'recover');
  assert.equal(wolf.aiTimer >= 5, true);
  assert.ok(wolf.staggerCd > 0);
  // force another windup inside the immunity window: it must not be interrupted
  wolf.ai = 'windup';
  wolf.aiTimer = 4;
  combat.player.atkCd = 0;
  wolf.pos = { x: 1.0, y: 0 };
  stepCombat(combat, content, { attack: true });
  assert.equal(wolf.ai, 'windup');
});

test('weak hits (unarmed vs a bear) never interrupt a wind-up', () => {
  const { combat, content } = setup(['bear']);
  const bear = combat.enemies[0]!;
  bear.pos = { x: 1.0, y: 0 };
  stepN(combat, content, 2);
  assert.equal(bear.ai, 'windup');
  stepCombat(combat, content, { attack: true });
  assert.equal(bear.ai, 'windup');
  assert.equal(bear.hp, 120 - 4);
});

test('wounded wolves flee, and a fled enemy counts as defeated without dropping loot', () => {
  const { combat, content } = setup(['wolf'], 'sword');
  const wolf = combat.enemies[0]!;
  wolf.hp = 8; // 22% <= 25%
  wolf.pos = { x: 4, y: 0 };
  stepCombat(combat, content, {});
  assert.equal(wolf.ai, 'flee');
  runEncounter(combat, content, () => ({}));
  assert.equal(wolf.ai, 'fled');
  assert.equal(combat.over, 'won');
  assert.deepEqual(combat.loot, []);
});

test('ranged weapons spend ammo, work at range, and stop when empty', () => {
  const { combat, content, state } = setup(['bear'], 'bow');
  const bear = combat.enemies[0]!;
  bear.pos = { x: 6, y: 0 };
  bear.ai = 'idle';
  assert.equal(combat.ammo, 10);
  stepCombat(combat, content, { attack: true });
  assert.equal(bear.hp, 120 - 9);
  assert.equal(combat.ammo, 9);
  combat.ammo = 0;
  combat.player.atkCd = 0;
  stepCombat(combat, content, { attack: true });
  assert.equal(bear.hp, 120 - 9); // no arrow, no shot
  assert.equal(combat.player.atkCd, 0);
  combat.ammo = 9;
  combat.over = 'won'; // end it so finishEncounter can run
  finishEncounter(state, content, combat);
  assert.equal(count(state.player.inventory, 'arrow'), 9); // one arrow was actually used
});

test('killing enemies collects their drops; finishing writes health, loot and ammo back', () => {
  const { combat, content, state } = setup(['bear'], 'sword');
  combat.enemies[0]!.pos = { x: 1.2, y: 0 };
  combat.enemies[0]!.hp = 10;
  stepCombat(combat, content, { attack: true });
  assert.equal(combat.enemies[0]!.ai, 'dead');
  assert.equal(combat.over, 'won');
  const hide = combat.loot.find((l) => l.item === 'hide')!;
  const meat = combat.loot.find((l) => l.item === 'raw_meat')!;
  assert.ok(hide.qty >= 2 && hide.qty <= 3 && meat.qty >= 2 && meat.qty <= 3);
  combat.player.hp = 77;
  const res = finishEncounter(state, content, combat);
  assert.ok(res.ok && res.outcome === 'won');
  assert.equal(state.player.stats.health, 77);
  assert.equal(count(state.player.inventory, 'hide'), hide.qty);
  assert.equal(state.player.alive, true);
});

test('losing a fight kills the player and loses the loot', () => {
  const { combat, content, state } = setup(['bear']);
  combat.player.hp = 1;
  combat.enemies[0]!.pos = { x: 1.0, y: 0 };
  runEncounter(combat, content, () => ({}));
  assert.equal(combat.over, 'lost');
  const res = finishEncounter(state, content, combat);
  assert.ok(res.ok && res.outcome === 'lost');
  assert.equal(state.player.alive, false);
  assert.equal(state.player.deathCause, 'combat');
  assert.equal(state.player.stats.health, 0);
});

test('finishEncounter refuses an unfinished fight; loot respects a full inventory', () => {
  const { combat, content, state } = setup(['wolf']);
  assert.deepEqual(finishEncounter(state, content, combat), { ok: false, reason: 'combat_not_over' });
  combat.over = 'won';
  combat.loot = [{ item: 'hide', qty: 3 }];
  state.player.inventory.slots = state.player.inventory.stacks.length; // no room
  const res = finishEncounter(state, content, combat);
  assert.ok(res.ok);
  if (res.ok) assert.deepEqual(res.lostLoot, [{ item: 'hide', qty: 3 }]);
});

/* ───────────── balance bounds (T007 acceptance check) ───────────── */

interface Summary { winRate: number; avgLossOnWin: number; maxSteps: number }
function fights(enemies: string[], weapon: string | null, policy: typeof botPolicy, n = 200): Summary {
  let wins = 0;
  let loss = 0;
  let maxSteps = 0;
  for (let i = 0; i < n; i++) {
    const g = newGame({ seed: 1000 + i, startItems: BASE_ITEMS, equipped: { weapon } });
    const r = startEncounter(g.state, g.content, enemies);
    if (!r.ok) throw new Error(r.reason);
    runEncounter(r.combat, g.content, policy);
    maxSteps = Math.max(maxSteps, r.combat.step);
    assert.ok(r.combat.player.hp >= 0 && r.combat.player.hp <= 100);
    if (r.combat.over === 'won') {
      wins++;
      loss += 100 - r.combat.player.hp;
    }
  }
  return { winRate: wins / n, avgLossOnWin: wins ? loss / wins : 0, maxSteps };
}

test('balance: every simulated fight terminates', () => {
  for (const group of [['wolf'], ['bandit'], ['cultist'], ['bear'], ['wolf', 'wolf'], ['bandit', 'cultist']]) {
    for (const w of [null, 'sword', 'bow']) {
      const s = fights(group, w, naivePolicy, 30);
      assert.ok(s.maxSteps < CONFIG.combat.maxSteps, `${group.join('+')} with ${w ?? 'fists'} did not end`);
    }
  }
});

test('balance: a sword beats single wolves, bandits and cultists at a modest cost', () => {
  for (const [enemy, maxLoss] of [['wolf', 30], ['bandit', 50], ['cultist', 50]] as const) {
    const s = fights([enemy], 'sword', naivePolicy);
    assert.ok(s.winRate >= 0.9, `${enemy}: win rate ${s.winRate}`);
    assert.ok(s.avgLossOnWin <= maxLoss, `${enemy}: avg hp lost ${s.avgLossOnWin} > ${maxLoss}`);
  }
});

test('balance: a bear is dangerous but beatable with a sword, and hopeless with fists', () => {
  const sword = fights(['bear'], 'sword', naivePolicy);
  assert.ok(sword.winRate >= 0.7, `sword vs bear win rate ${sword.winRate}`);
  assert.ok(sword.avgLossOnWin >= 30 && sword.avgLossOnWin <= 90, `sword vs bear loss ${sword.avgLossOnWin}`);
  const fists = fights(['bear'], null, naivePolicy);
  assert.ok(fists.winRate <= 0.1, `fists vs bear win rate ${fists.winRate}`);
});

test('balance: fists can handle one wolf but not a mixed group; groups cost more than singles', () => {
  assert.ok(fights(['wolf'], null, naivePolicy).winRate >= 0.9);
  assert.ok(fights(['bandit', 'cultist'], null, naivePolicy).winRate <= 0.25);
  const single = fights(['bandit'], 'sword', naivePolicy);
  const group = fights(['bandit', 'cultist'], 'sword', naivePolicy);
  assert.ok(group.avgLossOnWin > single.avgLossOnWin);
});

test('balance: dodging at the right moment reduces damage taken', () => {
  const naive = fights(['bandit', 'cultist'], 'sword', naivePolicy);
  const dodger = fights(['bandit', 'cultist'], 'sword', botPolicy);
  assert.ok(dodger.avgLossOnWin < naive.avgLossOnWin, `dodger ${dodger.avgLossOnWin} vs naive ${naive.avgLossOnWin}`);
});
