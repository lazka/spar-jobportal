import { englishLabel } from './translations.js';

/** @typedef {[number, number]} Coordinates */
/** @typedef {{address?: string | null, name?: string | null, coordinates?: Coordinates | null}} JobUnit */
/**
 * @typedef {object} RawJob
 * @property {string | null} [title]
 * @property {string | null} [location]
 * @property {string | string[] | null} [state]
 * @property {string | null} [jobField]
 * @property {string | null} [employmentType]
 * @property {string | null} [start]
 * @property {string | null} [detailUrl]
 * @property {string | null} [applicationUrl]
 * @property {JobUnit | null} [unit]
 */
/** @typedef {RawJob & {state: string, states: string[], times: string[], workingHours: string[], siteKey: string | null, searchText: string}} Job */
/** @typedef {{pair: Coordinates, jobs: Job[]}} Site */

/** @param {string | null | undefined} text */
export function normalizeSearch(text) {
  return (text ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de-AT').replaceAll('ß', 'ss');
}

/** @param {unknown} pair */
export function coordinateKey(pair) {
  return Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite) &&
    Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180 ? pair.join(',') : null;
}

/**
 * @param {Coordinates} from
 * @param {Coordinates} to
 */
export function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const hav = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, hav)));
}

/**
 * @param {RawJob[]} data
 * @returns {Job[]}
 */
export function normalizeJobs(data) {
  if (!Array.isArray(data)) throw new Error('Expected an array of jobs');
  return data.map(job => {
    const states = [...new Set((Array.isArray(job.state) ? job.state : [job.state ?? ''])
      .flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean))];
    const state = states.join(', ');
    const times = (job.employmentType || '').split('/').map(value => value.trim()).filter(Boolean);
    const workingHours = [...new Set(times.flatMap(time =>
      time === 'Geringfügig-Vollzeit' ? ['Geringfügig', 'Teilzeit', 'Vollzeit'] : [time]))];
    return {
      ...job,
      state,
      states,
      times,
      workingHours,
      siteKey: coordinateKey(job.unit?.coordinates),
      searchText: normalizeSearch([
        job.title, job.location, state, job.jobField, job.unit?.name, job.unit?.address,
        englishLabel('state', state), englishLabel('field', job.jobField ?? ''),
      ].join(' '))
    };
  });
}

export async function loadJobs() {
  const response = await fetch(new URL('./spar_jobs_final.json', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  /** @type {RawJob[]} */
  const data = await response.json();
  return normalizeJobs(data);
}

/**
 * @param {Job[]} jobs
 * @param {{query?: string, states?: string[], fields?: string[], workingHours?: string[], center?: Coordinates, radiusKm?: number}} filters
 */
export function filterJobs(jobs, { query = '', states = [], fields = [], workingHours = [], center, radiusKm = 0 }) {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const selectedStates = new Set(states);
  const selectedFields = new Set(fields);
  const selectedHours = new Set(workingHours);
  const matches = jobs.filter(job => (!selectedStates.size || job.states.some(state => selectedStates.has(state))) &&
    (!selectedFields.size || selectedFields.has(job.jobField ?? '')) &&
    (!selectedHours.size || job.workingHours.some(time => selectedHours.has(time))) &&
    words.every(word => job.searchText.includes(word)));
  if (!center) return matches;

  return matches.flatMap(job => {
    if (!job.siteKey || !job.unit?.coordinates) return [];
    const distance = distanceKm(center, job.unit.coordinates);
    return distance <= radiusKm ? [{ job, distance }] : [];
  }).sort((a, b) => a.distance - b.distance).map(({ job }) => job);
}

/** @param {Job[]} jobs */
export function groupSites(jobs) {
  /** @type {Map<string, Site>} */
  const sites = new Map();
  for (const job of jobs) {
    const pair = job.unit?.coordinates;
    if (!job.siteKey || !pair) continue;
    let site = sites.get(job.siteKey);
    if (!site) {
      site = { pair, jobs: [] };
      sites.set(job.siteKey, site);
    }
    site.jobs.push(job);
  }
  return sites;
}
