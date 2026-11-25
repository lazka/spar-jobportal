import assert from 'node:assert/strict';
import test from 'node:test';
import { changeLanguage, initLanguage, jobLabel, locale, t } from '../i18n.js';
import { filterJobs, normalizeJobs } from '../jobs.js';

await test('German and English use their own labels, plurals and number formatting', async () => {
  await initLanguage();
  assert.equal(locale(), 'de-AT');
  assert.equal(t('jobCount', { count: 1 }), '1 Stelle');
  assert.equal(t('jobCount', { count: 1500 }), '1.500 Stellen');
  assert.equal(t('mapCoverage', { count: 0 }), 'Alle Stellen können auf der Karte angezeigt werden.');
  assert.equal(jobLabel('state', 'Wien, Tirol'), 'Wien, Tirol');

  await changeLanguage('en');
  assert.equal(locale(), 'en-GB');
  assert.equal(t('jobCount', { count: 1 }), '1 job');
  assert.equal(t('jobCount', { count: 1500 }), '1,500 jobs');
  assert.match(t('mapCoverage', { count: 3 }), /3 jobs.*“More filters” → “Not on the map”/);
  assert.equal(jobLabel('state', 'Wien, Tirol'), 'Vienna, Tyrol');
  assert.equal(jobLabel('employment', 'Vollzeit'), 'Full-time');
  assert.equal(jobLabel('field', 'Unbekanntes Berufsfeld'), 'Unbekanntes Berufsfeld');
});

await test('keywords match both original and translated categories without changing filter values', () => {
  const jobs = normalizeJobs([{ title: 'Verkäufer:in', state: 'Wien', jobField: 'Verkauf' }]);
  assert.deepEqual(filterJobs(jobs, { query: 'Vienna retail', states: ['Wien'], fields: ['Verkauf'] }), jobs);
  assert.deepEqual(filterJobs(jobs, { query: 'Wien Verkauf' }), jobs);
  assert.equal(normalizeJobs([{ state: [] }])[0].state, '');
});
