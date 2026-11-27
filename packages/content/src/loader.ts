import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from '../../shared/src/index.ts';

const TABLES = ['items', 'recipes', 'nodes', 'enemies', 'structures', 'npcs', 'events'] as const;

/** Load a bundle from a directory of JSON files: <table>.json (object keyed by id), thresholds.json, locations.json. */
export function loadContent(dir: string): ContentBundle {
  const read = (name: string): unknown => {
    const p = join(dir, `${name}.json`);
    if (!existsSync(p)) throw new Error(`content: missing ${name}.json in ${dir}`);
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      throw new Error(`content: ${name}.json is not valid JSON (${(e as Error).message})`);
    }
  };
  const bundle: Record<string, unknown> = {};
  for (const t of TABLES) {
    const v = read(t);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`content: ${t}.json must be an object keyed by id`);
    bundle[t] = v;
  }
  const thresholds = read('thresholds');
  const locations = read('locations');
  if (!Array.isArray(thresholds)) throw new Error('content: thresholds.json must be an array');
  if (!Array.isArray(locations)) throw new Error('content: locations.json must be an array');
  bundle['thresholds'] = thresholds;
  bundle['locations'] = locations;
  return bundle as unknown as ContentBundle;
}

export function listTables(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}
