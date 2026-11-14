import { defineConfig } from 'vite';

// Published on GitHub Pages under /trackpaint/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/trackpaint/',
  build: { chunkSizeWarningLimit: 1500 }, // MapLibre alone is ~800 kB
});
