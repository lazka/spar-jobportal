/** @typedef {[number, number]} Coordinates */
/** @typedef {{id?: number | string | null, address?: string | null, name?: string | null, coordinates?: Coordinates | null, orgType?: string | null, relatedShop?: {pageUrl?: string | null} | null}} JobUnit */
/**
 * @typedef {object} RawJob
 * @property {number} [id]
 * @property {string | null} [title]
 * @property {string | null} [location]
 * @property {string | null} [jobField]
 * @property {string | null} [employmentType]
 * @property {string | null} [start]
 * @property {string | null} [detailUrl]
 * @property {string | null} [applicationUrl]
 * @property {JobUnit | null} [unit]
 */
/** @typedef {RawJob & {times: string[], workingHours: string[], orgType: string, siteKey: string | null, siteCoordinates: Coordinates | null, searchTitle: string}} Job */
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

/** @param {string} address */
function mapAddressKey(address) {
  return address.normalize('NFC').toLocaleLowerCase('de-AT').replaceAll('ß', 'ss').replace(/[\s,]+/g, ' ').trim();
}

/** @param {JobUnit | null | undefined} unit */
function addressCompanyKey(unit) {
  const address = mapAddressKey(unit?.address ?? '');
  const company = unit?.orgType?.trim();
  return address && company ? JSON.stringify([address, company]) : null;
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
  /** @type {Map<string, Coordinates | null>} */
  const positionsByAddress = new Map();
  for (const { unit } of data) {
    const pair = unit?.coordinates;
    const coordinate = coordinateKey(pair);
    const address = addressCompanyKey(unit);
    if (!pair || !coordinate || !address) continue;
    const previous = positionsByAddress.get(address);
    if (previous === undefined) positionsByAddress.set(address, pair);
    // A shared address can't locate an unmapped job if it points to multiple pins.
    else if (previous && coordinateKey(previous) !== coordinate) positionsByAddress.set(address, null);
  }
  return data.map(job => {
    const times = (job.employmentType || '').split('/').map(value => value.trim()).filter(Boolean);
    const workingHours = [...new Set(times.flatMap(time =>
      time === 'Geringfügig-Vollzeit' ? ['Geringfügig', 'Teilzeit', 'Vollzeit'] : [time]))];
    let siteCoordinates = job.unit?.coordinates ?? null;
    let siteKey = coordinateKey(siteCoordinates);
    if (!siteKey) {
      const address = addressCompanyKey(job.unit);
      siteCoordinates = address ? positionsByAddress.get(address) ?? null : null;
      siteKey = coordinateKey(siteCoordinates);
    }
    const company = job.unit?.orgType?.trim();
    if (siteKey) {
      if (company) siteKey = JSON.stringify([siteKey, company]);
      else if (job.unit?.id != null) siteKey += `:${job.unit.id}`;
    }
    return {
      ...job,
      times,
      workingHours,
      orgType: job.unit?.orgType ?? UNKNOWN_ORG_TYPE,
      siteKey,
      siteCoordinates,
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
  const response = await fetch('./spar_jobs_final.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeJobDataset(await response.json());
}

/**
 * @param {Job} a
 * @param {Job} b
 */
function compareJobIdsDescending(a, b) {
  return (b.id ?? 0) - (a.id ?? 0);
}

/**
 * @param {Job[]} jobs
 * @param {{query?: string, fields?: string[], workingHours?: string[], orgTypes?: string[], center?: Coordinates, radiusKm?: number}} filters
 */
export function filterJobs(jobs, { query = '', fields = [], workingHours = [], orgTypes = [], center, radiusKm = 0 }) {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const selectedFields = new Set(fields);
  const selectedHours = new Set(workingHours);
  const selectedOrgTypes = new Set(orgTypes);
  const matches = jobs.filter(job => (!selectedFields.size || selectedFields.has(job.jobField ?? '')) &&
    (!selectedHours.size || job.workingHours.some(time => selectedHours.has(time))) &&
    (!selectedOrgTypes.size || selectedOrgTypes.has(job.orgType)) &&
    words.every(word => job.searchTitle.includes(word)));
  if (!center) return matches.sort(compareJobIdsDescending);

  return matches.flatMap(job => {
    if (!job.siteCoordinates) return [];
    const distance = distanceKm(center, job.siteCoordinates);
    return distance <= radiusKm ? [{ job, distance }] : [];
  }).sort((a, b) => a.distance - b.distance || compareJobIdsDescending(a.job, b.job))
    .map(({ job }) => job);
}

/**
 * @param {Job[]} jobs
 * @param {(pair: Coordinates) => boolean} contains
 */
export function filterJobsInMapView(jobs, contains) {
  return jobs.filter(job => job.siteCoordinates && contains(job.siteCoordinates));
}

/** @param {RawJob} job */
export function jobLocation(job) {
  return job.unit?.address?.trim() || job.location?.trim() || '';
}

/** @param {RawJob[]} jobs */
export function siteLocation(jobs) {
  const addresses = jobs.map(job => job.unit?.address?.trim() ?? '').filter(Boolean);
  const [address] = addresses;
  if (address) {
    const key = mapAddressKey(address);
    return addresses.every(value => mapAddressKey(value) === key) ? address : undefined;
  }
  const labels = new Set(jobs.map(jobLocation).filter(Boolean));
  return labels.size === 1 ? labels.values().next().value : undefined;
}

/** @param {Job[]} jobs */
export function groupSites(jobs) {
  /** @type {Map<string, Site>} */
  const sites = new Map();
  for (const job of jobs) {
    const pair = job.siteCoordinates;
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
