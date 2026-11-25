# Inoffizielles SPAR-Jobportal

The job portal is a static page in `frontend/`. From the repository root, start the local server with:

```sh
npm --prefix frontend run dev
```

Open <http://127.0.0.1:8000/>. The command uses Python 3 and needs no `npm install`. If you don't have npm, run `python3 -m http.server 8000 --bind 127.0.0.1 --directory frontend` instead. Use HTTP rather than opening `index.html` directly: the browser loads JavaScript modules and fetches `spar_jobs_final.json`.

For static hosting, publish `index.html`, `styles.css`, the JavaScript modules, `spar_jobs_final.json`, and the `fonts/` directory from `frontend/`. The npm tooling and tests are not needed on the host. i18next, Leaflet, basemap.at tiles, and Nominatim place search are loaded over the network. The QR library is loaded when a job is shared; the code itself is generated locally.

## Updating job data

Both commands use Python 3.10+ and the standard library. Run them from the repository root. Without uv, use `python3 update_spar_jobs.py` with the same subcommands.

```sh
uv run update-spar-jobs update
```

`update` fetches the current listings from SPAR's public jobs API and regenerates `frontend/spar_jobs_final.json` using only local location data. It doesn't fetch job detail pages or call Nominatim. Jobs for new units stay in the dataset with no coordinates. A failed or incomplete fetch leaves the previous dataset in place.

The JSON contains `jobs` and a UTC `lastUpdated` timestamp. The footer shows how long ago the dataset was written, with the exact Austrian local time on hover. It is not the update time of individual SPAR listings; maintenance also advances it when it changes the output.

```sh
uv run update-spar-jobs maintain
```

`maintain` uses the latest local job dataset and works only on units without coordinates. It tries the `Ort` field of a representative job's detail page when it has no cached address or correction. It does not use the job's free-text `Dienstort` as the site address. It caches Nominatim results (including misses), rejects area- and street-level results, prints unresolved unit IDs, and rebuilds the frontend JSON without refreshing the listings.

- See the [address corrections guide](docs/address-corrections.md) for how to investigate a missing or wrong pin, record a correction, and verify it.
- By default, maintenance makes up to 10 new Nominatim queries per run, spaced more than 15 seconds apart. It is intended for occasional maintenance, not as part of the job refresh.

The Python implementation lives in `spar_jobportal/`, and the caches are in `data/`. Superseded scripts, exports, and reports are available in Git history.

### Python development

Use [uv](https://docs.astral.sh/uv/) to install the development tools and run the checks from the repository root:

```sh
uv sync --locked
uv run --locked ruff check
uv run --locked ruff format --check
uv run --locked ty check
uv run --locked pytest
```

Pytest discovers tests in `tests/`. The updater has no runtime dependencies.

## Frontend structure

The [SPAR Careers style guide](docs/style-guide.md) is available for reference.

- `frontend/fonts/`: self-hosted [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro) (SIL Open Font License), used for both body text and headings.
- `frontend/index.html` and `frontend/styles.css`: page markup and styling.
- `frontend/app.js`: page state, event handlers, and coordination between the map and list.
- `frontend/i18n.js` and `frontend/translations.js`: German and English UI strings, category labels, and the saved language preference. Original SPAR job titles, addresses, and free-text details are not translated.
- `frontend/jobs.js`: loading, normalization, filtering, distance calculations, and site grouping.
- `frontend/job-list.js`: job cards and pagination.
- `frontend/job-share.js`: job posting links and QR codes.
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
