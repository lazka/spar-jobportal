import { coordinateKey } from './jobs.js';

/** @import { Coordinates } from './jobs.js' */
/** @typedef {{label: string, fullLabel: string, pair: Coordinates}} Place */
/** @typedef {{road?: string, pedestrian?: string, house_number?: string, postcode?: string, city?: string, town?: string, village?: string, hamlet?: string, municipality?: string, state?: string}} PlaceAddress */
/** @typedef {{display_name: string, name?: string, address?: PlaceAddress, lat: string, lon: string}} NominatimResult */

/** @type {Map<string, Place[]>} */
const cache = new Map();
let lastRequest = 0;

/** @param {NominatimResult} result */
export function compactPlaceLabel({ display_name, name, address }) {
  if (!address) return display_name;
  const road = address.road || address.pedestrian;
  const locality = address.city || address.town || address.village || address.hamlet || address.municipality;
  const street = road && [road, address.house_number].filter(Boolean).join(' ');
  const town = [address.postcode, locality || address.state].filter(Boolean).join(' ');
  const nameIsRedundant = [road, address.house_number, address.postcode, locality, address.state].includes(name);
  return [nameIsRedundant ? '' : name, street, town].filter(Boolean).join(', ') || display_name;
}

/**
 * @param {string} query
 * @param {import('./i18n.js').Language} language
 */
export async function searchPlaces(query, language) {
  const cacheKey = `${language}:${query.toLocaleLowerCase('de-AT').replace(/\s+/g, ' ')}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequest = Date.now();

  const params = new URLSearchParams({
    q: query, countrycodes: 'at', format: 'jsonv2', addressdetails: '1', limit: '5',
    'accept-language': language === 'en' ? 'en,de' : 'de'
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    referrerPolicy: 'strict-origin-when-cross-origin',
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  /** @type {NominatimResult[]} */
  const data = await response.json();
  const results = data.map(/** @returns {Place} */ result => ({
    label: compactPlaceLabel(result), fullLabel: result.display_name, pair: [parseFloat(result.lat), parseFloat(result.lon)]
  })).filter(place => place.label && coordinateKey(place.pair));
  cache.set(cacheKey, results);
  return results;
}
