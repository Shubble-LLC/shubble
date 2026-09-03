// MapLibre GL JS loads its tile-processing code in a web worker, and computes the worker's
// URL relative to its own module's import.meta.url. That works when maplibre-gl is loaded as
// a standalone script, but breaks once Vite bundles it into the app - the worker ends up
// pointing at a URL with no matching file, and the worker script silently fails to load
// (Vite's SPA fallback serves index.html for the missing path instead of a 404).
//
// The fix is to serve the worker's files as static, unbundled assets and tell maplibre-gl
// where to find them via setWorkerUrl() (see maplibre/MapCanvas.tsx). Copy them here, verbatim,
// so their relative import of each other keeps working.

import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist');
const destDir = join(__dirname, '..', 'public', 'maplibre-gl');

mkdirSync(destDir, { recursive: true });

for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}
