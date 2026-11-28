// Usage (Anthropic): ANTHROPIC_API_KEY=... LLM_MODEL=<model id> node packages/director/scripts/llm-smoke.ts
// Usage (OpenAI):    LLM_PROVIDER=openai OPENAI_API_KEY=... LLM_MODEL=<model id> node packages/director/scripts/llm-smoke.ts
// ONE tiny real call (prompt P6, about 100 output tokens) to prove your key, model and the adapter work.
import { LlmClient, providerFromEnv } from '../src/index.ts';

const setup = providerFromEnv((name) => process.env[name]);
if ('error' in setup) {
  console.error(`${setup.error}. Set LLM_MODEL and the key for your provider (LLM_PROVIDER=openai needs OPENAI_API_KEY; the default, anthropic, needs ANTHROPIC_API_KEY).`);
  process.exit(2);
}
const { provider, model } = setup;
console.log(`provider=${provider.name} model=${model}`);
const client = new LlmClient({ provider, model, timeoutMs: 30000 });
const res = await client.complete('P6', {
  modifier_library: [{ id: 'low_fog', name: 'Low fog' }, { id: 'bright_cold', name: 'Bright cold' }, { id: 'warm_wind', name: 'Warm wind' }],
  last_seven_modifiers: [],
  date: '2026-01-01',
  seed_draw: { lens: 'mystery', weather_season: 'first_snow' },
});
for (const r of res.records) console.log(`call: ok=${r.ok} in=${r.tokensIn} out=${r.tokensOut} cached=${r.tokensCached} latency=${r.latencyMs}ms${r.error ? ' error=' + r.error : ''}`);
if (res.ok) {
  console.log('validated JSON:', JSON.stringify(res.json, null, 2));
  console.log('SMOKE TEST PASSED');
} else {
  console.error(`SMOKE TEST FAILED: ${res.reason}: ${res.detail}`);
  process.exit(1);
}
