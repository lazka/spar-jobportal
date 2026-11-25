export function normalizeSearch(text) {
  return String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de-AT').replaceAll('ß', 'ss');
}

export function coordinateKey(pair) {
  return Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite) &&
    Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180 ? pair.join(',') : null;
}

export function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const hav = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, hav)));
}

export function normalizeJobs(data) {
  if (!Array.isArray(data)) throw new Error('Expected an array of jobs');
  return data.map(job => ({
    ...job,
    state: typeof job.state === 'string' ? job.state : '',
    times: (job.employmentType || '').split('/').map(value => value.trim()).filter(Boolean),
    siteKey: coordinateKey(job.unit?.coordinates),
    searchText: normalizeSearch([job.title, job.location, job.state, job.jobField, job.unit?.name, job.unit?.address].join(' '))
  }));
}

export async function loadJobs() {
  const response = await fetch(new URL('../spar_jobs_final.json', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeJobs(await response.json());
}

export function filterJobs(jobs, { query = '', state, field, time, center, radiusKm }) {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return jobs.filter(job => (!state || job.state === state) && (!field || job.jobField === field) &&
    (!time || job.times.includes(time)) && words.every(word => job.searchText.includes(word)) &&
    (!center || (job.siteKey && distanceKm(center, job.unit.coordinates) <= radiusKm)));
}

export function groupSites(jobs) {
  const sites = new Map();
  for (const job of jobs) {
    if (!job.siteKey) continue;
    if (!sites.has(job.siteKey)) sites.set(job.siteKey, { pair: job.unit.coordinates, jobs: [] });
    sites.get(job.siteKey).jobs.push(job);
  }
  return sites;
}
