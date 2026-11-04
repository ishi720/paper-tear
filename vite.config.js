import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds everything into one self-contained dist/index.html.
export default defineConfig({
  base: './',
  plugins: [svelte(), viteSingleFile()],
});
