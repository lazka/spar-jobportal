import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPlaceLabel, searchPlaces } from '../place-search.js';

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

await test('place search keeps the first valid result per compact label', async t => {
  const maygasse = {
    name: 'Maygasse',
    display_name: 'Maygasse, Jakominivorstadt, Katastralgemeinde Jakomini, Jakomini, Graz, Steiermark, 8010, Österreich',
    address: { road: 'Maygasse', postcode: '8010', city: 'Graz' },
    lat: '47.0632060',
    lon: '15.4446249',
  };
  const differentFullLabel = 'Maygasse, Another District, Graz, Steiermark, 8010, Österreich';
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { ...maygasse, lat: 'invalid' },
    maygasse,
    { ...maygasse, lat: '47.0648583', lon: '15.4434809' },
    { ...maygasse, display_name: differentFullLabel, lat: '47.07', lon: '15.45' },
    { ...graz, name: '39', address: { ...maygasse.address, house_number: '39' } },
  ]));
  assert.deepEqual(await searchPlaces('graz maygasse', 'de'), [
    { label: 'Maygasse, 8010 Graz', pair: [47.063206, 15.4446249] },
    { label: 'Maygasse 39, 8010 Graz', pair: [47.06, 15.45] },
  ]);
});
