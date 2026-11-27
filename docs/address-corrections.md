# Correcting job map locations

Corrections in [`data/spar_address_corrections.json`](../data/spar_address_corrections.json) apply to every listing for the same SPAR organization unit. Correct the **unit's site**, not the free-text **Dienstort**: a job can cover several branches or a whole region even when its unit has a single address.

## 1. Find the unit and the problem

From the repository root, run:

```sh
uv run update-spar-jobs maintain --max-requests 0
```

This prints unresolved units without making network requests. It can still rebuild the snapshot if there are unapplied local changes. The number before the unit name is the **unit ID**, not the job ID. For a pin that already exists but looks wrong, find the listing in [`frontend/spar_jobs_final.json`](../frontend/spar_jobs_final.json) and use its `unit.id` and `unit.address`; the unresolved report won't list it.

- `not_found`: Nominatim found nothing for the cached query. Check the spelling, house number, postcode, and locality.
- `not_specific`: Nominatim returned results but none passed the site-level check. Don't use a street, postcode, or town center as a substitute.
- `site address lookup deferred` or `Nominatim lookup deferred`: The offline run skipped a lookup; this isn't a failed match. Run `uv run update-spar-jobs maintain` if you want it to make those requests.

## 2. Verify the site

1. Open the official listing using its `detailUrl`. Look for **Ort** (the site address), not **Dienstort**. If the listing has expired, check the unit name and the cached address in [`data/spar_unit_addresses.json`](../data/spar_unit_addresses.json).
2. Cross-check the name and full address against the [SPAR store directory](https://www.spar.at/standorte) or the site operator's own website. For a shopping center or regional office, verify that facility rather than picking the nearest SPAR store.
3. For coordinates, find the matching business or building on a map. Check the house number, postcode, and which side of the street the point is on. Save the exact source link. If you can verify only a whole building, use a point in that building and say so in the note; don't claim it's a particular entrance or office. If you can't verify the site, leave the pin missing rather than guessing.

### SPAR shops API

The [SPAR Austria app's public shops endpoint](https://api-scp.spar-ics.com/mobile/b2c/apps/spar/v1/spar-app-at/v8/public/shops) returns the shop catalogue as JSON. In the top-level `shop` array, match `name` and the full address (`location.address`, `location.post`, `location.city`). The coordinates are `location.geo.lat` and `location.geo.lon`. For example, shop `1277` is SPAR Lech at Omesberg 211, 6764 Lech. The catalogue's `id` and `bnr` identify the **shop**, not the jobs **unit**; keep using `unit.id` as the correction key.

The updater uses this endpoint for shop types, not coordinates. If you manually use its coordinates, cite the endpoint and shop ID in `source`.

## 3. Add the correction

Add or update the entry keyed by the unit ID in [`data/spar_address_corrections.json`](../data/spar_address_corrections.json). Use one of these approaches:

**Better lookup query.** Use `address` for a verified spelling or a more specific search term when the geocoder can find the site. It changes the lookup query, not an existing source address shown in the portal. Example:

```json
{
  "161251": {
    "address": "Abelstraße 8, 4082 Aschach an der Donau",
    "note": "SPAR's official store page confirms the address."
  }
}
```

**Verified coordinates.** Use `latitude` and `longitude` as numbers (in that order on most map displays). This bypasses the geocoder. `source` is required; include the provider and a link to the exact feature. Add `address` only if you also want to override the displayed address. Example:

```json
{
  "150723": {
    "latitude": 47.2069765,
    "longitude": 10.1402867,
    "source": "© OpenStreetMap contributors: https://www.openstreetmap.org/node/505819935",
    "note": "Mapped SPAR supermarket at Omesberg 211, 6764 Lech. Address confirmed by SPAR's official store page."
  }
}
```

Use the examples as individual entries, not replacements for the whole file. `note` is optional, but helps reviewers understand why a correction is justified.

## 4. Apply and check

- Run `uv run update-spar-jobs maintain --max-requests 0` for coordinate overrides or queries already in the cache. For a new query, run `uv run update-spar-jobs maintain` instead. Cached misses won't be retried with the same query; use a different verified query or verified coordinates.
- Check that the unit is no longer reported as unresolved and that the expected `unit.coordinates` appear in `frontend/spar_jobs_final.json`. For a pin that was already present, check that the point changed to the intended location. Open the portal locally and confirm the pin lands on the verified site.
- Review the diff before committing. Keep the correction, any changes to the active caches made by maintenance, and the regenerated snapshot together. Don't hand-edit the generated snapshot or turn a cached miss into a match.
