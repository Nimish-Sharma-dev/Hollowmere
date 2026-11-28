import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, ambientTemp, perform, checkInvariants } from '../src/index.ts';
import { newGame } from './helpers.ts';

const close = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('hunger decays at the configured rate, scaled by activity and world modifiers', () => {
  const { state, content } = newGame({ startSeason: 'summer' });
  advance(state, content, 100, 'normal');
  close(state.player.stats.hunger, 80 - 100 * 0.12);

  const w = newGame({ startSeason: 'summer' });
  advance(w.state, w.content, 100, 'work');
  close(w.state.player.stats.hunger, 80 - 100 * 0.12 * 1.4);

  const m = newGame({ startSeason: 'summer' });
  m.state.modifiers.hungerMult = 2;
  advance(m.state, m.content, 100, 'normal');
  close(m.state.player.stats.hunger, 80 - 100 * 0.12 * 2);
});

test('resting restores energy, and a shelter restores it faster', () => {
  const a = newGame({ startSeason: 'summer' });
  a.state.player.stats.energy = 20;
  advance(a.state, a.content, 10, 'rest');
  close(a.state.player.stats.energy, 20 + 10 * 0.6);

  const b = newGame({ startSeason: 'summer' });
  b.state.player.stats.energy = 20;
  b.state.player.nearby = ['shelter'];
  advance(b.state, b.content, 10, 'rest');
  close(b.state.player.stats.energy, 20 + 10 * 0.9);
});

test('temperature combines season, weather, time of day and modifiers', () => {
  const { state } = newGame({ startSeason: 'winter' });
  state.weather = 'blizzard';
  state.tick = 200; // night
  assert.equal(ambientTemp(state), -8 - 10 - 6);
  state.modifiers.tempOffset = 4;
  assert.equal(ambientTemp(state), -8 - 10 - 6 + 4);
});

test('fire and shelter keep a player warm on a cold autumn night', () => {
  const { state, content } = newGame({ startSeason: 'autumn' });
  state.weather = 'clear';
  state.tick = 192; // night
  state.player.nearby = ['fire', 'shelter'];
  state.player.stats.warmth = 50;
  advance(state, content, 40, 'rest');
  assert.ok(state.player.stats.warmth > 50, `warmth ${state.player.stats.warmth}`);
});

test('in a winter blizzard night, fire + shelter + a fur cloak loses far less heat than going bare', () => {
  const lossAfter = (nearby: string[], cloak: boolean): number => {
    const { state, content } = newGame({ startSeason: 'winter', startItems: [{ item: 'fur_cloak', qty: 1 }], equipped: { clothing: cloak ? 'fur_cloak' : null } });
    state.weather = 'blizzard';
    state.tick = 192;
    state.player.nearby = nearby;
    state.player.stats.warmth = 80;
    advance(state, content, 40, 'rest');
    return 80 - state.player.stats.warmth;
  };
  const bare = lossAfter([], false);
  const sheltered = lossAfter(['fire', 'shelter'], false);
  const full = lossAfter(['fire', 'shelter'], true);
  assert.ok(sheltered < bare * 0.5, `sheltered ${sheltered} vs bare ${bare}`);
  assert.ok(full < sheltered, `full ${full} vs sheltered ${sheltered}`);
  assert.ok(full < 10, `a fully equipped player should lose under 10 warmth in 40 ticks, lost ${full}`);
});

test('an unprotected player in a winter blizzard freezes to death within two days', () => {
  const { state, content } = newGame({ startSeason: 'winter' });
  state.weather = 'blizzard';
  for (let i = 0; i < 480 && state.player.alive; i++) {
    advance(state, content, 1, 'normal');
    state.weather = 'blizzard'; // hold the worst case
  }
  assert.equal(state.player.alive, false);
  assert.equal(state.player.deathCause, 'exposure');
  assert.equal(state.player.stats.health, 0);
});

test('warm clothing slows heat loss', () => {
  const bare = newGame({ startSeason: 'winter' });
  const dressed = newGame({ startSeason: 'winter', startItems: [{ item: 'fur_cloak', qty: 1 }], equipped: { clothing: 'fur_cloak' } });
  for (const g of [bare, dressed]) {
    g.state.weather = 'snow';
    advance(g.state, g.content, 30, 'normal');
  }
  assert.ok(dressed.state.player.stats.warmth > bare.state.player.stats.warmth + 10);
});

test('starvation kills a player who is otherwise comfortable', () => {
  const { state, content } = newGame({ startSeason: 'summer' });
  state.player.nearby = ['fire', 'shelter'];
  for (let i = 0; i < 3000 && state.player.alive; i++) advance(state, content, 1, 'rest');
  assert.equal(state.player.alive, false);
  assert.equal(state.player.deathCause, 'starvation');
});

test('zero energy drains health; good conditions regenerate it', () => {
  const a = newGame({ startSeason: 'summer' });
  a.state.player.stats.energy = 0;
  a.state.player.stats.hunger = 100;
  a.state.player.stats.warmth = 100;
  a.state.player.nearby = ['shelter'];
  advance(a.state, a.content, 10, 'normal');
  close(a.state.player.stats.health, 100 - 10 * 0.1);

  const b = newGame({ startSeason: 'summer' });
  b.state.player.stats.health = 50;
  b.state.player.nearby = ['fire', 'shelter'];
  advance(b.state, b.content, 20, 'normal');
  close(b.state.player.stats.health, 50 + 20 * 0.15);
});

test('after death survival stops changing, but the world clock keeps running', () => {
  const { state, content } = newGame();
  state.player.stats.health = 0.01;
  state.player.stats.hunger = 0;
  advance(state, content, 5, 'normal');
  assert.equal(state.player.alive, false);
  const frozen = JSON.stringify(state.player.stats);
  const tick = state.tick;
  advance(state, content, 50, 'normal');
  assert.equal(JSON.stringify(state.player.stats), frozen);
  assert.equal(state.tick, tick + 50);
  assert.deepEqual(checkInvariants(state, content), []);
  const r = perform(state, content, { type: 'wait', ticks: 1 });
  assert.deepEqual(r, { ok: false, reason: 'player_dead' });
});

test('stats always stay inside 0..100', () => {
  const { state, content } = newGame({ startSeason: 'winter' });
  for (let i = 0; i < 2000; i++) {
    advance(state, content, 1, i % 3 === 0 ? 'rest' : 'work');
    for (const v of Object.values(state.player.stats)) assert.ok(v >= 0 && v <= 100);
  }
});
