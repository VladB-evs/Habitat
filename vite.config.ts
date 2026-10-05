import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
  },
  resolve: {
    alias: [
      { find: 'node:sqlite', replacement: path.resolve(__dirname, 'src/vault/sqlite.ts') },
      { find: 'sqlite', replacement: path.resolve(__dirname, 'src/vault/sqlite.ts') },
      { find: 'crypto', replacement: path.resolve(__dirname, 'src/vault/crypto.ts') },
      { find: 'node:crypto', replacement: path.resolve(__dirname, 'src/vault/crypto.ts') },
      { find: 'path', replacement: path.resolve(__dirname, 'src/vault/path.ts') },
      { find: 'node:path', replacement: path.resolve(__dirname, 'src/vault/path.ts') },
      { find: 'fs', replacement: path.resolve(__dirname, 'src/vault/fs.ts') },
      { find: 'node:fs', replacement: path.resolve(__dirname, 'src/vault/fs.ts') },
      { find: path.resolve(__dirname, 'electron/files.js'), replacement: path.resolve(__dirname, 'src/vault/files.ts') },
      { find: './files', replacement: path.resolve(__dirname, 'src/vault/files.ts') },
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    commonjsOptions: {
      include: [/electron\//, /node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        /**
         * One file per heavyweight library instead of a single index.js: the
         * app loads from disk, so this is about keeping the build legible and
         * letting a change to our own code invalidate only our own chunk.
         *
         * Groups are listed most specific first — katex and highlight.js are
         * only reached through the editor, and without their own group Rolldown
         * folds them back into it.
         */
        advancedChunks: {
          minSize: 0,
          groups: [
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/, priority: 40 },
            { name: 'highlight', test: /node_modules[\\/](highlight\.js|lowlight|fault|format)[\\/]/, priority: 35 },
            { name: 'editor', test: /node_modules[\\/](@tiptap|prosemirror-|orderedmap|rope-sequence|w3c-keyname)/, priority: 30 },
            { name: 'icons', test: /node_modules[\\/]react-icons[\\/]/, priority: 25 },
            { name: 'motion', test: /node_modules[\\/](motion|framer-motion)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
});
