# Inoffizielles SPAR-Jobportal

See the [frontend README](frontend/README.md) to run, develop, or deploy the portal.

## Updating job data

Both commands use Python 3.10+ and the standard library. Run them from the repository root. Without uv, use `python3 update_spar_jobs.py` with the same subcommands.

```sh
uv run update-spar-jobs update
```

`update` fetches the current listings from SPAR's public jobs API and regenerates `frontend/spar_jobs_final.json` using only local location data. It doesn't fetch job detail pages or call Nominatim. Jobs for new units stay in the dataset with no coordinates. A failed or incomplete fetch leaves the previous dataset in place.

The JSON contains `jobs` and a UTC `lastUpdated` timestamp. The timestamp records when the snapshot was written, not when individual SPAR listings changed. Maintenance also advances it when it changes the output.

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
