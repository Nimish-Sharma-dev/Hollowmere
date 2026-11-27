/** IDs are lowercase snake_case and unique (AGENTS.md). Slot names follow the same rule. */
export const ID_RE = /^[a-z][a-z0-9_]*$/;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}
