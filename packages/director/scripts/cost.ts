// Usage: node packages/director/scripts/cost.ts [--days 12] [--model name] [--pricing pricing.json] [--budget 50]
// T022: prints the estimated LLM cost of one simulated run, and how many runs a budget covers.
// pricing.json: { "default": {"inPerM":1,"outPerM":5,"cachedPerM":0.1}, "models": { "model-name": {...} } }
import { readFileSync } from 'node:fs';
import { loadContent } from '../../content/src/loader.ts';
import { join } from 'node:path';
import { LlmClient, MockProvider, PRICING_PLACEHOLDER, costUsd, fallbackDirector, makeLore, runDirectedGame, summarize } from '../src/index.ts';
import type { DirectorInput, Pricing } from '../src/index.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
}
const days = Number(arg('days', '12'));
const model = arg('model', 'unspecified-model');
const budget = Number(arg('budget', '50'));
const pricingFile = arg('pricing', '');
const usingPlaceholder = !pricingFile;
const pricing: Pricing = pricingFile ? (JSON.parse(readFileSync(pricingFile, 'utf8')) as Pricing) : PRICING_PLACEHOLDER;

const content = loadContent(join(import.meta.dirname, '..', '..', 'content', 'data'));
const lore = makeLore();

// 1. REAL P3 traffic: run a directed game against a mock model and count the actual Director calls and prompt sizes.
let current: DirectorInput | null = null;
const provider = new MockProvider(() => JSON.stringify(fallbackDirector(current!)));
const client = new LlmClient({ provider, model, pricing });
const run = await runDirectedGame(content, lore, { seed: 11, days, client, beforeDecide: (i) => void (current = i) });
const p3 = summarize(run.records);

// 2. ESTIMATED traffic for the other prompts (token counts are assumptions: edit them to match your real prompts)
const LIBRARY_DIGEST_TOKENS = 1500; // the real P3/P2 prompts carry a library digest the mock run does not
const assumptions: { id: string; calls: number; inTok: number; cachedTok: number; outTok: number }[] = [
  { id: 'P1 onboarding', calls: 1, inTok: 700, cachedTok: 0, outTok: 350 },
  { id: 'P2 run bible', calls: 1, inTok: 2600 + LIBRARY_DIGEST_TOKENS, cachedTok: 600, outTok: 2400 },
  { id: 'P4 dialogue', calls: days * 6, inTok: 500, cachedTok: 600, outTok: 120 },
  { id: 'P5 memory/rumor', calls: Math.round(days * 1.5), inTok: 450, cachedTok: 600, outTok: 250 },
  { id: 'P6 world of day (shared, 1/day)', calls: days, inTok: 300, cachedTok: 0, outTok: 80 },
  { id: 'P7a ghost legend', calls: 1, inTok: 400, cachedTok: 0, outTok: 120 },
  { id: 'P7b chronicle', calls: 1, inTok: 1200, cachedTok: 600, outTok: 900 },
];
const lines: string[] = [];
let total = p3.costUsd;
lines.push(`P3 director (measured)`.padEnd(34) + `${String(p3.calls).padStart(4)} calls  ${String(p3.tokensIn).padStart(7)} in  ${String(p3.tokensOut).padStart(6)} out   $${p3.costUsd.toFixed(4)}`);
for (const a of assumptions) {
  const c = a.calls * costUsd({ inputTokens: a.inTok, cachedTokens: a.cachedTok, outputTokens: a.outTok }, model, pricing);
  total += c;
  lines.push(a.id.padEnd(34) + `${String(a.calls).padStart(4)} calls  ${String(a.calls * (a.inTok + a.cachedTok)).padStart(7)} in  ${String(a.calls * a.outTok).padStart(6)} out   $${c.toFixed(4)}`);
}
console.log(`Simulated run: ${days} days, ${run.decisions.length} Director decisions, ${run.decisions.filter((d) => d.source === 'pregenerated').length} served from pre-generation`);
console.log(`Model: ${model}   Prices: ${usingPlaceholder ? 'PLACEHOLDER (not real; pass --pricing yourfile.json)' : pricingFile}`);
console.log('');
for (const l of lines) console.log(l);
console.log('');
console.log(`cost per run:        $${total.toFixed(4)}`);
console.log(`cost per game day:   $${(total / days).toFixed(4)}`);
console.log(`runs per $${budget}:       ${total > 0 ? Math.floor(budget / total) : 'unbounded'}`);
console.log('');
console.log('Measured: P3 calls and prompt sizes from a real simulated game. Estimated: every other prompt (see assumptions in this script).');
console.log('Caching and the fallback (caps, kill switch) cut real cost further; failed calls still cost money.');
