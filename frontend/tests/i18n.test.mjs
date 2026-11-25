import assert from 'node:assert/strict';
import test from 'node:test';
import { changeLanguage, initLanguage, jobLabel, locale, t } from '../i18n.js';

await test('German and English use their own labels, plurals and number formatting', async () => {
  await initLanguage();
  assert.equal(locale(), 'de-AT');
  assert.equal(t('jobCount', { count: 1 }), '1 Stelle');
  assert.equal(t('jobCount', { count: 1500 }), '1.500 Stellen');
  assert.equal(t('mapCoverage', { count: 0 }), 'Alle Stellen können auf der Karte angezeigt werden.');
  assert.equal(t('titleSearch'), 'Titelsuche');
  assert.equal(jobLabel('state', 'Wien, Tirol'), 'Wien, Tirol');

  await changeLanguage('en');
  assert.equal(locale(), 'en-GB');
  assert.equal(t('jobCount', { count: 1 }), '1 job');
  assert.equal(t('jobCount', { count: 1500 }), '1,500 jobs');
  assert.equal(t('titleSearch'), 'Search job titles');
  assert.match(t('mapCoverage', { count: 3 }), /3 jobs.*“More filters” → “Not on the map”/);
  assert.equal(jobLabel('state', 'Wien, Tirol'), 'Vienna, Tyrol');
  assert.equal(jobLabel('employment', 'Vollzeit'), 'Full-time');
  assert.equal(jobLabel('field', 'Unbekanntes Berufsfeld'), 'Unbekanntes Berufsfeld');
});
