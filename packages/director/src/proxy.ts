/**
 * LLM proxy logic (T018). Pure and dependency-injected so it can be tested offline.
 * The Supabase Edge Function in supabase/functions/llm-proxy/index.ts is a thin wrapper around this.
 * IMPORTANT: this file must not import anything outside packages/director/src (it is copied into the edge bundle).
 */
import type { LlmClient } from './client.ts';
import type { CallRecord } from './cost.ts';
import { REGISTRY, isPromptId } from './prompts.ts';
import type { PromptId } from './prompts.ts';

export interface ProxyConfig {
  /** global daily spend cap in USD; at or above it everything falls back */
  dailyBudgetUsd: number;
  perPlayerDayCalls: number;
  perRunCalls: number;
  /** prompts whose replies may be reused: max number of cache hits before regenerating */
  cacheReuse: Partial<Record<PromptId, number>>;
  /** longest allowed single variable (characters) */
  maxVarChars: number;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  dailyBudgetUsd: 2,
  perPlayerDayCalls: 150,
  perRunCalls: 500,
  cacheReuse: { P4: 2, P6: 1_000_000 },
  maxVarChars: 20_000,
};

export interface ProxyStore {
  /** `killSwitch` is the stored flag; the env flag is passed to handleLlmRequest separately */
  status(dayKey: string): Promise<{ killSwitch: boolean; spentTodayUsd: number }>;
  countPlayerCalls(playerId: string, dayKey: string): Promise<number>;
  countRunCalls(runId: string): Promise<number>;
  cacheGet(key: string): Promise<{ json: unknown; hits: number } | null>;
  cachePut(key: string, json: unknown): Promise<void>;
  cacheHit(key: string): Promise<void>;
  logCalls(playerId: string, runId: string, dayKey: string, records: CallRecord[]): Promise<void>;
  addGaps(gaps: string[], promptId: string): Promise<void>;
}

export type ProxyFallbackReason = 'kill_switch' | 'budget' | 'player_cap' | 'run_cap' | 'llm_timeout' | 'llm_provider_error' | 'llm_invalid_json' | 'llm_invalid_schema';

export type ProxyResponse =
  | { status: 'ok'; source: 'llm' | 'cache'; json: unknown }
  | { status: 'fallback'; reason: ProxyFallbackReason }
  | { status: 'rejected'; reason: 'bad_request'; detail: string };

export interface ProxyRequest {
  playerId: unknown;
  runId: unknown;
  promptId: unknown;
  vars: unknown;
}

