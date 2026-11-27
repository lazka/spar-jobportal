import { node } from './dom.js';
import { jobLabel, locale, t } from './i18n.js';
import { siteLocation, summarizeSiteJobs } from './jobs.js';

/** @import { Coordinates, Site } from './jobs.js' */
/** @import { Circle, LatLngBoundsLiteral, Marker } from 'leaflet' */

/** @type {LatLngBoundsLiteral} */
const austria = [[46.35, 9.48], [49.03, 17.2]];

/** @param {string} encoded @returns {Coordinates[]} */
function decodeBoundary(encoded) {
  /** @type {Coordinates[]} */
  const points = [];
  let cursor = 0;
  let latitude = 0;
  let longitude = 0;
  // Encoded polyline deltas, with four decimal places.
  function readDelta() {
    let value = 0;
    let shift = 0;
    let chunk;
    do {
      chunk = encoded.charCodeAt(cursor++) - 63;
      value |= (chunk & 31) << shift;
      shift += 5;
    } while (chunk >= 32);
    return (value >>> 1) ^ -(value & 1);
  }
  while (cursor < encoded.length) {
    latitude += readDelta();
    longitude += readDelta();
    points.push([latitude / 10000, longitude / 10000]);
  }
  return points;
}

/** @param {string} filename */
async function loadBoundaries(filename) {
  const response = await fetch(new URL(filename, import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).trim().split(/\r?\n/).map(decodeBoundary);
}

/**
 * @param {HTMLElement} container
 * @param {(key: string) => void} onSelectSite
 */
export function createMap(container, onSelectSite) {
  const L = window.L;
  if (!L?.MarkerClusterGroup) {
    const notice = node('p', t('mapLoadError'));
    notice.dataset.i18n = 'mapLoadError';
    container.replaceChildren(notice);
    return null;
  }

  container.replaceChildren();
  const map = L.map(container, {
    scrollWheelZoom: true, zoomControl: false, zoomSnap: 0, maxZoom: 19, trackResize: false,
  }).fitBounds(austria);
  new ResizeObserver(() => map.invalidateSize({ debounceMoveend: true })).observe(container);
  const zoomControl = L.control.zoom({ zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(map);
  const attributionHtml = () => `${t('attribution')} <a href="https://basemap.at/en/">basemap.at</a>`;
  const tileOptions = {
    attribution: attributionHtml(),
    maxZoom: 19
  };
  const street = L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png', tileOptions).addTo(map);
  const aerial = L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', tileOptions);
  const layers = L.control.layers({ [t('streetMap')]: street, [t('aerialMap')]: aerial }, undefined, { collapsed: false }).addTo(map);
  const boundaryPane = map.createPane('stateBoundaries');
  boundaryPane.style.zIndex = '390';
  boundaryPane.style.pointerEvents = 'none';
  const boundaries = L.layerGroup([], {
    attribution: '<a href="https://doi.org/10.48677/2d7b8f24-deb9-42eb-82f2-c7c1c7ff7075">BEV</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
  });
  const boundaryOptions = { pane: 'stateBoundaries', interactive: false };
  const outline = L.polyline([], { ...boundaryOptions, color: 'var(--white)', weight: 4, opacity: .9 }).addTo(boundaries);
  const stroke = L.polyline([], { ...boundaryOptions, color: 'var(--ink)', weight: 2, opacity: .95 }).addTo(boundaries);
  /** @type {Coordinates[][]} */
  let overview = [];
  /** @type {Coordinates[][] | undefined} */
  let detail;
  let loadingDetail = false;
  const detailZoom = 11;

  function drawBoundaries() {
    const lines = map.getZoom() >= detailZoom && detail ? detail : overview;
    if (!lines.length) return;
    outline.setLatLngs(lines);
    stroke.setLatLngs(lines);
    boundaries.addTo(map);
  }
  void loadBoundaries('./bundeslaender.txt').then(lines => {
    overview = lines;
    drawBoundaries();
  }).catch(error => console.warn('Could not load Austrian state boundaries:', error));

  map.on('zoomend', () => {
    drawBoundaries();
    if (map.getZoom() < detailZoom || detail || loadingDetail) return;
    loadingDetail = true;
    void loadBoundaries('./bundeslaender-detail.txt').then(lines => {
      detail = lines;
      drawBoundaries();
    }).catch(error => console.warn('Could not load detailed state boundaries:', error))
      .finally(() => { loadingDetail = false; });
  });
  const clusters = new L.MarkerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: group => {
      const count = group.getChildCount();
      group.options.title = t('mapClusterLocations', { count });
      const label = node('span', count.toLocaleString(locale()));
      label.setAttribute('aria-hidden', 'true');
      return L.divIcon({ html: label, className: 'map-cluster-marker', iconSize: [44, 44] });
    },
  }).addTo(map);

  /** @type {Map<string, {marker: Marker, translate: () => void}>} */
  const markers = new Map();
  /** @type {Circle | null} */
  let radiusLayer = null;
  let zooming = false;
  /** @type {string | null} */
  let pendingSite = null;

  map.on('zoomstart', () => { zooming = true; });
  map.on('zoomend', () => { zooming = false; });
  const resumeSiteFocus = () => {
    if (!zooming && pendingSite !== null) showSite(pendingSite);
  };
  map.on('moveend', resumeSiteFocus);
  clusters.on('animationend', resumeSiteFocus);

  /**
   * @param {Map<string, Site>} sites
   * @param {Coordinates | undefined} center
   * @param {number} radiusKm
   */
  function draw(sites, center, radiusKm) {
    pendingSite = null;
    map.closePopup();
    clusters.clearLayers();
    radiusLayer?.remove();
    radiusLayer = center ? L.circle(center, {
      radius: radiusKm * 1000, color: 'var(--spar-red)', fillOpacity: .08, weight: 2, interactive: false
    }).addTo(map) : null;
    markers.clear();
    for (const [key, site] of sites) {
      const count = site.jobs.length;
      const location = siteLocation(site.jobs);
      const orgType = site.jobs[0]?.unit?.orgType;
      const formattedCount = count.toLocaleString(locale());
      const label = node('span', formattedCount);
      label.setAttribute('aria-hidden', 'true');
      const width = Math.max(29, 20 + 7 * formattedCount.length);
      const marker = L.marker(site.pair, {
        icon: L.divIcon({ html: label, className: 'map-site-marker', iconSize: [width, 29] })
      });
      const popup = node('div');
      const heading = node('div', '', 'map-popup-heading');
      const headingText = node('strong', location);
      if (location) headingText.lang = 'de-AT';
      heading.append(headingText);
      if (orgType && site.jobs.every(job => job.unit?.orgType === orgType)) {
        heading.append(' ', node('span', orgType, 'tag tag-neutral'));
      }
      popup.append(heading);
      const preview = node('ul', '', 'map-job-preview');
      preview.setAttribute('role', 'list');
      const { rows, remaining } = summarizeSiteJobs(site.jobs);
      const translateJobs = rows.map(({ field, times, count: occurrences }) => {
        const item = node('li');
        const category = node('span', '', 'map-job-category');
        const schedule = times.length ? node('span', '', 'muted map-job-schedule') : null;
        if (field || !schedule || occurrences > 1) item.append(category);
        if (schedule) item.append(schedule);
        preview.append(item);
        return () => {
          const prefix = occurrences > 1 ? `${occurrences.toLocaleString(locale())}×` : '';
          const label = field ? jobLabel('field', field) : schedule ? '' : t('untitledJob');
          category.textContent = [prefix, label].filter(Boolean).join(' ');
          if (schedule) schedule.textContent = times.map(value => jobLabel('employment', value)).join(' / ');
        };
      });
      popup.append(preview);
      const more = remaining > 0 ? node('div', '', 'muted map-job-more') : null;
      if (more) popup.append(more);
      const button = node('button', '', 'button-primary');
      button.type = 'button';
      button.addEventListener('click', async () => {
        if (isFullscreen()) {
          await exitFullscreen();
          map.invalidateSize();
          map.panInside(marker.getLatLng(), { animate: false });
        }
        onSelectSite(key);
      });
      popup.append(button);
      // Keep the close button clear of the layer switch on narrow maps.
      marker.bindPopup(popup, { autoPanPaddingTopLeft: [5, 70] });
      const translate = () => {
        label.textContent = count.toLocaleString(locale());
        marker.options.title = `${location || t('mapSite')}: ${t('jobCount', { count })}`;
        marker.getElement()?.setAttribute('title', marker.options.title);
        if (!location) headingText.textContent = t('jobsAtSite');
        for (const translateJob of translateJobs) translateJob();
        if (more) more.textContent = t('moreJobsAtSite', { count: remaining });
        button.textContent = t('showJobsAtSite', { count });
      };
      translate();
      markers.set(key, { marker, translate });
    }
    clusters.addLayers(Array.from(markers.values(), entry => entry.marker));
  }

  function fit() {
    pendingSite = null;
    const bounds = radiusLayer ? radiusLayer.getBounds() : clusters.getBounds();
    map.fitBounds(bounds.isValid() ? bounds : austria, { padding: [24, 24], maxZoom: 12 });
  }

  /** @param {string} path @param {() => void} onClick */
  function addMapButton(path, onClick) {
    const control = new L.Control({ position: 'topleft' });
    const bar = node('div', '', 'leaflet-bar');
    const button = node('button', '', 'map-button');
    button.type = 'button';

    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '18');
    icon.setAttribute('height', '18');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    const arrows = document.createElementNS(ns, 'path');
    arrows.setAttribute('d', path);
    icon.append(arrows);
    button.append(icon);
    button.addEventListener('click', onClick);
    bar.append(button);

    L.DomEvent.disableClickPropagation(bar);
    control.onAdd = () => bar;
    control.addTo(map);
    return { button, iconPath: arrows };
  }

  const { button: fitButton } = addMapButton(
    'm3 3 5 5m0-4v4H4m17-5-5 5m0-4v4h4M3 21l5-5m-4 0h4v4m13 1-5-5m0 4v-4h4', fit);
  labelControl(fitButton, 'resetMap');

  const frame = container.parentElement;
  const fullscreenDialog = node('dialog', '', 'map-fullscreen');
  document.body.append(fullscreenDialog);
  const expandIcon = 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6';
  const collapseIcon = 'M3 9h6V3m12 6h-6V3M9 21v-6H3m12 6v-6h6';
  const { button: fullscreenButton, iconPath: fullscreenIcon } = addMapButton(expandIcon, toggleFullscreen);
  const isFullscreen = () => document.fullscreenElement === container || fullscreenDialog.open;

  function updateFullscreenButton() {
    const active = isFullscreen();
    labelControl(fullscreenButton, active ? 'exitMapFullscreen' : 'enterMapFullscreen');
    fullscreenIcon.setAttribute('d', active ? collapseIcon : expandIcon);
    fullscreenDialog.setAttribute('aria-label', t('mapRegion'));
  }

  async function exitFullscreen() {
    if (fullscreenDialog.open) {
      frame?.append(container);
      fullscreenDialog.close();
      updateFullscreenButton();
      fullscreenButton.focus({ preventScroll: true });
    } else if (document.fullscreenElement === container) {
      await document.exitFullscreen();
    }
  }

  async function toggleFullscreen() {
    if (isFullscreen()) {
      await exitFullscreen();
      return;
    }
    if (document.fullscreenEnabled) {
      try {
        await container.requestFullscreen();
        return;
      } catch {
        // Use the full-viewport dialog if the browser blocks native fullscreen.
      }
    }
    fullscreenDialog.append(container);
    fullscreenDialog.showModal();
    updateFullscreenButton();
    fullscreenButton.focus({ preventScroll: true });
  }

  document.addEventListener('fullscreenchange', updateFullscreenButton);
  fullscreenDialog.addEventListener('cancel', event => {
    event.preventDefault();
    void exitFullscreen();
  });
  updateFullscreenButton();

  /** @param {Element | null | undefined} element @param {string} key */
  function labelControl(element, key) {
    const label = t(key);
    element?.setAttribute('title', label);
    element?.setAttribute('aria-label', label);
  }

  function translatePopupClose() {
    labelControl(container.querySelector('.leaflet-popup-close-button'), 'closePopup');
  }
  map.on('popupopen', translatePopupClose);

  function translate() {
    for (const entry of markers.values()) entry.translate();
    clusters.refreshClusters();
    const attribution = attributionHtml();
    for (const [layer, label] of /** @type {const} */ ([[street, 'streetMap'], [aerial, 'aerialMap']])) {
      layers.removeLayer(layer).addBaseLayer(layer, t(label));
      if (map.hasLayer(layer)) {
        const previous = layer.options.attribution;
        if (previous) map.attributionControl.removeAttribution(previous);
        map.attributionControl.addAttribution(attribution);
      }
      layer.options.attribution = attribution;
    }
    const zoom = zoomControl.getContainer();
    labelControl(zoom?.querySelector('.leaflet-control-zoom-in'), 'zoomIn');
    labelControl(zoom?.querySelector('.leaflet-control-zoom-out'), 'zoomOut');
    labelControl(fitButton, 'resetMap');
    updateFullscreenButton();
    translatePopupClose();
  }

  /** @param {string} key */
  function showSite(key) {
    const marker = markers.get(key)?.marker;
    if (!marker) return;
    // Leaflet ignores setView during an active zoom transition.
    if (zooming) {
      pendingSite = key;
      return;
    }
    pendingSite = null;
    map.closePopup();
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17), { animate: false });
    // A cluster animation can delay adding markers after a pan at the same zoom.
    if (!clusters.getVisibleParent(marker)) {
      pendingSite = key;
      return;
    }
    clusters.zoomToShowLayer(marker, () => marker.openPopup());
  }

  return {
    draw, fit, showSite, translate,
    getBounds: () => map.getBounds(),
    /** @param {() => void} callback */
    onViewChange: callback => { map.on('moveend', callback); },
    closePopup: () => map.closePopup()
  };
}
