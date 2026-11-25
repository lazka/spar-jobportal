import { createJobList } from './job-list.js';
import { filterJobs, groupSites, loadJobs } from './jobs.js';
import { createMap } from './map.js';
import { searchPlaces } from './place-search.js';

const $ = id => document.getElementById(id);

function addOptions(id, values) {
  for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de-AT'))) {
    $(id).add(new Option(value, value));
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  let jobs, matches = [], sites = new Map(), selected = null;
  let center = null, placeResults = [];
  const radius = () => Number($('radius').value);

  const map = createMap($('map'), key => {
    selected = key;
    renderList();
    $('clear-site').focus();
  });
  $('fit').disabled = !map;

  const jobList = createJobList({
    list: $('list'), more: $('more'), count: $('count'),
    selection: $('selection'), message: $('message')
  }, map ? key => {
    $('map-title').scrollIntoView({ block: 'nearest' });
    map.showSite(key);
  } : null);

  function renderList() {
    jobList.render(selected ? sites.get(selected).jobs : matches, {
      selected, center: center?.pair
    });
  }

  function applyFilters() {
    const radiusKm = radius();
    matches = filterJobs(jobs, {
      query: $('search').value,
      state: $('state').value,
      field: $('field').value,
      time: $('employment').value,
      center: center?.pair,
      radiusKm
    });
    selected = null;
    sites = groupSites(matches);
    map?.draw(sites, center?.pair, radiusKm);
    map?.fit();
    renderList();
  }

  function selectPlace(place) {
    center = place;
    $('clear-place').hidden = false;
    $('place-status').textContent = `Umkreis: ${radius()} km um ${place.label}`;
    applyFilters();
  }

  function showPlaceError(message) {
    $('place-status').textContent = message +
      (center ? ` Der bisherige Umkreis um ${center.label} bleibt aktiv.` : '');
  }

  async function findPlace(event) {
    event.preventDefault();
    const query = $('place').value.trim();
    if (!query || $('find-place').disabled) return;
    $('find-place').disabled = true;
    $('clear-place').disabled = true;
    $('place-status').textContent = 'Ort wird gesucht …';
    $('place-choices').hidden = true;
    try {
      placeResults = await searchPlaces(query);
      if (!placeResults.length) {
        showPlaceError('Kein Ort in Österreich gefunden. Versuche es mit Ort und Postleitzahl.');
        return;
      }
      if (placeResults.length > 1) {
        $('place-result').replaceChildren(...placeResults.map((place, i) => new Option(place.label, String(i))));
        $('place-choices').hidden = false;
      }
      selectPlace(placeResults[0]);
    } catch (error) {
      showPlaceError('Die Ortssuche ist gerade nicht erreichbar. Bitte versuche es später erneut.');
      console.error(error);
    } finally {
      $('find-place').disabled = false;
      $('clear-place').disabled = false;
    }
  }

  try {
    jobs = await loadJobs();
  } catch (error) {
    jobList.showLoadError();
    console.error(error);
    return;
  }

  addOptions('state', jobs.map(job => job.state));
  addOptions('field', jobs.map(job => job.jobField));
  addOptions('employment', jobs.flatMap(job => job.times));
  $('filters').addEventListener('submit', event => event.preventDefault());
  let debounce;
  $('search').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(applyFilters, 160);
  });
  for (const id of ['state', 'field', 'employment']) $(id).addEventListener('change', () => {
    clearTimeout(debounce);
    applyFilters();
  });
  $('filters').addEventListener('reset', () => {
    clearTimeout(debounce);
    setTimeout(applyFilters, 0);
  });
  $('clear-site').addEventListener('click', () => {
    selected = null;
    map?.closePopup();
    renderList();
    $('search').focus();
  });
  $('fit').addEventListener('click', () => map?.fit());
  $('nearby').addEventListener('submit', findPlace);
  $('radius').addEventListener('change', () => { if (center) selectPlace(center); });
  $('place-result').addEventListener('change', () => selectPlace(placeResults[Number($('place-result').value)]));
  $('clear-place').addEventListener('click', () => {
    center = null;
    $('clear-place').hidden = true;
    $('place-choices').hidden = true;
    $('place-status').textContent = '';
    $('place').value = '';
    applyFilters();
    $('place').focus();
  });
  applyFilters();
});
