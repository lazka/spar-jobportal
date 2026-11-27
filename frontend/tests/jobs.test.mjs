import assert from 'node:assert/strict';
import test from 'node:test';
import { filterJobs, filterJobsInMapView, formatDatasetAge, groupSites, jobLocation, normalizeJobDataset, normalizeJobs, siteLocation, summarizeSiteJobs, UNKNOWN_ORG_TYPE } from '../jobs.js';

/** @type {import('../jobs.js').Coordinates} */
const vienna = [48.2082, 16.3738];
const jobs = normalizeJobs([
  { title: 'Verkäufer:in in der Thaliastraße', location: 'Ottakring', jobField: 'Verkauf',
    employmentType: 'Vollzeit / Teilzeit', unit: { address: 'Beispielstraße', name: 'INTERSPAR', coordinates: vienna } },
  { title: 'Feinkost', jobField: 'Verkauf', employmentType: 'Vollzeit',
    unit: { coordinates: [47.0707, 15.4395] } },
  { title: 'Kassa', jobField: 'Verkauf', employmentType: 'Teilzeit' }
]);

await test('job dataset preserves its timestamp and accepts older data without one', () => {
  const rawJobs = [{ title: 'Feinkost' }];
  const lastUpdated = '2026-11-25T21:21:10+00:00';
  assert.deepEqual(normalizeJobDataset({ jobs: rawJobs, lastUpdated }), {
    jobs: normalizeJobs(rawJobs), lastUpdated,
  });
  assert.equal(normalizeJobDataset({ jobs: rawJobs, lastUpdated: 'invalid' }).lastUpdated, null);
  assert.equal(normalizeJobDataset(rawJobs).lastUpdated, null);
});

await test('dataset age is relative and localized', () => {
  const lastUpdated = '2026-11-25T11:00:00+00:00';
  const fourHoursLater = Date.parse('2026-11-25T15:12:00Z');
  assert.equal(formatDatasetAge(lastUpdated, 'en-GB', fourHoursLater), '4 hours ago');
  assert.equal(formatDatasetAge(lastUpdated, 'de-AT', fourHoursLater), 'vor 4 Stunden');
  assert.equal(formatDatasetAge(lastUpdated, 'en-GB', Date.parse(lastUpdated)), 'now');
});

await test('job cards prefer the unit address and fall back to the listing location', () => {
  assert.equal(jobLocation(jobs[0]), 'Beispielstraße');
  assert.equal(jobLocation({ unit: { address: ' ' }, location: ' Ottakring ' }), 'Ottakring');
  assert.equal(jobLocation(jobs[2]), '');
});

await test('map sites prefer a shared unit address and fall back to an unambiguous location', () => {
  const fallback = { location: 'Ottakring' };
  assert.equal(siteLocation([jobs[0], fallback]), 'Beispielstraße');
  assert.equal(siteLocation([fallback, { ...fallback, unit: { address: null } }]), 'Ottakring');
  assert.equal(siteLocation([fallback, { location: 'Hernals' }]), undefined);
  assert.equal(siteLocation([jobs[0], { ...fallback, unit: { address: 'Andere Straße' } }]), undefined);
  assert.equal(siteLocation([{}]), undefined);
});

await test('title search matches accents and ß and combines with dropdown filters', () => {
  const filters = { query: '  THALIASTRASSE verkaufer  ', fields: ['Verkauf'], workingHours: ['Teilzeit'] };
  assert.deepEqual(filterJobs(jobs, filters), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { ...filters, workingHours: ['Geringfügig'] }), []);
  assert.deepEqual(filterJobs(jobs, { ...filters, query: 'verkaufer fehlt' }), []);
});

await test('title search ignores locations, work hours, site details, and category labels', () => {
  for (const query of ['Ottakring', 'Teilzeit', 'Beispielstraße', 'Interspar', 'Retail sales']) {
    assert.deepEqual(filterJobs(jobs, { query }), [], query);
  }
  assert.deepEqual(filterJobs(jobs, { query: 'Beispielstraße verkaufer' }), []);
  assert.deepEqual(filterJobs(jobs, { query: 'Verkauf' }), [jobs[0]]);
});

await test('radius search excludes distant jobs and jobs without coordinates', () => {
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 30 }), [jobs[0]]);
  assert.deepEqual(filterJobs(jobs, { center: vienna, radiusKm: 200 }), jobs.slice(0, 2));
});

