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
  const clearKeyword = control('clear-keyword', HTMLButtonElement);
  const state = control('state', HTMLDetailsElement);
  const stateControl = $('state-control');
  const stateSummary = state.querySelector('summary');
  const clearStates = control('clear-states', HTMLButtonElement);
  const stateOptions = $('state-options');
  const selectedStates = () => Array.from(stateOptions.querySelectorAll('input'))
    .filter(input => input.checked).map(input => input.value);
  const field = control('field', HTMLSelectElement);
  const employment = control('employment', HTMLSelectElement);
  const advancedToggle = control('advanced-title', HTMLButtonElement);
  const filters = control('filters', HTMLFormElement);
  const activeFilterActions = $('active-filter-actions');
  const filterCount = $('filter-count');
  const resetFilters = control('reset-filters', HTMLButtonElement);
  const place = control('place', HTMLInputElement);
  const radiusSelect = control('radius', HTMLSelectElement);
  const placeResult = control('place-result', HTMLSelectElement);
  const findPlaceButton = control('find-place', HTMLButtonElement);
  const clearPlace = control('clear-place', HTMLButtonElement);
  const unmappedButton = control('show-unmapped', HTMLButtonElement);
  const unmappedNote = $('unmapped-note');
  const radius = () => Number(radiusSelect.value);

  advancedToggle.addEventListener('click', () => {
    filters.hidden = !filters.hidden;
    advancedToggle.setAttribute('aria-expanded', String(!filters.hidden));
    if (filters.hidden) state.open = false;
  });

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
    const checked = new Set(selectedStates());
    const collator = new Intl.Collator(locale());
    const options = Array.from(new Set(jobs.flatMap(job => job.states)), value => ({
      value, text: jobLabel('state', value)
    })).sort((a, b) => collator.compare(a.text, b.text));
    stateOptions.replaceChildren(...options.map(({ value, text }) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = value;
      input.checked = checked.has(value);
      label.append(input, text);
      return label;
    }));
    setOptions(field, jobs.map(job => job.jobField), 'field');
    setOptions(employment, jobs.flatMap(job => job.times), 'employment');
  }

  function renderList(preservePages = false) {
    const site = selected ? sites.get(selected) : undefined;
    clearKeyword.hidden = !search.value;
    const states = selectedStates();
    $('state-value').textContent = states.length === 1 ? jobLabel('state', states[0])
      : states.length ? t('selectedStates', { count: states.length }) : t('all');
    clearStates.hidden = states.length === 0;
    const activeFilters = [search.value.trim(), states.length, field.value, employment.value, showUnmapped].filter(Boolean).length;
    filterCount.textContent = t('activeFilters', { count: activeFilters });
    activeFilterActions.hidden = activeFilters === 0;
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
      states: selectedStates(),
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
  filters.addEventListener('submit', event => event.preventDefault());
  /** @type {number | undefined} */
  let debounce;
  search.addEventListener('input', () => {
    clearKeyword.hidden = !search.value;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(applyFilters, 160);
  });
  clearKeyword.addEventListener('click', () => {
    search.value = '';
    search.focus();
    window.clearTimeout(debounce);
    applyFilters();
  });
  for (const filter of [state, field, employment]) filter.addEventListener('change', () => {
    window.clearTimeout(debounce);
    applyFilters();
  });
  document.addEventListener('click', event => {
    if (state.open && event.target instanceof Node && !stateControl.contains(event.target)) state.open = false;
  });
  stateControl.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.open) return;
    event.preventDefault();
    state.open = false;
    stateSummary?.focus();
  });
  clearStates.addEventListener('click', () => {
    for (const input of stateOptions.querySelectorAll('input')) input.checked = false;
    stateSummary?.focus();
    window.clearTimeout(debounce);
    applyFilters();
  });
  filters.addEventListener('reset', () => {
    if (document.activeElement === resetFilters) advancedToggle.focus();
    showUnmapped = false;
    window.clearTimeout(debounce);
    window.setTimeout(applyFilters, 0);
  });
  $('clear-site').addEventListener('click', () => {
    selected = null;
    map?.closePopup();
    renderList();
    (filters.hidden ? place : search).focus();
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
