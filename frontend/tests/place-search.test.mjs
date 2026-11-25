import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPlaceLabel } from '../place-search.js';

const graz = {
  display_name: '39, Maygasse, Jakominivorstadt, Katastralgemeinde Jakomini, Jakomini, Graz, Steiermark, 8010, Österreich',
  lat: '47.06',
  lon: '15.45',
};

await test('street addresses keep the street, house number, postcode and town', () => {
  const address = {
    road: 'Maygasse', house_number: '39', postcode: '8010', city: 'Graz', state: 'Steiermark',
    suburb: 'Jakomini', neighbourhood: 'Jakominivorstadt',
  };
  assert.equal(compactPlaceLabel({ ...graz, name: '39', address }), 'Maygasse 39, 8010 Graz');
});

await test('town and postcode results do not repeat their names; places without details keep their full label', () => {
  assert.equal(compactPlaceLabel({ ...graz, name: 'Graz', address: { city: 'Graz', state: 'Steiermark' } }), 'Graz');
  assert.equal(compactPlaceLabel({ ...graz, name: '8010', address: { postcode: '8010', city: 'Graz' } }), '8010 Graz');
  assert.equal(compactPlaceLabel(graz), graz.display_name);
});
