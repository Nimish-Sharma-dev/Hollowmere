import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, clockString, dayOf, phaseAt, phaseOfTick, seasonOfDay, startTickOfDay, tickOfDay, weatherForDay } from '../src/index.ts';

test('day and tick-of-day arithmetic', () => {
  assert.equal(dayOf(0), 1);
  assert.equal(dayOf(239), 1);
  assert.equal(dayOf(240), 2);
  assert.equal(tickOfDay(245), 5);
  assert.equal(startTickOfDay(3), 480);
  assert.equal(CONFIG.ticksPerDay * CONFIG.tickSeconds, 600); // a day is 10 real minutes
});

test('phase boundaries', () => {
  assert.equal(phaseAt(0), 'morning');
  assert.equal(phaseAt(59), 'morning');
  assert.equal(phaseAt(60), 'day');
  assert.equal(phaseAt(143), 'day');
  assert.equal(phaseAt(144), 'evening');
  assert.equal(phaseAt(191), 'evening');
  assert.equal(phaseAt(192), 'night');
  assert.equal(phaseAt(239), 'night');
  assert.equal(phaseOfTick(240), 'morning');
});

test('seasons advance every daysPerSeason and wrap around', () => {
  assert.equal(seasonOfDay(1, 'spring'), 'spring');
  assert.equal(seasonOfDay(8, 'spring'), 'spring');
  assert.equal(seasonOfDay(9, 'spring'), 'summer');
  assert.equal(seasonOfDay(25, 'spring'), 'winter');
  assert.equal(seasonOfDay(33, 'spring'), 'spring');
  assert.equal(seasonOfDay(9, 'winter'), 'spring');
  assert.equal(seasonOfDay(1, 'autumn'), 'autumn');
  assert.equal(seasonOfDay(9, 'autumn'), 'winter');
});

test('clock string starts at 06:00', () => {
  assert.equal(clockString(0), 'Day 1, 06:00');
  assert.equal(clockString(120), 'Day 1, 18:00');
  assert.equal(clockString(240), 'Day 2, 06:00');
});

test('weather is a pure function of (seed, day, season)', () => {
  for (let d = 1; d <= 50; d++) assert.equal(weatherForDay(9, d, 'winter'), weatherForDay(9, d, 'winter'));
  const a = Array.from({ length: 60 }, (_, i) => weatherForDay(1, i + 1, 'autumn'));
  const b = Array.from({ length: 60 }, (_, i) => weatherForDay(2, i + 1, 'autumn'));
  assert.notDeepEqual(a, b);
});

test('seasonal weather rules hold over many days', () => {
  const tally = (season: 'spring' | 'summer' | 'autumn' | 'winter') => {
    const t: Record<string, number> = {};
    for (let d = 1; d <= 1000; d++) {
      const w = weatherForDay(77, d, season);
      t[w] = (t[w] ?? 0) + 1;
    }
    return t;
  };
  const winter = tally('winter');
  const summer = tally('summer');
  assert.equal(winter['rain'] ?? 0, 0);
  assert.ok((winter['snow'] ?? 0) > 350, 'winter should be snowy');
  assert.ok((winter['blizzard'] ?? 0) > 80, 'winter should have blizzards');
  assert.equal(summer['snow'] ?? 0, 0);
  assert.equal(summer['blizzard'] ?? 0, 0);
  for (const s of ['spring', 'summer', 'autumn'] as const) assert.equal(tally(s)['blizzard'] ?? 0, 0);
});
