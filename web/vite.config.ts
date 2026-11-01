import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The page runs in a null-origin frame with no CORS headers, so no tag may ask for CORS.
const noCrossorigin = (): Plugin => ({
  name: 'no-crossorigin',
  enforce: 'post',
  transformIndexHtml: (html) => html.replace(/(<(?:script|link)\b[^>]*?)\s+crossorigin\b/g, '$1'),
});

export default defineConfig({
  base: './',
  plugins: [react(), noCrossorigin(), viteSingleFile({ removeViteModuleLoader: true })],
  // shared/ sits beside web/, and the dev server refuses files outside its root.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
  },
});
