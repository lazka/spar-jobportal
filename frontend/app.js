import { createJobList } from './job-list.js';
import { createJobShare } from './job-share.js';
import { filterJobs, filterJobsInMapView, formatDatasetAge, groupSites, loadJobs, siteLocation } from './jobs.js';
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
 * @param {Parameters<typeof jobLabel>[0]} category
 * @param {'allFields' | 'allEmployment' | 'allOrganisations'} emptyLabel
 * @param {() => void} onChange
 */
function createMultiSelect(category, emptyLabel, onChange) {
  const details = control(category, HTMLDetailsElement);
  const wrapper = $(`${category}-control`);
  const options = $(`${category}-options`);
  const valueLabel = $(`${category}-value`);
  const summary = details.querySelector('summary');
  const clear = wrapper.querySelector('button');
  if (!clear) throw new Error(`Missing clear button for ${category}`);
  const values = () => Array.from(options.querySelectorAll('input'))
    .filter(input => input.checked).map(input => input.value);
  const close = () => { details.open = false; };

  options.addEventListener('change', onChange);
  document.addEventListener('click', event => {
    if (details.open && event.target instanceof Node && !wrapper.contains(event.target)) close();
  });
  wrapper.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !details.open) return;
    event.preventDefault();
    close();
    summary?.focus();
  });
  clear.addEventListener('click', () => {
    for (const input of options.querySelectorAll('input')) input.checked = false;
    summary?.focus();
    onChange();
  });

  return {
    values,
    close,
    /** @param {string} value */
    remove(value) {
      for (const input of options.querySelectorAll('input')) {
        if (input.value === value) input.checked = false;
      }
      onChange();
    },
    /** @param {(string | null | undefined)[]} items */
    setOptions(items) {
      const checked = new Set(values());
      const collator = new Intl.Collator(locale());
      const unique = new Set(items.filter(/** @returns {value is string} */ value => typeof value === 'string' && value !== ''));
      const labels = Array.from(unique, value => ({ value, text: jobLabel(category, value) }))
        .sort((a, b) => collator.compare(a.text, b.text));
      options.replaceChildren(...labels.map(({ value, text }) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.checked = checked.has(value);
        label.append(input, text);
        return label;
      }));
    },
    renderSummary() {
      const selected = values();
      valueLabel.textContent = selected.length === 1 ? jobLabel(category, selected[0])
        : selected.length ? t('selectedOptions', { count: selected.length }) : t(emptyLabel);
      clear.hidden = selected.length === 0;
    },
  };
}

