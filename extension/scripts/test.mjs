// npm test: bundle every test/*.test.ts with esbuild, then run node:test.
import { build } from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync('test').filter((f) => f.endsWith('.test.ts'));
mkdirSync('.test-out', { recursive: true });
for (const f of files) await build({ entryPoints: [`test/${f}`], bundle: true, platform: 'node', format: 'esm', outfile: `.test-out/${f.replace(/\.ts$/, '.mjs')}`, logLevel: 'error' });
const r = spawnSync(process.execPath, ['--test', ...files.map((f) => `.test-out/${f.replace(/\.ts$/, '.mjs')}`)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
