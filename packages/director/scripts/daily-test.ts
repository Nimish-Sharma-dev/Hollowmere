// Usage: node packages/director/scripts/daily-test.ts
// T030: Tests the P6 Daily Modifier function and shared table anti-repeat behavior.
import {
  MODIFIER_LIBRARY,
  resolveDailyModifier,
  fallbackDailyModifier,
  applyDailyModifier,
} from '../src/daily.ts';
import { P6_SCHEMA } from '../src/schemas.ts';
import { validate } from '../src/schema.ts';
import { bareState } from '../test/fixtures.ts';
import type { Id } from '../../shared/src/index.ts';

console.log('--- Hollowmere P6 Daily Modifier Function Test (T030) ---');

// In-memory simulation of the Supabase daily_modifiers shared table
const sharedTable = new Map<string, any>();

const recentSeven: Id[] = [];
const state = bareState(42);

console.log('Simulating 14 consecutive days of shared daily world modifiers:');

for (let i = 1; i <= 14; i++) {
  const dayStr = `2026-11-${String(i).padStart(2, '0')}`;

  // 1. Check shared table
  let record = sharedTable.get(dayStr);
  if (!record) {
    const res = await resolveDailyModifier(dayStr, recentSeven, null, 100 + i);
    const errs = validate(P6_SCHEMA, res.output);
    if (errs.length > 0) {
      throw new Error(`Invalid P6 output schema on day ${dayStr}: ${errs.join(', ')}`);
    }

    if (recentSeven.includes(res.output.modifier_id)) {
      throw new Error(`Rule violated: modifier ${res.output.modifier_id} repeated within 7 days!`);
    }

    record = { day: dayStr, modifier: res.output };
    sharedTable.set(dayStr, record);
  }

  const mod = record.modifier;
  recentSeven.unshift(mod.modifier_id);
  if (recentSeven.length > 7) recentSeven.pop();

  // 2. Apply to game state
  applyDailyModifier(state, mod);

  console.log(`[${dayStr}] ${mod.modifier_id.padEnd(18)} | "${mod.town_crier_line.slice(0, 50)}..."`);
}

console.log(`\nShared table rows created: ${sharedTable.size}`);
console.log(`Current State Modifier: ${state.modifiers.id} (temp offset: ${state.modifiers.tempOffset})`);
console.log('Result: P6 DAILY MODIFIER FUNCTION TEST: PASSED');
