import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {build as esbuild} from 'esbuild';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig, type Plugin} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function bundleServerSharedModulesPlugin(): Plugin {
  return {
    name: 'bundle-server-shared-modules',
    apply: 'build',
    async closeBundle() {
      const outDir = path.resolve(rootDir, 'dist', '_server');
      fs.mkdirSync(outDir, {recursive: true});

      await Promise.all([
        esbuild({
          entryPoints: [path.resolve(rootDir, 'src/utils/relationshipGraphEngine.ts')],
          bundle: true,
          platform: 'node',
          format: 'esm',
          outfile: path.resolve(outDir, 'relationshipGraphEngine.mjs'),
        }),
        esbuild({
          entryPoints: [path.resolve(rootDir, 'src/utils/authenticityReviewEngine.ts')],
          bundle: true,
          platform: 'node',
          format: 'esm',
          outfile: path.resolve(outDir, 'authenticityReviewEngine.mjs'),
        }),
      ]);

      const firebaseCfgSrc = path.resolve(rootDir, 'firebase-applet-config.json');
      if (fs.existsSync(firebaseCfgSrc)) {
        fs.copyFileSync(firebaseCfgSrc, path.resolve(outDir, 'firebase-applet-config.json'));
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), bundleServerSharedModulesPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
