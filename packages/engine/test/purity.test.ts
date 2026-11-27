import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

function strip(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('engine source never touches graphics, the DOM, the network, the clock or Math.random', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 15);
  const banned: [string, RegExp][] = [
    ['phaser', /phaser/i],
    ['DOM/window', /\b(window|document|localStorage|sessionStorage|navigator)\b/],
    ['node builtins', /from\s+['"]node:/],
    ['network', /\b(fetch|XMLHttpRequest|WebSocket)\b/],
    ['wall clock', /\b(Date\.now|new Date|performance\.now|setTimeout|setInterval)\b/],
    ['unseeded randomness', /Math\.random|crypto\./],
    ['LLM / supabase', /supabase|anthropic|openai/i],
  ];
  for (const f of files) {
    const code = strip(readFileSync(join(SRC, f), 'utf8'));
    for (const [name, re] of banned) assert.ok(!re.test(code), `${f} uses ${name}`);
  }
});

test('engine imports only from itself and shared', () => {
  for (const f of readdirSync(SRC).filter((x) => x.endsWith('.ts'))) {
    const code = strip(readFileSync(join(SRC, f), 'utf8'));
    for (const m of code.matchAll(/from\s+'([^']+)'/g)) {
      assert.match(m[1]!, /^\.\/|^\.\.\/\.\.\/shared\/src\/index\.ts$/, `${f} imports ${m[1]}`);
    }
  }
});
