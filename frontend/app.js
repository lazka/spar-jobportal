import { createJobList } from './job-list.js';
import { filterJobs, groupSites, loadJobs } from './jobs.js';
import { createMap } from './map.js';
import { searchPlaces } from './place-search.js';
import { changeLanguage, initLanguage, jobLabel, language, locale, t, translateMarkup } from './i18n.js';

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
 * @param {Parameters<typeof jobLabel>[0]} category
 */
function setOptions(select, values, category) {
  const selected = select.value;
  const unique = new Set(values.filter(/** @returns {value is string} */ value => typeof value === 'string' && value !== ''));
  const options = Array.from(unique, value => new Option(jobLabel(category, value), value));
  const collator = new Intl.Collator(locale());
  options.sort((a, b) => collator.compare(a.text, b.text));
  select.replaceChildren(select.options[0], ...options);
  select.value = selected;
}

window.addEventListener('DOMContentLoaded', async () => {
  await initLanguage();
  const languageToggle = control('language', HTMLButtonElement);
  function translatePage() {
    document.documentElement.lang = locale();
    translateMarkup(document);
    document.title = t('title');
    languageToggle.textContent = language() === 'en' ? 'DE' : 'EN';
    languageToggle.setAttribute('aria-label', t('switchLanguage'));
  }
  translatePage();

  /** @type {Job[]} */
  let jobs;
  let loadState = 'loading';
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
  /** @type {'' | 'radiusStatus' | 'noPlace' | 'placeError' | 'searchingPlace'} */
  let placeStatus = '';
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

  languageToggle.hidden = false;
  languageToggle.addEventListener('click', async () => {
    await changeLanguage(language() === 'en' ? 'de' : 'en');
    translatePage();
    map?.translate();
    renderPlaceStatus();
    if (loadState === 'ready') {
      renderJobFilters();
      renderList(true);
    } else if (loadState === 'error') {
      jobList.showLoadError();
    }
  });

  function renderJobFilters() {
    const coverageNote = $('map-coverage-note');
    coverageNote.textContent = t('mapCoverage', { count: jobs.filter(job => !job.siteKey).length });
    coverageNote.hidden = false;
    setOptions(state, jobs.map(job => job.state), 'state');
    setOptions(field, jobs.map(job => job.jobField), 'field');
    setOptions(employment, jobs.flatMap(job => job.times), 'employment');
  }

  function renderList(preservePages = false) {
    const site = selected ? sites.get(selected) : undefined;
    const activeFilters = [search.value.trim(), state.value, field.value, employment.value, showUnmapped].filter(Boolean).length;
    filterCount.textContent = t('activeFilters', { count: activeFilters });
    filterCount.hidden = activeFilters === 0;
    unmappedButton.hidden = !showUnmapped && !unmapped.length;
    unmappedButton.textContent = t('unmappedCount', { count: unmapped.length });
    unmappedButton.setAttribute('aria-pressed', String(showUnmapped));
    unmappedNote.hidden = !showUnmapped;
    $('unmapped-radius-note').hidden = !center;
    jobList.render(site?.jobs ?? matches, {
      selected, center: center?.pair, preservePages
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
    placeStatus = 'radiusStatus';
    renderPlaceStatus();
    applyFilters();
  }

  function renderPlaceStatus() {
    const status = placeStatus ? t(placeStatus, { radius: radius(), place: center?.label ?? '' }) : '';
    const keptRadius = center && (placeStatus === 'noPlace' || placeStatus === 'placeError')
      ? ` ${t('radiusKept', { place: center.label })}` : '';
    $('place-status').textContent = status + keptRadius;
  }

  /** @param {Event} event */
  async function findPlace(event) {
    event.preventDefault();
    const query = place.value.trim();
    if (!query || findPlaceButton.disabled) return;
    findPlaceButton.disabled = true;
    clearPlace.disabled = true;
    placeStatus = 'searchingPlace';
    renderPlaceStatus();
    $('place-choices').hidden = true;
    try {
      placeResults = await searchPlaces(query, language());
      if (!placeResults.length) {
        placeStatus = 'noPlace';
        renderPlaceStatus();
        return;
      }
      if (placeResults.length > 1) {
        const duplicates = new Set(placeResults.filter((result, i) =>
          placeResults.some((other, j) => j !== i && other.label === result.label)
        ).map(result => result.label));
        placeResult.replaceChildren(...placeResults.map((result, i) =>
          new Option(duplicates.has(result.label) ? result.fullLabel : result.label, String(i))));
        $('place-choices').hidden = false;
      }
      selectPlace(placeResults[0]);
    } catch (error) {
      placeStatus = 'placeError';
      renderPlaceStatus();
      console.error(error);
    } finally {
      findPlaceButton.disabled = false;
      clearPlace.disabled = false;
    }
  }

  try {
    jobs = await loadJobs();
  } catch (error) {
    loadState = 'error';
    jobList.showLoadError();
    console.error(error);
    return;
  }

  loadState = 'ready';
  renderJobFilters();
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
    placeStatus = '';
    renderPlaceStatus();
    place.value = '';
    applyFilters();
    place.focus();
  });
  applyFilters();
});
