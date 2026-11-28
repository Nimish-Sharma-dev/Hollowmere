// Usage: node packages/content/scripts/lint.ts [dir]   (default: packages/content/data)
import { join } from 'node:path';
import { loadContent, lintContent, coverage, formatCoverage } from '../src/index.ts';

const dir = process.argv[2] ?? join(import.meta.dirname, '..', 'data');
const bundle = loadContent(dir);
const issues = lintContent(bundle);
for (const i of issues) console.log(`${i.level.toUpperCase().padEnd(7)} ${i.where}: ${i.message}`);
console.log(`\n${issues.filter((i) => i.level === 'error').length} error(s), ${issues.filter((i) => i.level === 'warning').length} warning(s)\n`);
console.log(formatCoverage(coverage(bundle)));
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0);
