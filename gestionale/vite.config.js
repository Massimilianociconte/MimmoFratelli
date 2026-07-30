import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function injectServiceWorkerPrecache() {
  return {
    name: 'caricofacile-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      const serviceWorker = bundle['sw.js'];
      if (!serviceWorker || serviceWorker.type !== 'chunk') {
        throw new Error('Impossibile trovare sw.js nella build.');
      }

      const buildAssets = Object.values(bundle)
        .map((output) => output.fileName)
        .filter((fileName) => fileName.startsWith('assets/'))
        .sort()
        .map((fileName) => `./${fileName}`);
      const buildId = createHash('sha256')
        .update(buildAssets.join('\n'))
        .digest('hex')
        .slice(0, 12);

      serviceWorker.code = serviceWorker.code
        .replace(/["']__CARICOFACILE_PRECACHE__["']/, JSON.stringify(buildAssets))
        .replace(/["']__CARICOFACILE_BUILD_ID__["']/, JSON.stringify(buildId));

      if (
        serviceWorker.code.includes('__CARICOFACILE_PRECACHE__') ||
        serviceWorker.code.includes('__CARICOFACILE_BUILD_ID__')
      ) {
        throw new Error('Iniezione della precache PWA non riuscita.');
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [injectServiceWorkerPrecache()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        sw: resolve(import.meta.dirname, 'src/sw.js'),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
