import { createJobList } from './job-list.js';
import { filterJobs, groupSites, loadJobs } from './jobs.js';
import { createMap } from './map.js';
import { searchPlaces } from './place-search.js';
import { number } from './dom.js';

/** @import { Job } from './jobs.js' */
/** @import { Place } from './place-search.js' */

/** @param {string} id */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing page element: #${id}`);
  return element;
}

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 */
function control(id, type) {
  const element = $(id);
  if (!(element instanceof type)) throw new Error(`Unexpected control type: #${id}`);
  return element;
}

/**
 * @param {HTMLSelectElement} select
 * @param {(string | null | undefined)[]} values
 */
function addOptions(select, values) {
  const labels = values.filter(/** @returns {value is string} */ value => typeof value === 'string' && value !== '');
  for (const value of [...new Set(labels)].sort((a, b) => a.localeCompare(b, 'de-AT'))) {
    select.add(new Option(value, value));
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  /** @type {Job[]} */
  let jobs;
  /** @type {Job[]} */
  let matches = [];
  /** @type {Job[]} */
  let unmapped = [];
  let showUnmapped = false;
  let sites = groupSites(matches);
  /** @type {string | null} */
  let selected = null;
  /** @type {Place | null} */
  let center = null;
  /** @type {Place[]} */
  let placeResults = [];
  const search = control('search', HTMLInputElement);
  const state = control('state', HTMLSelectElement);
  const field = control('field', HTMLSelectElement);
  const employment = control('employment', HTMLSelectElement);
  const advancedSearch = control('advanced-search', HTMLDetailsElement);
  const filterCount = $('filter-count');
  const place = control('place', HTMLInputElement);
  const radiusSelect = control('radius', HTMLSelectElement);
  const placeResult = control('place-result', HTMLSelectElement);
  const findPlaceButton = control('find-place', HTMLButtonElement);
  const clearPlace = control('clear-place', HTMLButtonElement);
  const unmappedButton = control('show-unmapped', HTMLButtonElement);
  const unmappedNote = $('unmapped-note');
  const radius = () => Number(radiusSelect.value);

  const map = createMap($('map'), key => {
    selected = key;
    renderList();
    $('clear-site').focus();
  });

  const jobList = createJobList({
    list: $('list'), more: $('more'), count: $('count'),
    selection: $('selection'), message: $('message')
  }, map ? key => {
    $('map-title').scrollIntoView({ block: 'nearest' });
    map.showSite(key);
  } : null);

  function renderList() {
    const site = selected ? sites.get(selected) : undefined;
    const activeFilters = [search.value.trim(), state.value, field.value, employment.value, showUnmapped].filter(Boolean).length;
    filterCount.textContent = `${activeFilters} Filter aktiv`;
    filterCount.hidden = activeFilters === 0;
    unmappedButton.hidden = !showUnmapped && !unmapped.length;
    unmappedButton.textContent = `Nicht auf der Karte (${number.format(unmapped.length)})`;
    unmappedButton.setAttribute('aria-pressed', String(showUnmapped));
    unmappedNote.hidden = !showUnmapped;
    $('unmapped-radius-note').hidden = !center;
    jobList.render(site?.jobs ?? matches, {
      selected, center: center?.pair
    });
  }

  function applyFilters() {
    const radiusKm = radius();
    const matchingFilters = filterJobs(jobs, {
      query: search.value.trim(),
      state: state.value,
      field: field.value,
      time: employment.value
    });
    unmapped = matchingFilters.filter(job => !job.siteKey);
    const activeCenter = showUnmapped ? undefined : center?.pair;
    matches = showUnmapped ? unmapped : matchingFilters;
    if (activeCenter) matches = filterJobs(matches, { center: activeCenter, radiusKm });
    selected = null;
    sites = groupSites(matches);
    map?.draw(sites, activeCenter, radiusKm);
    if (!showUnmapped) map?.fit();
    renderList();
  }

  /** @param {Place} result */
  function selectPlace(result) {
    center = result;
    clearPlace.hidden = false;
    $('place-status').textContent = `Umkreis: ${radius()} km um ${result.label}`;
    applyFilters();
  }

  /** @param {string} message */
  function showPlaceError(message) {
    $('place-status').textContent = message +
      (center ? ` Der bisherige Umkreis um ${center.label} bleibt aktiv.` : '');
  }

  /** @param {Event} event */
  async function findPlace(event) {
    event.preventDefault();
    const query = place.value.trim();
    if (!query || findPlaceButton.disabled) return;
    findPlaceButton.disabled = true;
    clearPlace.disabled = true;
    $('place-status').textContent = 'Ort wird gesucht …';
    $('place-choices').hidden = true;
    try {
      placeResults = await searchPlaces(query);
      if (!placeResults.length) {
        showPlaceError('Kein Ort in Österreich gefunden. Versuche es mit Ort und Postleitzahl.');
        return;
      }
      if (placeResults.length > 1) {
        placeResult.replaceChildren(...placeResults.map((result, i) => new Option(result.label, String(i))));
        $('place-choices').hidden = false;
      }
      selectPlace(placeResults[0]);
    } catch (error) {
      showPlaceError('Die Ortssuche ist gerade nicht erreichbar. Bitte versuche es später erneut.');
      console.error(error);
    } finally {
      findPlaceButton.disabled = false;
      clearPlace.disabled = false;
    }
  }

  try {
    jobs = await loadJobs();
  } catch (error) {
    jobList.showLoadError();
    console.error(error);
    return;
  }

  const unmappedTotal = jobs.filter(job => !job.siteKey).length;
  const coverageNote = $('map-coverage-note');
  coverageNote.textContent = unmappedTotal
    ? `${number.format(unmappedTotal)} ${unmappedTotal === 1 ? 'Stelle kann' : 'Stellen können'} nicht auf der Karte angezeigt werden. Unter „Weitere Filter“ findest du sie mit „Nicht auf der Karte“.`
    : 'Alle Stellen können auf der Karte angezeigt werden.';
  coverageNote.hidden = false;

  addOptions(state, jobs.map(job => job.state));
  addOptions(field, jobs.map(job => job.jobField));
  addOptions(employment, jobs.flatMap(job => job.times));
  $('filters').addEventListener('submit', event => event.preventDefault());
  /** @type {number | undefined} */
  let debounce;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(applyFilters, 160);
  });
  for (const filter of [state, field, employment]) filter.addEventListener('change', () => {
    window.clearTimeout(debounce);
    applyFilters();
  });
  $('filters').addEventListener('reset', () => {
    showUnmapped = false;
    window.clearTimeout(debounce);
    window.setTimeout(applyFilters, 0);
  });
  $('clear-site').addEventListener('click', () => {
    selected = null;
    map?.closePopup();
    renderList();
    (advancedSearch.open ? search : place).focus();
  });
  unmappedButton.addEventListener('click', () => {
    showUnmapped = !showUnmapped;
    applyFilters();
  });
  $('nearby').addEventListener('submit', findPlace);
  radiusSelect.addEventListener('change', () => { if (center) selectPlace(center); });
  placeResult.addEventListener('change', () => {
    const result = placeResults[Number(placeResult.value)];
    if (result) selectPlace(result);
  });
  clearPlace.addEventListener('click', () => {
    center = null;
    clearPlace.hidden = true;
    $('place-choices').hidden = true;
    $('place-status').textContent = '';
    place.value = '';
    applyFilters();
    place.focus();
  });
  applyFilters();
});