window.addEventListener('DOMContentLoaded', async () => {
  const languageToggle = control('language', HTMLButtonElement);
  function translatePage() {
    document.documentElement.lang = locale();
    translateMarkup(document);
    document.title = t('title');
    languageToggle.textContent = language() === 'en' ? 'DE' : 'EN';
    languageToggle.setAttribute('aria-label', t('switchLanguage'));
  }
  try {
    await initLanguage();
    translatePage();
    languageToggle.hidden = false;
  } finally {
    document.documentElement.classList.remove('awaiting-language');
  }

  /** @type {Job[]} */
  let jobs;
  /** @type {string | null} */
  let lastUpdated = null;
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
  /** @type {'' | 'noPlace' | 'placeError' | 'searchingPlace'} */
  let placeStatus = '';
  let placeSearchVersion = 0;
  /** @type {number | undefined} */
  let debounce;
  const search = control('search', HTMLInputElement);
  const clearKeyword = control('clear-keyword', HTMLButtonElement);
  const field = createMultiSelect('field', 'allFields', refreshFilters);
  const employment = createMultiSelect('employment', 'allEmployment', refreshFilters);
  const organisation = createMultiSelect('organisation', 'allOrganisations', refreshFilters);
  const advancedToggle = control('advanced-title', HTMLButtonElement);
  const filters = control('filters', HTMLFormElement);
  const filterBar = $('filter-bar');
  const filterPills = $('filter-pills');
  const resetAllFilters = control('reset-all-filters', HTMLButtonElement);
  const nearby = control('nearby', HTMLFormElement);
  const place = control('place', HTMLInputElement);
  const radiusSelect = control('radius', HTMLSelectElement);
  const placeResult = control('place-result', HTMLSelectElement);
  const findPlaceButton = control('find-place', HTMLButtonElement);
  const clearPlace = control('clear-place', HTMLButtonElement);
  const unmappedButton = control('show-unmapped', HTMLButtonElement);
  const unmappedNote = $('unmapped-note');
  const mapViewCheckbox = control('filter-map-view', HTMLInputElement);
  mapViewCheckbox.checked = false;
  const mapViewNote = $('map-view-note');
  const radius = () => Number(radiusSelect.value);

  advancedToggle.addEventListener('click', () => {
    filters.hidden = !filters.hidden;
    advancedToggle.setAttribute('aria-expanded', String(!filters.hidden));
    if (filters.hidden) {
      employment.close();
      organisation.close();
    }
  });

  const map = createMap($('map'), key => {
    selected = key;
    renderActiveFilters();
    renderList();
    const jobsTitle = $('jobs-title');
    jobsTitle.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) {
      jobsTitle.scrollIntoView({ block: 'start' });
    }
  });

  const jobCount = $('count');
  const shareJob = createJobShare(control('share-dialog', HTMLDialogElement));
  const jobList = createJobList({
    list: $('list'), more: $('more'), count: jobCount,
    message: $('message')
  }, map ? key => {
    $('map-title').scrollIntoView({ block: 'nearest' });
    map.showSite(key);
  } : null, shareJob);

  languageToggle.addEventListener('click', async () => {
    await changeLanguage(language() === 'en' ? 'de' : 'en');
    translatePage();
    renderLastUpdated();
    map?.translate();
    renderPlaceStatus();
    if (loadState === 'ready') {
      renderJobFilters();
      renderActiveFilters();
      renderList(true);
    } else if (loadState === 'error') {
      jobList.showLoadError();
    }
  });

  function renderLastUpdated() {
    if (!lastUpdated) return;
    const time = control('jobs-last-updated', HTMLTimeElement);
    time.dateTime = lastUpdated;
    time.textContent = formatDatasetAge(lastUpdated, locale());
    time.title = new Intl.DateTimeFormat(locale(), {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna'
    }).format(new Date(lastUpdated));
    $('footer-update').hidden = false;
  }

  function renderJobFilters() {
    const coverageNote = $('map-coverage-note');
    const unmappedCount = jobs.filter(job => !job.siteKey).length;
    coverageNote.hidden = unmappedCount === 0;
    coverageNote.textContent = unmappedCount ? t('mapCoverage', { count: unmappedCount }) : '';
    field.setOptions(jobs.map(job => job.jobField));
    employment.setOptions(jobs.flatMap(job => job.workingHours));
    organisation.setOptions(jobs.map(job => job.orgType));
  }

  function renderList(preservePages = false) {
    const limitToMapView = mapViewCheckbox.checked;
    const bounds = limitToMapView ? map?.getBounds() : undefined;
    const visibleJobs = bounds ? filterJobsInMapView(matches, pair => bounds.contains(pair)) : matches;
    const site = selected ? sites.get(selected) : undefined;
    if (site && bounds && !bounds.contains(site.pair)) {
      selected = null;
      renderActiveFilters();
    }
    clearKeyword.hidden = !search.value;
    field.renderSummary();
    employment.renderSummary();
    organisation.renderSummary();
    unmappedButton.hidden = !showUnmapped && !unmapped.length;
    unmappedButton.textContent = t('unmappedCount', { count: unmapped.length });
    unmappedButton.setAttribute('aria-pressed', String(showUnmapped));
    unmappedNote.hidden = !showUnmapped;
    $('unmapped-radius-note').hidden = !center;
    mapViewNote.hidden = !limitToMapView;
    jobList.render((selected && site) ? site.jobs : visibleJobs, {
      center: center?.pair, preservePages, limitToMapView
    });
  }

  function renderActiveFilters() {
    /** @type {{label: string, remove: () => void}[]} */
    const pills = [];
    if (center) {
      const label = t('radiusStatus', { radius: radius(), place: center.label });
      pills.push({ label: showUnmapped ? t('radiusPaused', { filter: label }) : label, remove: () => {
        clearPlaceSelection();
        refreshFilters();
      } });
    }
    const keyword = search.value.trim();
    if (keyword) pills.push({ label: `“${keyword}”`, remove: () => {
      search.value = '';
      refreshFilters();
    } });

    const selections = { field, employment, organisation };
    /** @type {(keyof typeof selections)[]} */
    const categories = ['field', 'employment', 'organisation'];
    for (const category of categories) {
      const select = selections[category];
      for (const value of select.values()) {
        pills.push({ label: jobLabel(category, value), remove: () => select.remove(value) });
      }
    }
    if (showUnmapped) pills.push({ label: t('unmappedFilter'), remove: () => {
      showUnmapped = false;
      refreshFilters();
    } });
    if (mapViewCheckbox.checked) pills.push({ label: t('filterMapView'), remove: () => {
      mapViewCheckbox.checked = false;
      renderActiveFilters();
      renderList();
    } });
    const site = selected ? sites.get(selected) : undefined;
    if (site) {
      const location = siteLocation(site.jobs);
      pills.push({ label: location ? t('mapSiteFilter', { location }) : t('selectedMapSite'), remove: () => {
        selected = null;
        map?.closePopup();
        renderActiveFilters();
        renderList();
      } });
    }

    filterBar.hidden = pills.length === 0;
    filterPills.replaceChildren(...pills.map(({ label, remove }, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-pill';
      button.setAttribute('aria-label', t('removeFilter', { filter: label }));
      const text = document.createElement('span');
      text.textContent = label;
      const icon = document.createElement('span');
      icon.textContent = '×';
      icon.setAttribute('aria-hidden', 'true');
      button.append(text, icon);
      button.addEventListener('click', () => {
        remove();
        const remaining = filterPills.querySelectorAll('button');
        (remaining[Math.min(index, remaining.length - 1)] ?? advancedToggle).focus();
      });
      return button;
    }));
  }

  function applyFilters(fitView = !mapViewCheckbox.checked) {
    const radiusKm = radius();
    const matchingFilters = filterJobs(jobs, {
      query: search.value.trim(),
      fields: field.values(),
      workingHours: employment.values(),
      orgTypes: organisation.values()
    });
    unmapped = matchingFilters.filter(job => !job.siteKey);
    const activeCenter = showUnmapped ? undefined : center?.pair;
    matches = showUnmapped ? unmapped : matchingFilters;
    if (activeCenter) matches = filterJobs(matches, { center: activeCenter, radiusKm });
    sites = groupSites(matches);
    if (selected && !sites.has(selected)) selected = null;
    map?.draw(sites, activeCenter, radiusKm);
    if (fitView && !showUnmapped) map?.fit();
    renderActiveFilters();
    renderList();
  }

  function refreshFilters() {
    window.clearTimeout(debounce);
    applyFilters();
  }

  /** @param {Place} result */
  function selectPlace(result) {
    center = result;
    clearPlace.hidden = false;
    placeStatus = '';
    renderPlaceStatus();
    applyFilters(true);
  }

  function renderPlaceStatus() {
    const status = placeStatus ? t(placeStatus, { radius: radius(), place: center?.label ?? '' }) : '';
    const keptRadius = center && (placeStatus === 'noPlace' || placeStatus === 'placeError')
      ? ` ${t('radiusKept', { place: center.label })}` : '';
    $('place-status').textContent = status + keptRadius;
  }

  function clearPlaceSelection() {
    placeSearchVersion++;
    center = null;
    placeResults = [];
    clearPlace.hidden = true;
    $('place-choices').hidden = true;
    placeStatus = '';
    renderPlaceStatus();
    place.value = '';
  }

  /** @param {Event} event */
  async function findPlace(event) {
    event.preventDefault();
    const query = place.value.trim();
    if (!query || findPlaceButton.disabled) return;
    const version = placeSearchVersion;
    findPlaceButton.disabled = true;
    clearPlace.disabled = true;
    placeStatus = 'searchingPlace';
    renderPlaceStatus();
    $('place-choices').hidden = true;
    try {
      const results = await searchPlaces(query, language());
      if (version !== placeSearchVersion) return;
      placeResults = results;
      if (!placeResults.length) {
        placeStatus = 'noPlace';
        renderPlaceStatus();
        return;
      }
      if (placeResults.length > 1) {
        placeResult.replaceChildren(...placeResults.map((result, i) =>
          new Option(result.label, String(i))));
        $('place-choices').hidden = false;
      }
      selectPlace(placeResults[0]);
    } catch (error) {
      if (version !== placeSearchVersion) return;
      placeStatus = 'placeError';
      renderPlaceStatus();
      console.error(error);
    } finally {
      findPlaceButton.disabled = false;
      clearPlace.disabled = false;
    }
  }

  try {
    ({ jobs, lastUpdated } = await loadJobs());
  } catch (error) {
    loadState = 'error';
    jobList.showLoadError();
    console.error(error);
    return;
  } finally {
    delete jobCount.dataset.i18n;
  }

  loadState = 'ready';
  renderLastUpdated();
  if (lastUpdated) window.setInterval(renderLastUpdated, 60_000);
  renderJobFilters();
  filters.addEventListener('submit', event => event.preventDefault());
  search.addEventListener('input', () => {
    clearKeyword.hidden = !search.value;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(applyFilters, 160);
  });
  clearKeyword.addEventListener('click', () => {
    search.value = '';
    search.focus();
    refreshFilters();
  });
  resetAllFilters.addEventListener('click', () => {
    selected = null;
    showUnmapped = false;
    mapViewCheckbox.checked = false;
    nearby.reset();
    clearPlaceSelection();
    filters.reset();
    refreshFilters();
    advancedToggle.focus();
  });
  unmappedButton.addEventListener('click', () => {
    showUnmapped = !showUnmapped;
    if (showUnmapped) mapViewCheckbox.checked = false;
    applyFilters();
  });
  if (map) {
    $('map-view-filter').hidden = false;
    mapViewCheckbox.addEventListener('change', () => {
      if (mapViewCheckbox.checked && showUnmapped) {
        showUnmapped = false;
        applyFilters();
      } else {
        renderActiveFilters();
        renderList();
      }
    });
    map.onViewChange(() => { if (mapViewCheckbox.checked) renderList(true); });
  }
  nearby.addEventListener('submit', findPlace);
  radiusSelect.addEventListener('change', () => { if (center) selectPlace(center); });
  placeResult.addEventListener('change', () => {
    const result = placeResults[Number(placeResult.value)];
    if (result) selectPlace(result);
  });
  clearPlace.addEventListener('click', () => {
    clearPlaceSelection();
    refreshFilters();
    place.focus();
  });
  applyFilters();
});
