# SPAR job portal frontend

The portal is a static bilingual site. There is no frontend build step.

## Run locally

From `frontend/`, run either command:

```sh
npm run dev
# Or, without npm:
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/>. Both commands use Python 3 and neither needs `npm install`. Serve the site over HTTP rather than opening `index.html` directly: the browser loads JavaScript modules and fetches `spar_jobs_final.json`.

## Static hosting

Publish `index.html`, `favicon.svg`, `styles.css`, the top-level JavaScript modules, `spar_jobs_final.json`, and the `fonts/` and `vendor/` directories. Include the [root `LICENSE`](../LICENSE) alongside them. No npm install is needed on the host. All JavaScript, CSS, fonts, and library images are served from the same origin. The site still uses basemap.at map tiles and sends place searches to Nominatim. The QR library is loaded locally when the share dialog opens.

The job snapshot is generated separately; see [Updating job data](../README.md#updating-job-data). The footer shows how long ago the snapshot was written, with the exact Austrian local time on hover.

### GitHub Pages

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The [GitHub Pages workflow](../.github/workflows/pages.yml) refreshes the jobs every six hours (at 00:17, 06:17, 12:17, and 18:17 UTC), on pushes to `main`, or when run manually from **Actions** on `main`. It deploys the refreshed snapshot as part of the Pages artifact without committing it back to the repository.

Pull requests package the checked-in snapshot without contacting SPAR or deploying. Production runs use `update`, not location maintenance. If refreshing the snapshot fails, the workflow stops before deployment and the currently published site stays online.

## Source layout

- `index.html` and `styles.css`: markup and styling. See the [SPAR Careers style guide](../docs/style-guide.md).
- `app.js` and `dom.js`: UI state, event handling, and shared DOM helpers.
- `i18n.js` and `translations.js`: German and English UI strings and the saved language preference. Original SPAR job titles, addresses, and free-text details are not translated.
- `jobs.js` and `job-list.js`: dataset loading, filtering, distances, job cards, and pagination.
- `map.js` and `place-search.js`: map layers, clusters, popups, and Nominatim search.
- `job-share.js`: copyable official posting links and QR codes.
- `fonts/`: self-hosted [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro), under the SIL Open Font License.

## Development checks

From `frontend/`, with Node.js 22.12 or newer:

```sh
npm ci
npm run lint
npm test
npm run vendor:check
```

Oxlint checks the JavaScript and tests using `tsconfig.json` without emitting any files. `vendor:check` verifies that the checked-in browser assets match the installed packages.

## Updating browser libraries

`vendor/` contains the browser files and licenses for Leaflet, Leaflet.markercluster, i18next, and uqr. After updating a pinned dependency in `package.json` and `package-lock.json`, run `npm run vendor` to refresh the checked-in assets. Keep any new asset paths in sync with `index.html` and remove obsolete files from `vendor/`.
