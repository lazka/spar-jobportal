import assert from 'node:assert/strict';
import test from 'node:test';
import { filterJobs, groupSites, normalizeJobs } from '../jobs.js';

/** @type {import('../jobs.js').Coordinates} */
const vienna = [48.2082, 16.3738];
const jobs = normalizeJobs([
  { title: 'Verkäufer:in in der Thaliastraße', state: 'Wien', location: 'Ottakring', jobField: 'Verkauf',
    employmentType: 'Vollzeit / Teilzeit', unit: { address: 'Beispielstraße', name: 'INTERSPAR', coordinates: vienna } },
  { title: 'Feinkost', state: 'Steiermark', jobField: 'Verkauf', employmentType: 'Vollzeit',
    unit: { coordinates: [47.0707, 15.4395] } },
  { title: 'Kassa', state: 'Wien', jobField: 'Verkauf', employmentType: 'Teilzeit' }
]);

await test('title search matches accents and ß and combines with dropdown filters', () => {
  const filters = { query: '  THALIASTRASSE verkaufer  ', states: ['Wien'], fields: ['Verkauf'], workingHours: ['Teilzeit'] };
  assert.deepEqual(filterJobs(jobs, filters), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { ...filters, workingHours: ['Geringfügig'] }), []);
  assert.deepEqual(filterJobs(jobs, { ...filters, query: 'verkaufer fehlt' }), []);
});

await test('title search ignores locations, work hours, site details, and category labels', () => {
  for (const query of ['Ottakring', 'Wien', 'Teilzeit', 'Beispielstraße', 'Interspar', 'Retail sales', 'Styria']) {
    assert.deepEqual(filterJobs(jobs, { query }), [], query);
  }
  assert.deepEqual(filterJobs(jobs, { query: 'Beispielstraße verkaufer' }), []);
  assert.deepEqual(filterJobs(jobs, { query: 'Verkauf' }), [jobs[0]]);
});

await test('radius search excludes distant jobs and jobs without coordinates', () => {
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 30 }), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 200 }), jobs.slice(0, 2));
});

await test('radius results are closest first, preserving the original order for ties', () => {
  const nearby = normalizeJobs([
    { title: 'Farther', unit: { coordinates: [48.3, 16.37] } },
    { title: 'Closest first', unit: { coordinates: vienna } },
    { title: 'Between', unit: { coordinates: [48.24, 16.37] } },
    { title: 'Closest second', unit: { coordinates: vienna } },
  ]);
  assert.deepEqual(filterJobs(nearby, { center: vienna, radiusKm: 30 }),
    [nearby[1], nearby[3], nearby[2], nearby[0]]);
  assert.deepEqual(filterJobs(nearby, {}), nearby);
});

await test('state filters match any selected state and include multi-state jobs only once', () => {
  const regionalJobs = normalizeJobs([
    { state: ' Wien,Steiermark, Wien ' },
    { state: ['Tirol', 'Steiermark'] },
    { state: 'Oberösterreich' },
    { state: [] },
  ]);
  assert.deepEqual(regionalJobs.map(job => job.states), [
    ['Wien', 'Steiermark'], ['Tirol', 'Steiermark'], ['Oberösterreich'], []
  ]);
  assert.deepEqual(filterJobs(regionalJobs, { states: ['Wien'] }), [regionalJobs[0]]);
  assert.deepEqual(filterJobs(regionalJobs, { states: ['Wien', 'Steiermark'] }), regionalJobs.slice(0, 2));
  assert.deepEqual(filterJobs(regionalJobs, { states: [] }), regionalJobs);
});

await test('job category filters match any selected category and combine with the states filter', () => {
  const categorized = normalizeJobs([
    { state: 'Wien', jobField: 'Verkauf' },
    { state: 'Wien', jobField: 'Gastronomie' },
    { state: 'Tirol', jobField: 'Verkauf' },
    { state: 'Wien', jobField: 'Lehrlinge' },
    { state: 'Wien' },
  ]);
  const fields = ['Verkauf', 'Gastronomie'];
  assert.deepEqual(filterJobs(categorized, { fields }), categorized.slice(0, 3));
  assert.deepEqual(filterJobs(categorized, { fields, states: ['Wien'] }), categorized.slice(0, 2));
  assert.deepEqual(filterJobs(categorized, { fields: [] }), categorized);
});

await test('working hours match any selected option and expand Geringfügig-Vollzeit to all three', () => {
  const scheduled = normalizeJobs([
    { employmentType: 'Geringfügig-Vollzeit', state: 'Wien' },
    { employmentType: 'Vollzeit/Teilzeit', state: 'Wien' },
    { employmentType: 'Teilzeit', state: 'Tirol' },
    { employmentType: 'Vollzeit', state: 'Tirol' },
    {},
  ]);
  assert.deepEqual(scheduled[0].times, ['Geringfügig-Vollzeit']);
  assert.deepEqual(scheduled[0].workingHours, ['Geringfügig', 'Teilzeit', 'Vollzeit']);
  assert.deepEqual(filterJobs(scheduled, { workingHours: ['Geringfügig'] }), [scheduled[0]]);
  assert.deepEqual(filterJobs(scheduled, { workingHours: ['Teilzeit'] }), scheduled.slice(0, 3));
  assert.deepEqual(filterJobs(scheduled, { workingHours: ['Vollzeit'] }), [scheduled[0], scheduled[1], scheduled[3]]);
  const workingHours = ['Geringfügig', 'Teilzeit'];
  assert.deepEqual(filterJobs(scheduled, { workingHours }), scheduled.slice(0, 3));
  assert.deepEqual(filterJobs(scheduled, { workingHours, states: ['Tirol'] }), [scheduled[2]]);
  assert.deepEqual(filterJobs(scheduled, { workingHours: [] }), scheduled);
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
