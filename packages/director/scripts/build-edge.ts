// Usage: node packages/director/scripts/build-edge.ts [--check]
// Copies the proxy's dependency closure into supabase/functions/_shared/director so the Edge Function can import it.
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const EDGE_FILES = ['proxy.ts', 'client.ts', 'cost.ts', 'prompts.ts', 'prompts.generated.ts', 'schema.ts', 'schemas.ts'];
const src = join(import.meta.dirname, '..', 'src');
const dest = join(import.meta.dirname, '..', '..', '..', 'supabase', 'functions', '_shared', 'director');

if (process.argv.includes('--check')) {
  const stale = EDGE_FILES.filter((f) => !existsSync(join(dest, f)) || readFileSync(join(dest, f), 'utf8') !== readFileSync(join(src, f), 'utf8'));
  if (stale.length) {
    console.error(`edge bundle is out of date: ${stale.join(', ')}. Run: node packages/director/scripts/build-edge.ts`);
    process.exit(1);
  }
  console.log('edge bundle is up to date');
} else {
  mkdirSync(dest, { recursive: true });
  for (const f of EDGE_FILES) copyFileSync(join(src, f), join(dest, f));
  console.log(`copied ${EDGE_FILES.length} files to ${dest}`);
}
