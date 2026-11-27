# Inoffizielles SPAR-Jobportal

See the [frontend README](frontend/README.md) to run, develop, or deploy the portal.

## Updating job data

Both commands use Python 3.10+ and the standard library. Run them from the repository root. Without uv, use `python3 update_spar_jobs.py` with the same subcommands.

```sh
uv run update-spar-jobs update
```

`update` saves the SPAR mobile v8 shop catalogue to `data/spar_shops.json`, then fetches the current listings from SPAR's public jobs API and regenerates `frontend/spar_jobs_final.json` using local location data. If the jobs API repeats a job ID, `update` restarts pagination once. A failed or incomplete jobs fetch leaves the previous frontend snapshot in place, even if the catalogue was refreshed. It doesn't fetch job detail pages or call Nominatim. Jobs for new units stay in the dataset with no coordinates. `maintain` does not rewrite `data/spar_shops.json`.

The JSON contains `jobs` and a UTC `lastUpdated` timestamp. The timestamp records when the snapshot was written, not when individual SPAR listings changed. Maintenance also advances it when it changes the output.

```sh
uv run update-spar-jobs maintain
```

`maintain` uses the latest local job dataset and works only on units without coordinates. It tries the `Ort` field of a representative job's detail page when it has no cached address or correction. It does not use the job's free-text `Dienstort` as the site address. It caches Nominatim results (including misses), rejects area- and street-level results, prints unresolved unit IDs, and rebuilds the frontend JSON without refreshing the listings.

When caching a new site address in `data/spar_unit_details.json`, maintenance also stores the listing's unit `name` when available. It derives `orgType` from the source listing's displayed job ID, if present, by removing the leading `ID` and trailing number (for example, `INTERSPAR` from `ID INTERSPAR 7905`). Existing entries are not refetched.

- See the [address corrections guide](docs/address-corrections.md) for how to investigate a missing or wrong pin, record a correction, and verify it.
- By default, maintenance makes up to 10 new Nominatim queries per run, spaced more than 15 seconds apart. It is intended for occasional maintenance, not as part of the job refresh.

The Python implementation lives in `spar_jobportal/`, and the caches are in `data/`. Superseded scripts, exports, and reports are available in Git history.

Both commands log HTTP failures to stderr with the request path and status. Add `--verbose` after `update` or `maintain` to also log each attempt, successful responses, and retry waits. Logs omit query strings, request headers, and response bodies.

### Mapping jobs to shops

[`spar_jobportal.shops.map_unit`](spar_jobportal/shops.py) first separates the unit code from the place name, then decodes the branch number. It joins the [SPAR app shop catalogue](docs/address-corrections.md#spar-shops-api) on `bnr`, without comparing addresses. The helper itself does not fetch data or change the job dataset.

In the final JSON, `unit.relatedShop` contains the catalogue `bnr` and original `shopType` string, or is `null` when there is no match. Online maintenance also fetches the catalogue. Offline maintenance (`--max-requests 0`) keeps the existing `relatedShop`.

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

## License

The project's original code is licensed under the [MIT License](LICENSE). This does not grant rights to SPAR's job listings or branding. Bundled [libraries](frontend/vendor/) and [fonts](frontend/fonts/) retain their own licenses.
