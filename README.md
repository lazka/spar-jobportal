# SPAR Jobkarte

The job portal is a static page. From the repository root, run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Use HTTP rather than opening `index.html` directly: the browser loads JavaScript modules and fetches `spar_jobs_final.json`. Static hosting needs `index.html`, `frontend/`, and that generated JSON file in the same relative layout. Leaflet, basemap.at tiles, and Nominatim place search are loaded over the network.

## Frontend structure

- `index.html` and `frontend/styles.css`: page markup and styling.
- `frontend/app.js`: page state, event handlers, and coordination between the map and list.
- `frontend/jobs.js`: loading, normalization, filtering, distance calculations, and site grouping.
- `frontend/job-list.js`: job cards and pagination.
- `frontend/map.js`: Leaflet layers, clustered markers, and popups.
- `frontend/place-search.js`: Nominatim requests, caching, and rate limiting.
- `frontend/dom.js`: shared DOM creation and number formatting.

## Linting and tests

With Node.js 22.12 or newer, install the development tools and run the checks:

```sh
npm ci
npm run lint
npm test
```

Node.js is only needed for linting and tests; there is no frontend build step.
