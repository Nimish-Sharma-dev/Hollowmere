import { costUsd, estimateTokens } from './cost.ts';
import type { CallRecord, Pricing, Usage } from './cost.ts';
import { PRICING_PLACEHOLDER } from './cost.ts';
import { REGISTRY, renderPrompt } from './prompts.ts';
import type { PromptId } from './prompts.ts';
import { validate } from './schema.ts';

/* ───────────── provider interface ───────────── */

export interface ProviderRequest {
  model: string;
  /** stable prefix (constitution); providers may cache it */
  system: string;
  prompt: string;
  maxTokens: number;
}
export interface ProviderResponse {
  text: string;
  usage: Usage;
}
export interface LlmProvider {
  readonly name: string;
  call(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Offline provider for tests and demos. The handler returns the model's raw text (or throws). */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly calls: ProviderRequest[] = [];
  private readonly handler: (req: ProviderRequest, index: number) => string | Promise<string>;
  constructor(handler: (req: ProviderRequest, index: number) => string | Promise<string>) {
    this.handler = handler;
  }
  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const index = this.calls.length;
    this.calls.push(req);
    const text = await this.handler(req, index);
    return { text, usage: { inputTokens: estimateTokens(req.system + req.prompt), outputTokens: estimateTokens(text), cachedTokens: 0 } };
  }
}

export interface AnthropicOptions {
  apiKey: string;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  anthropicVersion?: string;
}

/** Anthropic Messages API over fetch. Live-tested only with a real key: see docs/VERIFY_M3.md. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly o: Required<Omit<AnthropicOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };
  constructor(o: AnthropicOptions) {
    if (!o.apiKey) throw new Error('AnthropicProvider: apiKey is required');
    this.o = { apiKey: o.apiKey, baseUrl: o.baseUrl ?? 'https://api.anthropic.com', anthropicVersion: o.anthropicVersion ?? '2023-06-01', fetchImpl: o.fetchImpl ?? fetch };
  }
  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens, messages: [{ role: 'user', content: req.prompt }] };
    if (req.system) body['system'] = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
    const res = await this.o.fetchImpl(`${this.o.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.o.apiKey, 'anthropic-version': this.o.anthropicVersion },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`anthropic http ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const u = data.usage ?? {};
    return { text, usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0 } };
  }
}

export interface OpenAIOptions {
  apiKey: string;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** ask for a JSON object reply (response_format json_object). Default true. */
  jsonMode?: boolean;
  /** sent as reasoning_effort when set; leave unset for models that do not accept it */
  reasoningEffort?: string;
}

/**
 * OpenAI Chat Completions over fetch (POST /v1/chat/completions).
 * Same contract as AnthropicProvider: the prompt registry, schemas, retry and logging are provider-agnostic.
 * Notes for reasoning models: max_completion_tokens also counts hidden reasoning tokens, so a very small cap can
 * leave no visible text. That case throws a clear error (see docs/VERIFY_M3.md, Part 2B).
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly o: { apiKey: string; baseUrl: string; fetchImpl: typeof fetch; jsonMode: boolean; reasoningEffort: string | undefined };
  constructor(o: OpenAIOptions) {
    if (!o.apiKey) throw new Error('OpenAIProvider: apiKey is required');
    this.o = { apiKey: o.apiKey, baseUrl: (o.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, ''), fetchImpl: o.fetchImpl ?? fetch, jsonMode: o.jsonMode ?? true, reasoningEffort: o.reasoningEffort || undefined };
  }
  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });
    const body: Record<string, unknown> = { model: req.model, max_completion_tokens: req.maxTokens, messages };
    if (this.o.jsonMode) body['response_format'] = { type: 'json_object' };
    if (this.o.reasoningEffort) body['reasoning_effort'] = this.o.reasoningEffort;
    const res = await this.o.fetchImpl(`${this.o.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`openai http ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? '';
    const u = data.usage ?? {};
    const cached = Math.max(0, u.prompt_tokens_details?.cached_tokens ?? 0);
    // OpenAI's prompt_tokens includes the cached part; our Usage keeps them separate (cost.ts prices them differently)
    const usage: Usage = { inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cached), outputTokens: u.completion_tokens ?? 0, cachedTokens: cached };
    if (!text.trim()) {
      if (choice?.message?.refusal) throw new Error(`openai refused: ${choice.message.refusal.slice(0, 120)}`);
      const why = choice?.finish_reason === 'length' ? ' (finish_reason=length: the token cap was used up, often by hidden reasoning; set OPENAI_REASONING_EFFORT=low or pick a non-reasoning model)' : '';
      throw new Error(`openai returned no text${why}`);
    }
    return { text, usage };
  }
}

/**
 * Build the provider named by LLM_PROVIDER (default "anthropic") from environment variables.
 *   anthropic: ANTHROPIC_API_KEY, LLM_MODEL
 *   openai:    OPENAI_API_KEY, LLM_MODEL, optional OPENAI_BASE_URL, OPENAI_REASONING_EFFORT, OPENAI_JSON_MODE=0
 * Returns an error string (never throws) so callers can fall back or print help.
 */
