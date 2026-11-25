import assert from 'node:assert/strict';
import test from 'node:test';
import { filterJobs, groupSites, normalizeJobs } from '../frontend/jobs.js';

const vienna = [48.2082, 16.3738];
const jobs = normalizeJobs([
  { title: 'Verkäufer:in', state: 'Wien', jobField: 'Verkauf', employmentType: 'Vollzeit / Teilzeit',
    unit: { address: 'Beispielstraße', coordinates: vienna } },
  { title: 'Feinkost', state: 'Steiermark', jobField: 'Verkauf', employmentType: 'Vollzeit',
    unit: { coordinates: [47.0707, 15.4395] } },
  { title: 'Kassa', state: 'Wien', jobField: 'Verkauf', employmentType: 'Teilzeit' }
]);

test('keyword search matches accents and ß and combines with dropdown filters', () => {
  const filters = { query: '  BEISPIELSTRASSE verkaufer  ', state: 'Wien', field: 'Verkauf', time: 'Teilzeit' };
  assert.deepEqual(filterJobs(jobs, filters), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { ...filters, time: 'Geringfügig' }), []);
  assert.deepEqual(filterJobs(jobs, { ...filters, query: 'verkaufer fehlt' }), []);
});

test('radius search excludes distant jobs and jobs without coordinates', () => {
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 30 }), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 200 }), jobs.slice(0, 2));
  assert.deepEqual(filterJobs(jobs, { state: 'Wien' }), [jobs[0], jobs[2]]);
});

test('site grouping combines jobs with shared coordinates and skips unmapped jobs', () => {
  const extra = normalizeJobs([{ title: 'Lager', unit: { coordinates: [...vienna] } }])[0];
  const sites = groupSites([...jobs, extra]);
  assert.equal(sites.size, 2);
  assert.deepEqual(sites.get(jobs[0].siteKey), { pair: vienna, jobs: [jobs[0], extra] });
  assert.equal(sites.has(null), false);
});
