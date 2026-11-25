#!/usr/bin/env python3
"""Enrich SPAR job JSON with the detail-page Ort, once per organization unit.

Reads the flat JSON array produced by extract_spar_jobs.py. For each distinct
organizationUnitId, it fetches one representative public job-detail page and
reads the unit-level "Ort" field. Per-job fields such as start date and
employment extent are already present in the search API and are not copied
between jobs. Cached unit addresses are reused on later runs.
"""

from __future__ import annotations

import argparse
import gzip
import random
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup


USER_AGENT = "SPARJobsStatsBot/1.0 (+public-careers-statistics)"
DETAIL_URL = "https://jobs.spar.at/de_DE/SparCareers/job-detail/{job_id}"


def parse_job_detail(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    for item in soup.select(".custom-field"):
        title_element = item.select_one(".custom-field__title")
        value_element = item.select_one(".custom-field__value")
        title = title_element.get_text(" ", strip=True) if title_element else ""
        value = value_element.get_text(" ", strip=True) if value_element else ""
        if title.casefold() == "ort" and value:
            return " ".join(value.split())
    return None


def fetch_address(job_id: int | str, timeout: float, retries: int) -> str | None:
    url = DETAIL_URL.format(job_id=job_id)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
            "Accept-Encoding": "gzip",
        },
    )
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                if response.headers.get("Content-Encoding", "").lower() == "gzip":
                    body = gzip.decompress(body)
                charset = response.headers.get_content_charset() or "utf-8"
                html = body.decode(charset, "replace")
            return parse_job_detail(html)
        except urllib.error.HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code <= 599
            retry_after = error.headers.get("Retry-After")
            error.close()
            if not retryable or attempt == retries:
                raise
            try:
                delay = float(retry_after) if retry_after else 2**attempt
            except ValueError:
                delay = 2**attempt
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries:
                raise
            delay = 2**attempt
        time.sleep(min(delay + random.uniform(0, 0.4), 30))
    return None


def unit_key(job: dict[str, Any]) -> str | None:
    unit_id = job.get("organizationUnitId")
    if unit_id is not None:
        return str(unit_id)
    # Fallback for older flat exports that predate organizationUnitId.
    unit_name = job.get("organizationUnit")
    return f"name:{unit_name}" if unit_name else None


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=Path("spar_jobs_index.json"))
    parser.add_argument("-o", "--output", type=Path, default=Path("spar_jobs_enriched.json"))
    parser.add_argument("--cache", type=Path, default=Path("spar_unit_addresses.json"))
    parser.add_argument("--delay", type=float, default=0.6, help="Minimum seconds between page requests.")
    parser.add_argument("--timeout", type=float, default=25)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--max-units", type=int, help="Optional cap for a small test run.")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Fetch addresses again for every unit, including units already in the cache.",
    )
    args = parser.parse_args()
    if args.delay < 0 or args.timeout <= 0 or args.retries < 0:
        parser.error("--delay must be non-negative; --timeout positive; --retries non-negative.")
    if args.max_units is not None and args.max_units < 1:
        parser.error("--max-units must be at least 1.")

    try:
        jobs = json.loads(args.input.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        parser.error(str(error))
    if not isinstance(jobs, list):
        parser.error("Expected a top-level JSON array of job objects.")

    if args.cache.exists():
        try:
            cache = json.loads(args.cache.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            parser.error(f"Could not read address cache: {error}")
        if not isinstance(cache, dict):
            parser.error("Address cache must be a JSON object keyed by organizationUnitId.")
    else:
        cache = {}

    representatives: dict[str, dict[str, Any]] = {}
    reported_locations: dict[str, set[str]] = {}
    for job in jobs:
        if not isinstance(job, dict):
            continue
        key = unit_key(job)
        if key is not None:
            representatives.setdefault(key, job)
            location = job.get("location")
            if isinstance(location, str) and location.strip():
                reported_locations.setdefault(key, set()).add(location.strip())

    units_to_fetch = [
        key for key in representatives
        if args.refresh or not cache.get(key, {}).get("address")
    ]
    targets = units_to_fetch[: args.max_units] if args.max_units is not None else units_to_fetch
    errors = []
    last_request_at = 0.0
    for index, key in enumerate(targets, 1):
        pause = args.delay - (time.monotonic() - last_request_at)
        if pause > 0:
            time.sleep(pause)
        last_request_at = time.monotonic()
        representative = representatives[key]
        job_id = representative.get("id")
        try:
            address = fetch_address(job_id, args.timeout, args.retries)
            if address:
                cache[key] = {
                    "organizationUnit": representative.get("organizationUnit"),
                    "address": address,
                    "sourceJobId": job_id,
                    "reportedLocations": sorted(reported_locations.get(key, set())),
                    "fetchedAtUtc": datetime.now(timezone.utc).isoformat(),
                }
                print(f"[{index}/{len(targets)}] unit {key}: {address}", file=sys.stderr)
            else:
                errors.append({"unitId": key, "jobId": job_id, "error": "No Ort field found"})
                print(f"[{index}/{len(targets)}] unit {key}: no Ort field found", file=sys.stderr)
        except Exception as error:
            errors.append({"unitId": key, "jobId": job_id, "error": str(error)})
            print(f"[{index}/{len(targets)}] unit {key}: {error}", file=sys.stderr)

        # Persist after each unit so an interrupted run can resume from the cache.
        save_json(args.cache, cache)

    enriched = []
    for original in jobs:
        job = dict(original)
        key = unit_key(job)
        entry = cache.get(key, {}) if key is not None else {}
        job["workplaceAddress"] = entry.get("address")
        job["workplaceAddressSourceJobId"] = entry.get("sourceJobId")
        job["workplaceAddressReviewNeeded"] = len(reported_locations.get(key, set())) > 1 if key else False
        enriched.append(job)
    save_json(args.output, enriched)

    still_missing = sum(not cache.get(key, {}).get("address") for key in representatives)
    print(f"Wrote {len(enriched)} jobs to {args.output}.")
    print(f"Cached addresses: {len(representatives) - still_missing}/{len(representatives)} unique units.")
    print(
        f"Units with multiple free-text location values: "
        f"{sum(len(values) > 1 for values in reported_locations.values())}."
    )
    if errors:
        print(f"Lookups needing retry/review: {len(errors)} (details were printed above).")
    if args.max_units is not None and len(targets) < len(units_to_fetch):
        print("Test cap reached; rerun without --max-units to continue.")
    return 0 if still_missing == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
