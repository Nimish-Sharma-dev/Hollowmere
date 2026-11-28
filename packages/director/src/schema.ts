/**
 * Tiny schema validators (zero dependencies). Each validator appends human-readable
 * errors for the value at `path`. The plan calls for Zod (T003); these have the same
 * strict, "unknown keys are errors" behaviour and can be swapped for Zod later.
 */
export type Validator = (value: unknown, path: string, errs: string[]) => void;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (o: { min?: number; max?: number } = {}): Validator => (v, p, e) => {
  if (typeof v !== 'string') return void e.push(`${p}: expected string`);
  if (o.min !== undefined && v.length < o.min) e.push(`${p}: shorter than ${o.min}`);
  if (o.max !== undefined && v.length > o.max) e.push(`${p}: longer than ${o.max}`);
};

export const num = (min: number, max: number, int = false): Validator => (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return void e.push(`${p}: expected a finite number`);
  if (int && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
  if (v < min || v > max) e.push(`${p}: ${v} is outside ${min}..${max}`);
};

export const bool: Validator = (v, p, e) => {
  if (typeof v !== 'boolean') e.push(`${p}: expected boolean`);
};

export const lit = (...values: (string | number)[]): Validator => (v, p, e) => {
  if (!values.includes(v as string | number)) e.push(`${p}: expected one of ${values.join('|')}`);
};

export const nullable = (inner: Validator): Validator => (v, p, e) => {
  if (v !== null) inner(v, p, e);
};

export const arr = (item: Validator, o: { min?: number; max?: number } = {}): Validator => (v, p, e) => {
  if (!Array.isArray(v)) return void e.push(`${p}: expected array`);
  if (o.min !== undefined && v.length < o.min) e.push(`${p}: needs at least ${o.min} item(s)`);
  if (o.max !== undefined && v.length > o.max) e.push(`${p}: allows at most ${o.max} item(s)`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, e));
};

/** exact keys: missing and unexpected keys are both errors */
export const obj = (shape: Record<string, Validator>): Validator => (v, p, e) => {
  if (!isObj(v)) return void e.push(`${p}: expected object`);
  for (const k of Object.keys(shape)) {
    if (!(k in v)) e.push(`${p}.${k}: missing`);
    else shape[k]!(v[k], `${p}.${k}`, e);
  }
  for (const k of Object.keys(v)) if (!(k in shape)) e.push(`${p}.${k}: unexpected key`);
};

export const rec = (value: Validator): Validator => (v, p, e) => {
  if (!isObj(v)) return void e.push(`${p}: expected object`);
  for (const [k, x] of Object.entries(v)) value(x, `${p}.${k}`, e);
};

/** snake_case id (any) */
export const idStr: Validator = (v, p, e) => {
  if (typeof v !== 'string' || !/^[a-z][a-z0-9_]*$/.test(v)) e.push(`${p}: expected a snake_case id`);
};

export function validate(schema: Validator, value: unknown, root = '$'): string[] {
  const errs: string[] = [];
  schema(value, root, errs);
  return errs;
}
