import { node, number } from './dom.js';

const austria = [[46.35, 9.48], [49.03, 17.2]];

export function createMap(container, onSelectSite) {
  const L = window.L;
  if (!L?.markerClusterGroup) {
    container.replaceChildren(node('p', 'Die Karte konnte nicht geladen werden. Die Stellensuche funktioniert trotzdem.'));
    return null;
  }

  function pin(count, size, cluster = false) {
    const label = node('span', number.format(count));
    return L.divIcon({ html: label, className: cluster ? 'pin cluster' : 'pin', iconSize: [size, size] });
  }

  container.replaceChildren();
  const map = L.map(container, { scrollWheelZoom: true, maxZoom: 19 }).fitBounds(austria);
  const tileOptions = {
    attribution: 'Datenquelle: <a href="https://basemap.at/en/">basemap.at</a>',
    maxZoom: 19
  };
  const street = L.tileLayer('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', tileOptions).addTo(map);
  const aerial = L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', tileOptions);
  L.control.layers({ 'Karte': street, 'Luftbild': aerial }, null, { collapsed: false }).addTo(map);
  const clusters = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: group => pin(group.getAllChildMarkers().reduce((sum, marker) => sum + marker.options.jobCount, 0), 44, true)
  }).addTo(map);

  const markers = new Map();
  let radiusLayer;

  function draw(sites, center, radiusKm) {
    map.closePopup();
    clusters.clearLayers();
    radiusLayer?.remove();
    radiusLayer = center ? L.circle(center, {
      radius: radiusKm * 1000, color: '#006a50', fillOpacity: .08, weight: 2, interactive: false
    }).addTo(map) : null;
    markers.clear();
    for (const [key, site] of sites) {
      const count = site.jobs.length;
      const addresses = [...new Set(site.jobs.map(job => job.unit?.address).filter(Boolean))];
      const label = `${addresses.length === 1 ? addresses[0] : 'Standort'}: ${count} ${count === 1 ? 'Stelle' : 'Stellen'}`;
      const marker = L.marker(site.pair, { title: label, icon: pin(count, 29), jobCount: count });
      const popup = node('div');
      popup.append(node('strong', `${number.format(count)} ${count === 1 ? 'Stelle' : 'Stellen'} an diesem Standort`));
      if (addresses.length === 1) popup.append(node('p', addresses[0]));
      const button = node('button', 'Stellen am Standort anzeigen');
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

  function showSite(key) {
    const marker = markers.get(key);
    if (marker) clusters.zoomToShowLayer(marker, () => marker.openPopup());
  }

  return { draw, fit, showSite, closePopup: () => map.closePopup() };
}