export interface ProxyDeps {
  store: ProxyStore;
  client: LlmClient;
  config?: ProxyConfig;
  now?: () => number;
  /** the environment kill switch (KILL_SWITCH=1) */
  killSwitch?: boolean;
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** two independent 32-bit hashes, so accidental collisions are very unlikely */
export function cacheKey(promptId: string, version: string, vars: unknown): string {
  const s = stable(vars);
  return `${promptId}:${version}:${fnv(s, 0x811c9dc5)}${fnv(s, 0x01234567)}`;
}

const dayKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function badRequest(detail: string): ProxyResponse {
  return { status: 'rejected', reason: 'bad_request', detail };
}

export async function handleLlmRequest(deps: ProxyDeps, req: ProxyRequest): Promise<ProxyResponse> {
  const cfg = deps.config ?? DEFAULT_PROXY_CONFIG;
  const now = deps.now ?? ((): number => Date.now());
  const dayKey = dayKeyOf(now());

  // 1. validate the request shape (never trust the client)
  const idOk = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
  if (!idOk(req.playerId)) return badRequest('playerId');
  if (!idOk(req.runId)) return badRequest('runId');
  if (typeof req.promptId !== 'string' || !isPromptId(req.promptId)) return badRequest('promptId');
  if (typeof req.vars !== 'object' || req.vars === null || Array.isArray(req.vars)) return badRequest('vars must be an object');
  const vars = req.vars as Record<string, unknown>;
  const def = REGISTRY[req.promptId];
  for (const k of Object.keys(vars)) {
    if (!def.vars.includes(k)) return badRequest(`unknown variable ${k}`);
    const size = typeof vars[k] === 'string' ? (vars[k] as string).length : JSON.stringify(vars[k]).length;
    if (size > cfg.maxVarChars) return badRequest(`variable ${k} is too large`);
  }
  for (const k of def.vars) if (!(k in vars)) return badRequest(`missing variable ${k}`);

  // 2. kill switch, budget, caps: the fallback takes over silently
  const status = await deps.store.status(dayKey);
  if (deps.killSwitch || status.killSwitch) return { status: 'fallback', reason: 'kill_switch' };
  if (status.spentTodayUsd >= cfg.dailyBudgetUsd) return { status: 'fallback', reason: 'budget' };
  if ((await deps.store.countPlayerCalls(req.playerId, dayKey)) >= cfg.perPlayerDayCalls) return { status: 'fallback', reason: 'player_cap' };
  if ((await deps.store.countRunCalls(req.runId)) >= cfg.perRunCalls) return { status: 'fallback', reason: 'run_cap' };

  // 3. cache
  const reuse = cfg.cacheReuse[req.promptId];
  const key = reuse !== undefined ? cacheKey(req.promptId, def.version, vars) : null;
  if (key !== null) {
    const hit = await deps.store.cacheGet(key);
    if (hit && hit.hits < (reuse as number)) {
      await deps.store.cacheHit(key);
      return { status: 'ok', source: 'cache', json: hit.json };
    }
  }

  // 4. call, log every attempt (even failures cost money), harvest gaps, cache
  const res = await deps.client.complete(req.promptId, vars);
  if (!res.ok) for (const r of res.records) r.fallbackUsed = true;
  await deps.store.logCalls(req.playerId, req.runId, dayKey, res.records);
  if (!res.ok) return { status: 'fallback', reason: `llm_${res.reason}` as ProxyFallbackReason };
  const gaps = (res.json as { library_gap?: unknown }).library_gap;
  if (Array.isArray(gaps) && gaps.length) await deps.store.addGaps(gaps.filter((g): g is string => typeof g === 'string'), req.promptId);
  if (key !== null) await deps.store.cachePut(key, res.json);
  return { status: 'ok', source: 'llm', json: res.json };
}

/** In-memory store for tests and local runs. */
export class InMemoryProxyStore implements ProxyStore {
  killSwitch = false;
  readonly calls: { playerId: string; runId: string; dayKey: string; record: CallRecord }[] = [];
  readonly cache = new Map<string, { json: unknown; hits: number }>();
  readonly gaps = new Map<string, number>();
  async status(dayKey: string): Promise<{ killSwitch: boolean; spentTodayUsd: number }> {
    return { killSwitch: this.killSwitch, spentTodayUsd: this.calls.filter((c) => c.dayKey === dayKey).reduce((a, c) => a + c.record.costUsd, 0) };
  }
  async countPlayerCalls(playerId: string, dayKey: string): Promise<number> {
    return this.calls.filter((c) => c.playerId === playerId && c.dayKey === dayKey).length;
  }
  async countRunCalls(runId: string): Promise<number> {
    return this.calls.filter((c) => c.runId === runId).length;
  }
  async cacheGet(key: string): Promise<{ json: unknown; hits: number } | null> {
    return this.cache.get(key) ?? null;
  }
  async cachePut(key: string, json: unknown): Promise<void> {
    this.cache.set(key, { json, hits: 0 });
  }
  async cacheHit(key: string): Promise<void> {
    const e = this.cache.get(key);
    if (e) e.hits++;
  }
  async logCalls(playerId: string, runId: string, dayKey: string, records: CallRecord[]): Promise<void> {
    for (const record of records) this.calls.push({ playerId, runId, dayKey, record });
  }
  async addGaps(gaps: string[], _promptId: string): Promise<void> {
    for (const g of gaps) this.gaps.set(g, (this.gaps.get(g) ?? 0) + 1);
  }
}
