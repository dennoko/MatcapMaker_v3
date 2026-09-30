/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { singleFile, webLicenses } from './scripts/singleFile';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(['web', 'single'].includes(mode) ? [webLicenses()] : []), ...(mode === 'single' ? [singleFile()] : [])],
  base: ['web', 'single'].includes(mode) ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(r('./version.json'), 'utf8')).version),
    __WEB_BUILD__: JSON.stringify(['web', 'single'].includes(mode)),
  },
  resolve: {
    alias: {
      ...(['web', 'single'].includes(mode) ? { '$platform/index': r('./src/platform/index.web.ts') } : {}),
      $core: r('./src/core'),
      $render: r('./src/render'),
      $platform: r('./src/platform'),
      $app: r('./src/app'),
    },
  },
  assetsInclude: ['**/*.glsl'],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    ...(mode === 'single' ? {
      outDir: 'dist-single',
      copyPublicDir: false,
      assetsInlineLimit: Infinity,
      cssCodeSplit: false,
      modulePreload: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    } : {}),
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
