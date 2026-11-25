import { node } from './dom.js';
import { t } from './i18n.js';

/** @import { Coordinates, Site } from './jobs.js' */
/** @import { Circle, LatLngBoundsLiteral, Marker } from 'leaflet' */

/** @type {LatLngBoundsLiteral} */
const austria = [[46.35, 9.48], [49.03, 17.2]];

/**
 * @param {HTMLElement} container
 * @param {(key: string) => void} onSelectSite
 */
export function createMap(container, onSelectSite) {
  const L = window.L;
  if (!L?.markerClusterGroup) {
    const notice = node('p', t('mapLoadError'));
    notice.dataset.i18n = 'mapLoadError';
    container.replaceChildren(notice);
    return null;
  }

  /**
   * @param {number} count
   * @param {number} size
   */
  const pin = (count, size, cluster = false) => {
    const label = node('span', String(count));
    return L.divIcon({ html: label, className: cluster ? 'pin cluster' : 'pin', iconSize: [size, size] });
  };

  container.replaceChildren();
  const map = L.map(container, { scrollWheelZoom: true, zoomControl: false, zoomSnap: 0, maxZoom: 19 }).fitBounds(austria);
  const zoomControl = L.control.zoom({ zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(map);
  const attributionHtml = () => `${t('attribution')} <a href="https://basemap.at/en/">basemap.at</a>`;
  const tileOptions = {
    attribution: attributionHtml(),
    maxZoom: 19
  };
  const street = L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png', tileOptions).addTo(map);
  const aerial = L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', tileOptions);
  const layers = L.control.layers({ [t('streetMap')]: street, [t('aerialMap')]: aerial }, undefined, { collapsed: false }).addTo(map);
  /** @type {WeakMap<Marker, number>} */
  const jobCounts = new WeakMap();
  const clusters = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: group => pin(group.getAllChildMarkers().reduce((sum, marker) => sum + (jobCounts.get(marker) ?? 0), 0), 44, true)
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
      const addresses = [...new Set(site.jobs.map(job => job.unit?.address).filter(Boolean))];
      const address = addresses.length === 1 ? addresses[0] : undefined;
      const marker = L.marker(site.pair, { icon: pin(count, 29) });
      jobCounts.set(marker, count);
      const popup = node('div');
      const heading = node('strong');
      popup.append(heading);
      if (address) {
        const addressLine = node('p', address);
        addressLine.lang = 'de-AT';
        popup.append(addressLine);
      }
      const button = node('button', '', 'button-primary');
      button.type = 'button';
      button.addEventListener('click', () => onSelectSite(key));
      popup.append(button);
      // Keep the close button clear of the layer switch on narrow maps.
      marker.bindPopup(popup, { autoPanPaddingTopLeft: [5, 70] });
      const translate = () => {
        marker.options.title = `${address || t('mapSite')}: ${t('jobCount', { count })}`;
        marker.getElement()?.setAttribute('title', marker.options.title);
        heading.textContent = t('jobsAtSite', { count });
        button.textContent = t('showJobsAtSite');
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

  const fitControl = new L.Control({ position: 'topleft' });
  const fitButton = node('button', '', 'map-fit');
  fitControl.onAdd = () => {
    const bar = node('div', '', 'leaflet-bar');
    fitButton.type = 'button';
    labelControl(fitButton, 'resetMap');

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
    arrows.setAttribute('d', 'm3 3 5 5m0-4v4H4m17-5-5 5m0-4v4h4M3 21l5-5m-4 0h4v4m13 1-5-5m0 4v-4h4');
    icon.append(arrows);
    fitButton.append(icon);

    fitButton.addEventListener('click', fit);
    bar.append(fitButton);
    L.DomEvent.disableClickPropagation(bar);
    return bar;
  };
  fitControl.addTo(map);

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
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 18), { animate: false });
    // A cluster animation can delay adding markers after a pan at the same zoom.
    if (!clusters.getVisibleParent(marker)) {
      pendingSite = key;
      return;
    }
    clusters.zoomToShowLayer(marker, () => marker.openPopup());
  }

  return { draw, fit, showSite, translate, closePopup: () => map.closePopup() };
}