export function providerFromEnv(get: (name: string) => string | undefined): { provider: LlmProvider; model: string } | { error: string } {
  const which = (get('LLM_PROVIDER') ?? 'anthropic').trim().toLowerCase() || 'anthropic';
  const model = get('LLM_MODEL')?.trim();
  if (which !== 'anthropic' && which !== 'openai') return { error: `unknown LLM_PROVIDER "${which}" (use anthropic or openai)` };
  const keyName = which === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const apiKey = get(keyName)?.trim();
  if (!apiKey) return { error: `${keyName} is not set` };
  if (!model) return { error: 'LLM_MODEL is not set (a model id from your provider\'s model list)' };
  if (which === 'openai') {
    const baseUrl = get('OPENAI_BASE_URL')?.trim();
    const effort = get('OPENAI_REASONING_EFFORT')?.trim();
    return { provider: new OpenAIProvider({ apiKey, ...(baseUrl ? { baseUrl } : {}), ...(effort ? { reasoningEffort: effort } : {}), jsonMode: get('OPENAI_JSON_MODE')?.trim() !== '0' }), model };
  }
  return { provider: new AnthropicProvider({ apiKey }), model };
}

/* ───────────── client: render, call, parse, validate, retry once, log ───────────── */

export type ClientResult =
  | { ok: true; json: unknown; records: CallRecord[] }
  | { ok: false; reason: 'timeout' | 'provider_error' | 'invalid_json' | 'invalid_schema'; detail: string; records: CallRecord[] };

export interface CompleteOptions {
  /** override the client's timeout for this call */
  timeoutMs?: number;
  /** lower the prompt's output token cap for this call (it can never be raised above the prompt's own cap) */
  maxTokens?: number;
}

export interface ClientOptions {
  provider: LlmProvider;
  model: string;
  pricing?: Pricing;
  timeoutMs?: number;
  gameTitle?: string;
  now?: () => number;
}

/** Pull the first JSON object out of a model reply (tolerates code fences and chatter). */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(stripped.slice(start, end + 1));
}

class TimeoutError extends Error {}

export class LlmClient {
  private readonly o: Required<Omit<ClientOptions, 'provider'>> & { provider: LlmProvider };
  constructor(o: ClientOptions) {
    this.o = { provider: o.provider, model: o.model, pricing: o.pricing ?? PRICING_PLACEHOLDER, timeoutMs: o.timeoutMs ?? 20000, gameTitle: o.gameTitle ?? 'Hollowmere', now: o.now ?? (() => Date.now()) };
  }

  private async attempt(promptId: PromptId, system: string, prompt: string, records: CallRecord[], note: string | null, opts: CompleteOptions): Promise<{ text: string } | { error: 'timeout' | 'provider_error'; detail: string }> {
    const def = REGISTRY[promptId];
    const started = this.o.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_r, rej) => {
        const limit = opts.timeoutMs ?? this.o.timeoutMs;
        timer = setTimeout(() => rej(new TimeoutError(`no reply within ${limit} ms`)), limit);
      });
      const res = await Promise.race([this.o.provider.call({ model: this.o.model, system, prompt: note ? `${prompt}\n\n${note}` : prompt, maxTokens: Math.min(def.maxTokens, opts.maxTokens ?? def.maxTokens) }), timeout]);
      records.push(this.record(promptId, res.usage, started, true, null));
      return { text: res.text };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      records.push(this.record(promptId, { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, started, false, detail));
      return { error: e instanceof TimeoutError ? 'timeout' : 'provider_error', detail };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private record(promptId: PromptId, usage: Usage, started: number, ok: boolean, error: string | null): CallRecord {
    return { promptId, promptVersion: REGISTRY[promptId].version, model: this.o.model, tokensIn: usage.inputTokens, tokensOut: usage.outputTokens, tokensCached: usage.cachedTokens, costUsd: costUsd(usage, this.o.model, this.o.pricing), latencyMs: Math.max(0, this.o.now() - started), ok, fallbackUsed: false, error };
  }

  /**
   * complete(promptId, vars) -> validated JSON. One retry on a malformed or off-schema reply
   * (with a stricter note) or a provider error. A timeout is not retried: the caller falls back.
   */
  async complete(promptId: PromptId, vars: Record<string, unknown>, opts: CompleteOptions = {}): Promise<ClientResult> {
    const { system, prompt } = renderPrompt(promptId, vars, this.o.gameTitle);
    const schema = REGISTRY[promptId].schema;
    const records: CallRecord[] = [];
    let note: string | null = null;
    let last: { reason: 'provider_error' | 'invalid_json' | 'invalid_schema'; detail: string } = { reason: 'provider_error', detail: '' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.attempt(promptId, system, prompt, records, note, opts);
      if ('error' in r) {
        if (r.error === 'timeout') return { ok: false, reason: 'timeout', detail: r.detail, records };
        last = { reason: 'provider_error', detail: r.detail };
        continue;
      }
      let json: unknown;
      try {
        json = extractJson(r.text);
      } catch (e) {
        last = { reason: 'invalid_json', detail: (e as Error).message };
        note = 'Your previous reply was not valid JSON. Reply with ONLY the JSON object described above.';
        markInvalid(records, last.detail);
        continue;
      }
      const errs = validate(schema, json);
      if (errs.length === 0) return { ok: true, json, records };
      last = { reason: 'invalid_schema', detail: errs.slice(0, 5).join('; ') };
      note = `Your previous reply broke the output rules: ${last.detail}. Reply with ONLY a corrected JSON object.`;
      markInvalid(records, last.detail);
    }
    return { ok: false, reason: last.reason, detail: last.detail, records };
  }
}

/** a call that returned text we could not use still cost money; flag it in the log */
function markInvalid(records: CallRecord[], detail: string): void {
  const r = records[records.length - 1];
  if (r) {
    r.ok = false;
    r.error = detail;
  }
}
