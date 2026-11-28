/** Seeded, serializable PRNG (mulberry32). Same seed => same sequence on every platform. */
export class Rng {
  s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** float in [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    if (p >= 1) return true;
    if (p <= 0) return false;
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[this.int(0, arr.length - 1)] as T;
  }

  weighted<T>(entries: readonly { item: T; weight: number }[]): T {
    const total = entries.reduce((a, e) => a + Math.max(0, e.weight), 0);
    if (!(total > 0)) throw new Error('Rng.weighted: no positive weights');
    let r = this.next() * total;
    for (const e of entries) {
      r -= Math.max(0, e.weight);
      if (r < 0) return e.item;
    }
    return entries[entries.length - 1]!.item;
  }

  /** Fisher-Yates; returns a new array */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = a[i] as T;
      a[i] = a[j] as T;
      a[j] = tmp;
    }
    return a;
  }
}

/** FNV-1a 32-bit over a string. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashSeed(...parts: (number | string)[]): number {
  return hashString(parts.join('|'));
}

/** Independent stream derived from a seed and labels (does not disturb the main stream). */
export function subRng(seed: number, ...parts: (number | string)[]): Rng {
  return new Rng(hashSeed(seed, ...parts));
}

/** JSON with sorted keys, for hashing/equality. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.filter((k) => obj[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function hashState(value: unknown): string {
  return hashString(stableStringify(value)).toString(16).padStart(8, '0');
}
