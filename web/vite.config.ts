import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';

// `npm run dev` only. The server allows state changes only from its own https origin
// and refuses anything else, so a proxied request carries that origin. That is a matter
// for this dev proxy alone: the server's check is unchanged.
const server = process.env.ISOCA_PLAY_SERVER ?? 'https://localhost:8443';
const toServer: ProxyOptions = {
  target: server,
  changeOrigin: true,
  secure: false, // a local self-signed certificate
  headers: { origin: server },
};

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Nothing goes inline: the fonts ship as their own files, which the strict CSP allows.
    assetsInlineLimit: 0,
  },
  server: {
    // shared/ sits beside web/, and the dev server refuses files outside its root.
    fs: { allow: ['..'] },
    proxy: { '/api': toServer, '/login': toServer, '/logout': toServer },
  },
  test: {
    environment: 'jsdom',
  },
});
