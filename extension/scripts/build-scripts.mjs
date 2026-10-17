import { build } from 'esbuild';

const common = { bundle: true, minify: true, target: 'chrome116', logLevel: 'info' };
await build({ ...common, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' });
await build({ ...common, entryPoints: ['src/offscreen/index.ts'], outfile: 'dist/offscreen.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/content/spotify-hook.ts'], outfile: 'dist/spotify-hook.js', format: 'iife' });
