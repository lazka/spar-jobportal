import { coordinateKey } from './jobs.js';

/** @import { Coordinates } from './jobs.js' */
/** @typedef {{label: string, pair: Coordinates}} Place */
/** @typedef {{display_name: string, lat: string, lon: string}} NominatimResult */

/** @type {Map<string, Place[]>} */
const cache = new Map();
let lastRequest = 0;

/** @param {string} query */
export async function searchPlaces(query) {
  const cacheKey = query.toLocaleLowerCase('de-AT').replace(/\s+/g, ' ');
  const cached = cache.get(cacheKey);
  if (cached) return cached;

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

  /** @type {NominatimResult[]} */
  const data = await response.json();
  const results = data.map(/** @returns {Place} */ result => ({
    label: result.display_name, pair: [parseFloat(result.lat), parseFloat(result.lon)]
  })).filter(place => place.label && coordinateKey(place.pair));
  cache.set(cacheKey, results);
  return results;
}
