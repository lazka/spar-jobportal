# Inoffizielles SPAR-Jobportal

The job portal is a static page in `frontend/`. From the repository root, start the local server with:

```sh
npm --prefix frontend run dev
```

Open <http://127.0.0.1:8000/>. The command uses Python 3 and needs no `npm install`. If you don't have npm, run `python3 -m http.server 8000 --bind 127.0.0.1 --directory frontend` instead. Use HTTP rather than opening `index.html` directly: the browser loads JavaScript modules and fetches `spar_jobs_final.json`.

For static hosting, publish `index.html`, `styles.css`, the JavaScript modules, `spar_jobs_final.json`, and the `fonts/` directory from `frontend/`. The npm tooling and tests are not needed on the host. i18next, Leaflet, basemap.at tiles, and Nominatim place search are loaded over the network.

To regenerate `frontend/spar_jobs_final.json`, run `python3 build_spar_jobs_final.py` from the repository root. The Python scripts and their intermediate data stay at the root.

## Frontend structure

See the [SPAR Careers style guide](STYLE_GUIDE.md) for visual and content guidance when creating new pages.

- `frontend/fonts/`: self-hosted [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro) (SIL Open Font License), used for both body text and headings.
- `frontend/index.html` and `frontend/styles.css`: page markup and styling.
- `frontend/app.js`: page state, event handlers, and coordination between the map and list.
- `frontend/i18n.js` and `frontend/translations.js`: German and English UI strings, category labels, and the saved language preference. Original SPAR job titles, addresses, and free-text details are not translated.
- `frontend/jobs.js`: loading, normalization, filtering, distance calculations, and site grouping.
- `frontend/job-list.js`: job cards and pagination.
- `frontend/map.js`: Leaflet layers, clustered markers, and popups.
- `frontend/place-search.js`: Nominatim requests, caching, and rate limiting.
- `frontend/dom.js`: shared DOM creation.

## Linting and tests

With Node.js 22.12 or newer, run these commands from the repository root:

```sh
cd frontend
npm ci
npm run lint
npm test
```

`npm run lint` runs Oxlint's type-aware rules and checks the JavaScript and tests against `frontend/tsconfig.json`. No code is compiled or emitted; there is no frontend build step.
