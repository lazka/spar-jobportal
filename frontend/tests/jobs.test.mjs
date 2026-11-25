import assert from 'node:assert/strict';
import test from 'node:test';
import { filterJobs, groupSites, normalizeJobs } from '../jobs.js';

/** @type {import('../jobs.js').Coordinates} */
const vienna = [48.2082, 16.3738];
const jobs = normalizeJobs([
  { title: 'Verkäufer:in', state: 'Wien', jobField: 'Verkauf', employmentType: 'Vollzeit / Teilzeit',
    unit: { address: 'Beispielstraße', coordinates: vienna } },
  { title: 'Feinkost', state: 'Steiermark', jobField: 'Verkauf', employmentType: 'Vollzeit',
    unit: { coordinates: [47.0707, 15.4395] } },
  { title: 'Kassa', state: 'Wien', jobField: 'Verkauf', employmentType: 'Teilzeit' }
]);

await test('keyword search matches accents and ß and combines with dropdown filters', () => {
  const filters = { query: '  BEISPIELSTRASSE verkaufer  ', state: 'Wien', field: 'Verkauf', time: 'Teilzeit' };
  assert.deepEqual(filterJobs(jobs, filters), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { ...filters, time: 'Geringfügig' }), []);
  assert.deepEqual(filterJobs(jobs, { ...filters, query: 'verkaufer fehlt' }), []);
});

await test('radius search excludes distant jobs and jobs without coordinates', () => {
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 30 }), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 200 }), jobs.slice(0, 2));
  assert.deepEqual(filterJobs(jobs, { state: 'Wien' }), [jobs[0], jobs[2]]);
});

await test('site grouping combines jobs with shared coordinates and skips unmapped jobs', () => {
  const extra = normalizeJobs([{ title: 'Lager', unit: { coordinates: [...vienna] } }])[0];
  const sites = groupSites([...jobs, extra]);
  assert.equal(sites.size, 2);
  const key = jobs[0].siteKey;
  assert.ok(key);
  assert.deepEqual(sites.get(key), { pair: vienna, jobs: [jobs[0], extra] });
  assert.equal(jobs[2].siteKey, null);
});
