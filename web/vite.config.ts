import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin, ProxyOptions } from 'vite';

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

// Writes this build's asset list and a version into the copy of public/sw.js in the
// output. A new version means new worker bytes, which is how the browser sees a release.
function workerManifest(): Plugin {
  return {
    name: 'worker-manifest',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = resolve(options.dir!);
      const worker = join(outDir, 'sw.js');
      const source = readFileSync(worker, 'utf8');
      const assets = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/'))
        .map((name) => `/${name}`)
        .sort();
      const version = createHash('sha256')
        .update(JSON.stringify(assets))
        .update(readFileSync(join(outDir, 'index.html')))
        .update(source)
        .digest('hex')
        .slice(0, 16);
      const written = source.replace('__SW_VERSION__', version).replace(`['__SW_ASSETS__']`, JSON.stringify(assets));
      if (written.includes('__SW_')) throw new Error('sw.js: a placeholder was not replaced');
      writeFileSync(worker, written);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), workerManifest()],
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
