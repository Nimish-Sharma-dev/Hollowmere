import { PROMPT_TEXTS } from './prompts.generated.ts';
import { P1_SCHEMA, P2_SCHEMA, P3_SCHEMA, P4_SCHEMA, P5_SCHEMA, P6_SCHEMA, P7A_SCHEMA, P7B_SCHEMA, P8_SCHEMA, P9_SCHEMA } from './schemas.ts';
import type { Validator } from './schema.ts';

export type PromptId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7a' | 'P7b' | 'P8' | 'P9';

export interface PromptDef {
  id: PromptId;
  version: string;
  schema: Validator;
  /** hard cap on output tokens for this prompt */
  maxTokens: number;
  /** creative prompts get the shared constitution (P0) prepended */
  usesConstitution: boolean;
  /** variables the template expects, derived from the template text */
  vars: string[];
}

const SCHEMAS: Record<PromptId, [Validator, number]> = {
  P1: [P1_SCHEMA, 600],
  P2: [P2_SCHEMA, 3500],
  P3: [P3_SCHEMA, 1200],
  P4: [P4_SCHEMA, 300],
  P5: [P5_SCHEMA, 700],
  P6: [P6_SCHEMA, 250],
  P7a: [P7A_SCHEMA, 250],
  P7b: [P7B_SCHEMA, 1500],
  P8: [P8_SCHEMA, 500],
  P9: [P9_SCHEMA, 200],
};

export const PROMPT_VERSION = '1';

function varsOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
}

export const REGISTRY: Record<PromptId, PromptDef> = Object.fromEntries(
  (Object.keys(SCHEMAS) as PromptId[]).map((id) => {
    const text = PROMPT_TEXTS[id]!;
    return [id, { id, version: PROMPT_VERSION, schema: SCHEMAS[id][0], maxTokens: SCHEMAS[id][1], usesConstitution: text.includes('{{P0_CONSTITUTION}}'), vars: varsOf(text).filter((v) => v !== 'P0_CONSTITUTION') } satisfies PromptDef];
  }),
) as Record<PromptId, PromptDef>;

export function isPromptId(x: string): x is PromptId {
  return x in REGISTRY;
}

function stringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export interface RenderedPrompt {
  /** stable prefix (constitution), placed first so providers can cache it */
  system: string;
  /** the task text with variables filled */
  prompt: string;
}

/** Fill a template. Throws on missing or unknown variables so a typo can never reach the model. */
export function renderPrompt(id: PromptId, vars: Record<string, unknown>, gameTitle = 'Hollowmere'): RenderedPrompt {
  const def = REGISTRY[id];
  if (!def) throw new Error(`unknown prompt ${id}`);
  const missing = def.vars.filter((v) => !(v in vars));
  if (missing.length) throw new Error(`prompt ${id}: missing variable(s) ${missing.join(', ')}`);
  const extra = Object.keys(vars).filter((v) => !def.vars.includes(v));
  if (extra.length) throw new Error(`prompt ${id}: unknown variable(s) ${extra.join(', ')}`);
  const constitution = PROMPT_TEXTS['P0']!.replace(/\{\{GAME_TITLE\}\}/g, gameTitle);
  let body = PROMPT_TEXTS[id]!.replace('{{P0_CONSTITUTION}}', '').trim();
  body = body.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => stringify(vars[k]));
  return { system: def.usesConstitution ? constitution : '', prompt: body };
}

/** P0, the shared constitution (system prompt for every creative call), with the game title filled in. */
export function constitution(gameTitle = 'Hollowmere'): string {
  return PROMPT_TEXTS['P0']!.replace(/\{\{GAME_TITLE\}\}/g, gameTitle);
}
