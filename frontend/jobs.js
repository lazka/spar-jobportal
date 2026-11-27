/** @typedef {[number, number]} Coordinates */
/** @typedef {{address?: string | null, name?: string | null, coordinates?: Coordinates | null, orgType?: string | null}} JobUnit */
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
/** @typedef {RawJob & {state: string, states: string[], times: string[], workingHours: string[], orgType: string, siteKey: string | null, searchTitle: string}} Job */
/** @typedef {{pair: Coordinates, jobs: Job[]}} Site */

export const UNKNOWN_ORG_TYPE = ':unknown-org-type';

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
      orgType: job.unit?.orgType ?? UNKNOWN_ORG_TYPE,
      siteKey: coordinateKey(job.unit?.coordinates),
      searchTitle: normalizeSearch(job.title)
    };
  });
}

/** @param {RawJob[] | { jobs: RawJob[], lastUpdated?: unknown }} data */
export function normalizeJobDataset(data) {
  if (Array.isArray(data)) return { jobs: normalizeJobs(data), lastUpdated: null };
  const lastUpdated = data?.lastUpdated;
  return {
    jobs: normalizeJobs(data?.jobs),
    lastUpdated: typeof lastUpdated === 'string' && Number.isFinite(Date.parse(lastUpdated)) ? lastUpdated : null
  };
}

/**
 * @param {string} timestamp A valid ISO timestamp
 * @param {string} locale
 * @param {number} [now]
 */
export function formatDatasetAge(timestamp, locale, now = Date.now()) {
  const minutes = (Date.parse(timestamp) - now) / 60_000;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(minutes) >= 1440) return formatter.format(Math.trunc(minutes / 1440), 'day');
  if (Math.abs(minutes) >= 60) return formatter.format(Math.trunc(minutes / 60), 'hour');
  if (Math.abs(minutes) >= 1) return formatter.format(Math.trunc(minutes), 'minute');
  return formatter.format(0, 'second');
}

export async function loadJobs() {
  const response = await fetch(new URL('./spar_jobs_final.json', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeJobDataset(await response.json());
}

/**
 * @param {Job[]} jobs
 * @param {{query?: string, states?: string[], fields?: string[], workingHours?: string[], orgTypes?: string[], center?: Coordinates, radiusKm?: number}} filters
 */
export function filterJobs(jobs, { query = '', states = [], fields = [], workingHours = [], orgTypes = [], center, radiusKm = 0 }) {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const selectedStates = new Set(states);
  const selectedFields = new Set(fields);
  const selectedHours = new Set(workingHours);
  const selectedOrgTypes = new Set(orgTypes);
  const matches = jobs.filter(job => (!selectedStates.size || job.states.some(state => selectedStates.has(state))) &&
    (!selectedFields.size || selectedFields.has(job.jobField ?? '')) &&
    (!selectedHours.size || job.workingHours.some(time => selectedHours.has(time))) &&
    (!selectedOrgTypes.size || selectedOrgTypes.has(job.orgType)) &&
    words.every(word => job.searchTitle.includes(word)));
  if (!center) return matches;

  return matches.flatMap(job => {
    if (!job.siteKey || !job.unit?.coordinates) return [];
    const distance = distanceKm(center, job.unit.coordinates);
    return distance <= radiusKm ? [{ job, distance }] : [];
  }).sort((a, b) => a.distance - b.distance).map(({ job }) => job);
}

/**
 * @param {Job[]} jobs
 * @param {(pair: Coordinates) => boolean} contains
 */
export function filterJobsInMapView(jobs, contains) {
  return jobs.filter(job => job.siteKey && job.unit?.coordinates && contains(job.unit.coordinates));
}

/** @param {RawJob} job */
export function jobLocation(job) {
  return job.unit?.address?.trim() || job.location?.trim() || '';
}

/** @param {RawJob[]} jobs */
export function siteLocation(jobs) {
  const addresses = new Set(jobs.map(job => job.unit?.address?.trim()).filter(Boolean));
  const labels = addresses.size ? addresses : new Set(jobs.map(jobLocation).filter(Boolean));
  // A shared pin need not have a single address or fallback location.
  return labels.size === 1 ? labels.values().next().value : undefined;
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

/** @param {Job[]} jobs */
export function summarizeSiteJobs(jobs) {
  /** @type {Map<string, {field: string | null, times: string[], count: number}>} */
  const groups = new Map();
  for (const job of jobs) {
    const field = job.jobField || null;
    const key = JSON.stringify([field, [...new Set(job.times)].sort()]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { field, times: job.times, count: 1 });
  }
  const rows = Array.from(groups.values()).slice(0, 4);
  return { rows, remaining: jobs.length - rows.reduce((sum, row) => sum + row.count, 0) };
}