await test('jobs without a radius search are sorted by numeric ID, highest first', () => {
  const openings = normalizeJobs([{ id: 9 }, { id: 100 }, { id: 20 }]);
  assert.deepEqual(filterJobs(openings, {}), [openings[1], openings[2], openings[0]]);
});

await test('radius results are closest first, with higher job IDs first at equal distance', () => {
  const nearby = normalizeJobs([
    { id: 100, unit: { coordinates: [48.3, 16.37] } },
    { id: 9, unit: { coordinates: vienna } },
    { id: 80, unit: { coordinates: [48.24, 16.37] } },
    { id: 20, unit: { coordinates: vienna } },
  ]);
  assert.deepEqual(filterJobs(nearby, { center: vienna, radiusKm: 30 }),
    [nearby[3], nearby[1], nearby[2], nearby[0]]);
});

await test('the map view uses SPAR site coordinates and excludes unmapped jobs', () => {
  assert.deepEqual(filterJobsInMapView(jobs, ([lat]) => lat >= 48), [jobs[0]]);
  assert.deepEqual(filterJobsInMapView(jobs, ([lat]) => lat < 48), [jobs[1]]);
  assert.deepEqual(filterJobsInMapView(jobs, () => true), jobs.slice(0, 2));
  assert.deepEqual(filterJobsInMapView(jobs, () => false), []);
});

await test('the map view narrows existing filters without changing nearest-first order', () => {
  const nearby = normalizeJobs([
    { jobField: 'Verkauf', unit: { coordinates: [48.3, 16.37] } },
    { jobField: 'Verkauf', unit: { coordinates: vienna } },
    { jobField: 'Gastronomie', unit: { coordinates: vienna } },
    { jobField: 'Verkauf', unit: { coordinates: [48.24, 16.37] } },
  ]);
  const matches = filterJobs(nearby, { fields: ['Verkauf'], center: vienna, radiusKm: 30 });
  assert.deepEqual(filterJobsInMapView(matches, ([lat]) => lat < 48.25), [nearby[1], nearby[3]]);
});

await test('job category filters match any selected category and combine with working hours', () => {
  const categorized = normalizeJobs([
    { jobField: 'Verkauf', employmentType: 'Teilzeit' },
    { jobField: 'Gastronomie', employmentType: 'Teilzeit' },
    { jobField: 'Verkauf', employmentType: 'Vollzeit' },
    { jobField: 'Lehrlinge', employmentType: 'Teilzeit' },
    {},
  ]);
  const fields = ['Verkauf', 'Gastronomie'];
  assert.deepEqual(filterJobs(categorized, { fields }), categorized.slice(0, 3));
  assert.deepEqual(filterJobs(categorized, { fields, workingHours: ['Teilzeit'] }), categorized.slice(0, 2));
  assert.deepEqual(filterJobs(categorized, { fields: [] }), categorized);
});

await test('organisation filters match any selected type and include missing types as unknown', () => {
  const openings = normalizeJobs([
    { jobField: 'Verkauf', unit: { orgType: 'SPAR' } },
    { jobField: 'Verkauf', unit: { orgType: 'INTERSPAR' } },
    { jobField: 'Verkauf', unit: { orgType: null } },
    { jobField: 'Gastronomie', unit: { name: 'SPAR' } },
  ]);
  assert.deepEqual(openings.map(job => job.orgType), ['SPAR', 'INTERSPAR', UNKNOWN_ORG_TYPE, UNKNOWN_ORG_TYPE]);
  assert.deepEqual(filterJobs(openings, { orgTypes: [UNKNOWN_ORG_TYPE] }), openings.slice(2));
  assert.deepEqual(filterJobs(openings, { orgTypes: ['SPAR', 'INTERSPAR'] }), openings.slice(0, 2));
  assert.deepEqual(filterJobs(openings, { orgTypes: ['SPAR', UNKNOWN_ORG_TYPE], fields: ['Verkauf'] }), [openings[0], openings[2]]);
  assert.deepEqual(filterJobs(openings, { orgTypes: [] }), openings);
});

