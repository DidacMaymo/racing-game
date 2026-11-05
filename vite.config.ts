/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// base './' => funciona igual en GitHub Pages (/repo/) que en Cloudflare (/)
export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
