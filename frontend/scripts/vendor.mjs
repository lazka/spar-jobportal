import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = {
  leaflet: {
    'leaflet.js': 'dist/leaflet.js',
    'leaflet.css': 'dist/leaflet.css',
    'images/layers.png': 'dist/images/layers.png',
    'images/layers-2x.png': 'dist/images/layers-2x.png',
    'images/marker-icon.png': 'dist/images/marker-icon.png',
    'images/marker-icon-2x.png': 'dist/images/marker-icon-2x.png',
    'images/marker-shadow.png': 'dist/images/marker-shadow.png',
    LICENSE: 'LICENSE'
  },
  'leaflet.markercluster': {
    'leaflet.markercluster-global.js': 'dist/leaflet.markercluster-global.js'
  },
  i18next: {
    'i18next.js': 'dist/esm/i18next.js',
    LICENSE: 'LICENSE'
  },
  uqr: {
    'index.mjs': 'dist/index.mjs',
    LICENSE: 'LICENSE'
  }
};

const check = process.argv.includes('--check');
for (const [pkg, assets] of Object.entries(files)) {
  for (const [name, source] of Object.entries(assets)) {
    const original = await readFile(new URL(`../node_modules/${pkg}/${source}`, import.meta.url));
    // Normalize text line endings and omit references to unpublished source maps.
    const data = name.endsWith('.png') ? original : Buffer.from(original.toString()
      .replaceAll('\r\n', '\n')
      .replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, '\n'));
    const path = fileURLToPath(new URL(`../vendor/${pkg}/${name}`, import.meta.url));
    if (check) {
      const current = await readFile(path).catch(() => null);
      if (!current?.equals(data)) {
        console.error(`Out of date: vendor/${pkg}/${name}. Run npm run vendor.`);
        process.exitCode = 1;
      }
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }
  }
}
