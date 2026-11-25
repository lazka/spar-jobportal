import { node, number } from './dom.js';

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
    container.replaceChildren(node('p', 'Die Karte konnte nicht geladen werden. Die Stellensuche funktioniert trotzdem.'));
    return null;
  }

  /**
   * @param {number} count
   * @param {number} size
   */
  const pin = (count, size, cluster = false) => {
    const label = node('span', number.format(count));
    return L.divIcon({ html: label, className: cluster ? 'pin cluster' : 'pin', iconSize: [size, size] });
  };

  container.replaceChildren();
  const map = L.map(container, { scrollWheelZoom: true, maxZoom: 19 }).fitBounds(austria);
  const tileOptions = {
    attribution: 'Datenquelle: <a href="https://basemap.at/en/">basemap.at</a>',
    maxZoom: 19
  };
  const street = L.tileLayer('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', tileOptions).addTo(map);
  const aerial = L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', tileOptions);
  L.control.layers({ 'Karte': street, 'Luftbild': aerial }, undefined, { collapsed: false }).addTo(map);
  /** @type {WeakMap<Marker, number>} */
  const jobCounts = new WeakMap();
  const clusters = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: group => pin(group.getAllChildMarkers().reduce((sum, marker) => sum + (jobCounts.get(marker) ?? 0), 0), 44, true)
  }).addTo(map);

  /** @type {Map<string, Marker>} */
  const markers = new Map();
  /** @type {Circle | null} */
  let radiusLayer = null;

  /**
   * @param {Map<string, Site>} sites
   * @param {Coordinates | undefined} center
   * @param {number} radiusKm
   */
  function draw(sites, center, radiusKm) {
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
      const label = `${address || 'Standort'}: ${count} ${count === 1 ? 'Stelle' : 'Stellen'}`;
      const marker = L.marker(site.pair, { title: label, icon: pin(count, 29) });
      jobCounts.set(marker, count);
      const popup = node('div');
      popup.append(node('strong', `${number.format(count)} ${count === 1 ? 'Stelle' : 'Stellen'} an diesem Standort`));
      if (address) popup.append(node('p', address));
      const button = node('button', 'Stellen am Standort anzeigen', 'button-primary');
      button.type = 'button';
      button.addEventListener('click', () => onSelectSite(key));
      popup.append(button);
      marker.bindPopup(popup);
      markers.set(key, marker);
    }
    clusters.addLayers([...markers.values()]);
  }

  function fit() {
    const bounds = radiusLayer ? radiusLayer.getBounds() : clusters.getBounds();
    map.fitBounds(bounds.isValid() ? bounds : austria, { padding: [30, 30], maxZoom: 12 });
  }

  const fitControl = new L.Control({ position: 'topleft' });
  fitControl.onAdd = () => {
    const bar = node('div', '', 'leaflet-bar');
    const button = node('button', '', 'map-fit');
    button.type = 'button';
    button.title = 'Kartenausschnitt zurücksetzen';
    button.setAttribute('aria-label', button.title);

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
    button.append(icon);

    button.addEventListener('click', fit);
    bar.append(button);
    L.DomEvent.disableClickPropagation(bar);
    return bar;
  };
  fitControl.addTo(map);

  /** @param {string} key */
  function showSite(key) {
    const marker = markers.get(key);
    if (marker) clusters.zoomToShowLayer(marker, () => marker.openPopup());
  }

  return { draw, fit, showSite, closePopup: () => map.closePopup() };
}
