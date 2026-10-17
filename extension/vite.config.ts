import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Builds the side panel UI (also used as the full-page "open in tab" view).
// Background + content scripts are bundled separately by scripts/build-scripts.mjs
// because content scripts must be classic (non-module) files.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { sidepanel: resolve(__dirname, 'sidepanel.html') } },
  },
});
