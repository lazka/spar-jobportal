import { coordinateKey } from './jobs.js';

const cache = new Map();
let lastRequest = 0;

export async function searchPlaces(query) {
  const cacheKey = query.toLocaleLowerCase('de-AT').replace(/\s+/g, ' ');
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequest = Date.now();

  const params = new URLSearchParams({
    q: query, countrycodes: 'at', format: 'jsonv2', limit: '5', 'accept-language': 'de'
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    referrerPolicy: 'strict-origin-when-cross-origin',
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const results = (await response.json()).map(result => ({
    label: result.display_name, pair: [parseFloat(result.lat), parseFloat(result.lon)]
  })).filter(place => place.label && coordinateKey(place.pair));
  cache.set(cacheKey, results);
  return results;
}
