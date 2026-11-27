"""Refresh the SPAR jobs dataset or maintain its organization-unit locations."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import urllib.error
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .http_client import PoliteOpener
from .locations import coordinates, geocode, geocode_key, load_corrections, resolve_unit, unit_query
from .shops import fetch_shops, map_unit
from .spar import RepeatedJobError, fetch_jobs, fetch_site_details
from .storage import as_object, read_object, save_json

ROOT = Path(__file__).resolve().parents[1]
ADDRESSES = ROOT / "data/spar_unit_addresses.json"
CORRECTIONS = ROOT / "data/spar_address_corrections.json"
GEOCODES = ROOT / "data/spar_nominatim_cache.json"
SHOPS_CACHE = ROOT / "data/spar_shops.json"
OUTPUT = ROOT / "frontend/spar_jobs_final.json"
LOGGER = logging.getLogger(__name__)


def write_jobs(
    jobs: list[dict[str, Any]],
    addresses: dict[str, Any],
    corrections: dict[str, Any],
    geocodes: dict[str, Any],
    *,
    shops: dict[str, dict[str, Any]] | None = None,
    force: bool = True,
) -> None:
    changed = False
    by_bnr = shops if shops is not None else {}
    for job in jobs:
        previous = job["unit"]
        unit = resolve_unit(previous, addresses, corrections, geocodes)
        mapped = map_unit(unit, by_bnr)
        related_shop = None
        if shops is None:
            related_shop = previous.get("relatedShop")
        elif mapped["bnr"] is not None:
            related_shop = {"bnr": mapped["bnr"], "shopType": mapped["shopTypeName"]}
        unit["relatedShop"] = related_shop
        changed |= unit != previous
        job["unit"] = unit
    if changed or force:
        save_json(
            OUTPUT,
            {"lastUpdated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "jobs": jobs},
        )
    unmapped = sum(job["unit"]["coordinates"] is None for job in jobs)
    label = "Updated" if changed or force else "Unchanged:"
    print(f"{label} {OUTPUT.relative_to(ROOT)}: {len(jobs)} jobs ({unmapped} without coordinates).")


def maintain(
    jobs: list[dict[str, Any]],
    addresses: dict[str, Any],
    corrections: dict[str, Any],
    geocodes: dict[str, Any],
    limit: int,
    *,
    migrate: bool = False,
) -> None:
    representatives: dict[str, dict[str, Any]] = {}
    for job in jobs:
        unit_id = job["unit"].get("id")
        if unit_id is not None:
            representatives.setdefault(str(unit_id), job)

    spar = PoliteOpener(delay=0.6, timeout=25, retries=2)
    shops = fetch_shops(spar) if limit > 0 else None
    # The public service limits regularly run scripts to four requests per minute.
    nominatim = PoliteOpener(delay=15.1, timeout=25, retries=0)
    detail_count = lookup_count = 0
    unresolved = 0
    for key, job in representatives.items():
        unit = job["unit"]
        if resolve_unit(unit, addresses, corrections, geocodes)["coordinates"] is not None:
            continue
        entry = as_object(addresses.get(key))
        correction = corrections.get(key)
        query = unit_query(entry, correction)
        status = "missing site address"
        if not query:
            if limit > 0:
                detail_count += 1
                try:
                    details = fetch_site_details(spar, job["id"])
                except urllib.error.HTTPError as error:
                    if error.code not in (404, 410):
                        raise
                    details = None  # The job may have expired since the snapshot.
                if details and details.address:
                    address_entry = {"address": details.address}
                    if details.unit_type is not None:
                        address_entry["unitType"] = details.unit_type
                    addresses[key] = address_entry
                    save_json(ADDRESSES, addresses)
                    query = details.address
            else:
                status = "site address lookup deferred"
        if query:
            query_key = geocode_key(query)
            if query_key not in geocodes and lookup_count < limit:
                lookup_count += 1
                geocodes[query_key] = geocode(nominatim, query)
                save_json(GEOCODES, geocodes)
            cached = as_object(geocodes.get(query_key))
            if cached.get("status") == "matched" and coordinates(cached) is not None:
                continue
            status = cached.get("status", "Nominatim lookup deferred")
        unresolved += 1
        print(
            f"  {key} ({unit.get('name') or 'unnamed'}): {status}"
            + (f" — {query}" if query else "")
        )

    print(
        f"Site detail requests: {detail_count}; Nominatim lookups: {lookup_count}; unresolved units: {unresolved}."
    )
    if unresolved:
        print(
            f"Add verified corrections in {CORRECTIONS.relative_to(ROOT)}, or rerun to process deferred lookups."
        )
    write_jobs(jobs, addresses, corrections, geocodes, shops=shops, force=migrate)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    update = commands.add_parser(
        "update", help="Fetch SPAR jobs and rebuild the frontend dataset using local location data."
    )
    maintenance = commands.add_parser(
        "maintain", help="Look up missing unit locations for the current dataset."
    )
    for command in (update, maintenance):
        command.add_argument(
            "--verbose", "-v", action="store_true", help="Log all HTTP requests to stderr."
        )
    maintenance.add_argument(
        "--max-requests",
        type=int,
        default=10,
        help="Maximum number of new Nominatim queries (default: 10; 0 skips all network requests).",
    )
    args = parser.parse_args(argv)
    if args.command == "maintain" and args.max_requests < 0:
        parser.error("--max-requests must be non-negative.")
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s: %(message)s"
    )

    try:
        addresses = read_object(ADDRESSES)
        corrections = load_corrections(CORRECTIONS)
        geocodes = read_object(GEOCODES)
        if args.command == "update":
            spar = PoliteOpener(delay=0.4, timeout=30, retries=3)
            shops = fetch_shops(spar)
            save_json(SHOPS_CACHE, {"shop": list(shops.values())})
            print(f"Updated {SHOPS_CACHE.relative_to(ROOT)}: {len(shops)} shops.")
            try:
                jobs = fetch_jobs(spar)
            except RepeatedJobError as error:
                LOGGER.warning("%s Restarting the jobs fetch once.", error)
                jobs = fetch_jobs(spar)
            write_jobs(jobs, addresses, corrections, geocodes, shops=shops)
        else:
            dataset = json.loads(OUTPUT.read_text(encoding="utf-8"))
            legacy = isinstance(dataset, list)
            jobs = dataset if legacy else as_object(dataset).get("jobs")
            if not isinstance(jobs, list) or not all(
                isinstance(job, dict) and "id" in job and isinstance(job.get("unit"), dict)
                for job in jobs
            ):
                raise ValueError(
                    "Expected a frontend job dataset with a unit object per job. Run update first."
                )
            maintain(jobs, addresses, corrections, geocodes, args.max_requests, migrate=legacy)
    except (OSError, RuntimeError, ValueError, KeyError, TypeError) as error:
        print(f"{args.command}: {error}", file=sys.stderr)
        return 1
    return 0
