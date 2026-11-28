export interface Usage {
  /** input tokens that were not served from the provider's prompt cache */
  inputTokens: number;
  outputTokens: number;
  /** input tokens served from the provider's prompt cache */
  cachedTokens: number;
}
export interface Price {
  /** USD per million tokens */
  inPerM: number;
  outPerM: number;
  cachedPerM: number;
}
export interface Pricing {
  default: Price;
  models: Record<string, Price>;
}

/**
 * PLACEHOLDER PRICES. Replace with the real numbers from your provider's pricing page
 * before trusting any dollar figure (set per-model entries, or pass your own Pricing).
 */
export const PRICING_PLACEHOLDER: Pricing = { default: { inPerM: 1, outPerM: 5, cachedPerM: 0.1 }, models: {} };

/**
 * Real prices for the proxy, from environment variables (USD per million tokens):
 * LLM_PRICE_IN_PER_M, LLM_PRICE_OUT_PER_M, and optionally LLM_PRICE_CACHED_PER_M (defaults to the input price,
 * so a missing cached price never under-counts spend). Returns null when the two required prices are missing or invalid,
 * so the caller can warn and fall back to PRICING_PLACEHOLDER. The daily budget cap is computed from these prices.
 */
export function pricingFromEnv(get: (name: string) => string | undefined): Pricing | null {
  const num = (name: string): number | null => {
    const raw = get(name)?.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const inPerM = num('LLM_PRICE_IN_PER_M');
  const outPerM = num('LLM_PRICE_OUT_PER_M');
  if (inPerM === null || outPerM === null) return null;
  return { default: { inPerM, outPerM, cachedPerM: num('LLM_PRICE_CACHED_PER_M') ?? inPerM }, models: {} };
}

export function priceFor(model: string, pricing: Pricing = PRICING_PLACEHOLDER): Price {
  return pricing.models[model] ?? pricing.default;
}

export function costUsd(usage: Usage, model: string, pricing: Pricing = PRICING_PLACEHOLDER): number {
  const p = priceFor(model, pricing);
  return (usage.inputTokens * p.inPerM + usage.outputTokens * p.outPerM + usage.cachedTokens * p.cachedPerM) / 1_000_000;
}

/** crude token estimate (about 4 characters per token) used when a provider reports no usage */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** One row of the llm_calls log (BUILD_PLAN section 9). */
export interface CallRecord {
  promptId: string;
  promptVersion: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  fallbackUsed: boolean;
  error: string | null;
}

export interface CostSummary {
  calls: number;
  failed: number;
  fallbacks: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  avgLatencyMs: number;
  byPrompt: Record<string, { calls: number; costUsd: number }>;
}

export function summarize(records: CallRecord[]): CostSummary {
  const s: CostSummary = { calls: records.length, failed: 0, fallbacks: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, avgLatencyMs: 0, byPrompt: {} };
  let lat = 0;
  for (const r of records) {
    if (!r.ok) s.failed++;
    if (r.fallbackUsed) s.fallbacks++;
    s.tokensIn += r.tokensIn;
    s.tokensOut += r.tokensOut;
    s.tokensCached += r.tokensCached;
    s.costUsd += r.costUsd;
    lat += r.latencyMs;
    const b = (s.byPrompt[r.promptId] ??= { calls: 0, costUsd: 0 });
    b.calls++;
    b.costUsd += r.costUsd;
  }
  s.avgLatencyMs = records.length ? lat / records.length : 0;
  s.costUsd = Math.round(s.costUsd * 1e6) / 1e6;
  return s;
}