await test('working hours match any selected option and expand Geringfügig-Vollzeit to all three', () => {
  const scheduled = normalizeJobs([
    { employmentType: 'Geringfügig-Vollzeit' },
    { employmentType: 'Vollzeit/Teilzeit' },
    { employmentType: 'Teilzeit' },
    { employmentType: 'Vollzeit' },
    {},
  ]);
  assert.deepEqual(scheduled[0].times, ['Geringfügig-Vollzeit']);
  assert.deepEqual(scheduled[0].workingHours, ['Geringfügig', 'Teilzeit', 'Vollzeit']);
  assert.deepEqual(filterJobs(scheduled, { workingHours: ['Geringfügig'] }), [scheduled[0]]);
  assert.deepEqual(filterJobs(scheduled, { workingHours: ['Teilzeit'] }), scheduled.slice(0, 3));
  assert.deepEqual(filterJobs(scheduled, { workingHours: ['Vollzeit'] }), [scheduled[0], scheduled[1], scheduled[3]]);
  const workingHours = ['Geringfügig', 'Teilzeit'];
  assert.deepEqual(filterJobs(scheduled, { workingHours }), scheduled.slice(0, 3));
  assert.deepEqual(filterJobs(scheduled, { workingHours: [] }), scheduled);
});

await test('site grouping falls back to coordinates without unit IDs and skips unmapped jobs', () => {
  const extra = normalizeJobs([{ title: 'Lager', unit: { coordinates: [...vienna] } }])[0];
  const sites = groupSites([...jobs, extra]);
  assert.equal(sites.size, 2);
  const key = jobs[0].siteKey;
  assert.ok(key);
  assert.deepEqual(sites.get(key), { pair: vienna, jobs: [jobs[0], extra] });
  assert.equal(jobs[2].siteKey, null);
});

await test('site grouping keeps different units separate when the company is missing', () => {
  const restaurant = { id: 12, address: 'Beispielstraße', coordinates: vienna };
  /** @type {import('../jobs.js').JobUnit} */
  const shop = { id: 34, address: 'Beispielstrasse', coordinates: [...vienna] };
  const [cook, sales, waiter] = normalizeJobs([
    { title: 'Koch', unit: restaurant },
    { title: 'Verkauf', unit: shop },
    { title: 'Service', unit: restaurant },
  ]);

  const sites = groupSites([cook, sales, waiter]);
  assert.equal(sites.size, 2);
  assert.ok(cook.siteKey && sales.siteKey);
  assert.deepEqual(sites.get(cook.siteKey)?.jobs, [cook, waiter]);
  assert.deepEqual(sites.get(sales.siteKey)?.jobs, [sales]);
});

await test('site grouping combines departments by address and company and uses a shared map position', () => {
  const shop = { id: 12, orgType: 'Maximarkt', address: 'Beispielstraße 1, 1160 Wien', coordinates: vienna };
  const [sales, cook, logistics, office] = normalizeJobs([
    { title: 'Verkauf', unit: shop },
    { title: 'Koch', unit: { ...shop, id: 34, address: 'Beispielstrasse 1,1160 Wien', coordinates: [48.209, 16.374] } },
    { title: 'Lager', unit: { ...shop, id: 56, orgType: 'SPAR' } },
    { title: 'Büro', unit: { ...shop, id: 78, address: 'Beispielstraße 2, 1160 Wien' } },
  ]);

  const sites = groupSites([sales, cook, logistics, office]);
  assert.equal(sites.size, 3);
  assert.ok(sales.siteKey);
  assert.deepEqual(sites.get(sales.siteKey)?.jobs, [sales, cook]);
  assert.equal(siteLocation([sales, cook]), shop.address);
  assert.deepEqual(groupSites([cook]).get(sales.siteKey)?.pair, vienna);
  assert.deepEqual(filterJobsInMapView([cook], pair => pair[0] === vienna[0]), [cook]);
});

await test('site previews group matching categories and hours before limiting to four rows', () => {
  const gastronomy = { jobField: 'Gastronomie', employmentType: 'Vollzeit' };
  const hidden = { jobField: 'IT', employmentType: 'Teilzeit' };
  const openings = normalizeJobs([
    gastronomy,
    { ...gastronomy, employmentType: 'Teilzeit' },
    { jobField: 'Verkauf', employmentType: 'Vollzeit / Teilzeit' },
    { jobField: 'Lager' },
    hidden,
    gastronomy,
    { jobField: 'Verkauf', employmentType: 'Teilzeit / Vollzeit' },
    hidden,
  ]);
  assert.deepEqual(summarizeSiteJobs(openings), {
    rows: [
      { field: 'Gastronomie', times: ['Vollzeit'], count: 2 },
      { field: 'Gastronomie', times: ['Teilzeit'], count: 1 },
      { field: 'Verkauf', times: ['Vollzeit', 'Teilzeit'], count: 2 },
      { field: 'Lager', times: [], count: 1 },
    ],
    remaining: 2,
  });
});
