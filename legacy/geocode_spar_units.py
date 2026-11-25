#!/usr/bin/env python3
"""Resolve SPAR unit locations with Nominatim and optional manual corrections.

This is forward geocoding (address -> coordinates). Requests are single-threaded,
spaced at least 1.1 seconds apart, and cached by normalized address so repeated
addresses do not generate duplicate Nominatim requests. A correction can replace
the query or supply a verified coordinate pair with an explicit source.
Listing-reported locations are never used as fallbacks.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "spar-jobportal-unit-geocoder/1.0"
ATTRIBUTION = "© OpenStreetMap contributors"
BROAD_CATEGORIES = {"boundary", "highway", "place", "postcode"}
NAMED_LOCATION_CATEGORIES = {
    "aeroway",
    "amenity",
    "building",
    "craft",
    "education",
    "emergency",
    "healthcare",
    "historic",
    "leisure",
    "man_made",
    "office",
    "public_transport",
    "railway",
    "shop",
    "tourism",
}


def normalized_query(address: str) -> str:
    return " ".join(address.split()).casefold()


def coordinate_override(unit_id: str, correction: Any) -> dict[str, Any] | None:
    if not isinstance(correction, dict) or not {"latitude", "longitude"}.intersection(correction):
        return None
    label = f"Correction for unit {unit_id}"
    if "address" in correction:
        raise ValueError(f"{label} cannot combine query text and coordinates.")
    for name, limit in (("latitude", 90), ("longitude", 180)):
        value = correction.get(name)
        if type(value) not in (int, float) or not -limit <= value <= limit:
            raise ValueError(f"{label} must provide numeric {name} between {-limit} and {limit}.")
    source = correction.get("source")
    if not isinstance(source, str) or not source.strip():
        raise ValueError(f"{label} must provide a coordinate source.")
    return {
        "status": "matched",
        "provider": source.strip(),
        "latitude": correction["latitude"],
        "longitude": correction["longitude"],
        "precision": "manual_coordinates",
        "query": None,
        "querySource": "coordinate_override",
        "note": correction.get("note"),
    }


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return data


def result_precision(result: dict[str, Any]) -> str | None:
    """Return a precision label only for an address or named, specific feature."""
    address = result.get("address")
    address = address if isinstance(address, dict) else {}
    category = result.get("category") or result.get("class")

    # Some Austrian house numbers are attached to a locality, not a road.
    if category == "place" and result.get("type") == "house" and address.get("house_number"):
        return "address"
    if category in BROAD_CATEGORIES:
        return None

    if address.get("house_number") and (
        address.get("road")
        or address.get("street")
        or category == "building"
    ):
        return "address"
    if category not in NAMED_LOCATION_CATEGORIES:
        return None

    # Nominatim commonly exposes a POI name either as `name` or as an
    # address component named after its category (for example `shop: Eurospar`).
    if result.get("name") or address.get(str(category)):
        return "named_feature"
    return None


def validate_cached_result(result: dict[str, Any]) -> dict[str, Any]:
    """Reject old cached 'matches' that resolve only to a road or area."""
    if result.get("status") != "matched":
        return result
    precision = result_precision(result)
    if precision:
        return {**result, "precision": result.get("precision", precision)}

    rejected = {
        key: value
        for key, value in result.items()
        if key not in {"latitude", "longitude"}
    }
    rejected["status"] = "not_specific"
    rejected["reason"] = "Nominatim result identifies an area or road, not a specific location."
    return rejected


def needs_numbered_house_retry(result: dict[str, Any]) -> bool:
    # Old rejections retain the candidate type but not its coordinates.
    return result.get("status") == "not_specific" and any(
        candidate.get("category") == "place" and candidate.get("type") == "house"
        for candidate in result.get("candidates", [])
    ) and not result.get("numberedHouseChecked")


def request_nominatim(address: str, timeout: float, retries: int) -> dict[str, Any]:
    params = urllib.parse.urlencode({
        "q": address,
        "format": "jsonv2",
        "addressdetails": "1",
        "limit": "5",
        "countrycodes": "at",
    })
    request = urllib.request.Request(
        f"{NOMINATIM_SEARCH}?{params}",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
        },
    )

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                results = json.loads(response.read().decode("utf-8"))
            if not isinstance(results, list):
                raise ValueError("Unexpected response from Nominatim.")
            if not results:
                return {
                    "status": "not_found",
                    "query": address,
                    "provider": "Nominatim",
                    "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
                    "attribution": ATTRIBUTION,
                }

            result = next(
                (candidate for candidate in results if result_precision(candidate)),
                None,
            )
            if result is None:
                candidate_summaries = [
                    {
                        "displayName": candidate.get("display_name"),
                        "category": candidate.get("category"),
                        "type": candidate.get("type"),
                    }
                    for candidate in results[:5]
                ]
                return {
                    "status": "not_specific",
                    "query": address,
                    "provider": "Nominatim",
                    "reason": "Nominatim returned only area-, postcode-, or road-level results.",
                    "candidates": candidate_summaries,
                    "numberedHouseChecked": True,
                    "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
                    "attribution": ATTRIBUTION,
                }

            return {
                "status": "matched",
                "query": address,
                "provider": "Nominatim",
                "latitude": float(result["lat"]),
                "longitude": float(result["lon"]),
                "precision": result_precision(result),
                "displayName": result.get("display_name"),
                "osmType": result.get("osm_type"),
                "osmId": result.get("osm_id"),
                "category": result.get("category"),
                "type": result.get("type"),
                "address": result.get("address", {}),
                "license": result.get("licence"),
                "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
                "attribution": ATTRIBUTION,
            }
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
        # Keep even retries below Nominatim's one-request-per-second ceiling.
        time.sleep(min(max(delay, 1.1) + random.uniform(0, 0.4), 30))

    raise RuntimeError("Nominatim retries exhausted.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input",
        nargs="?",
        type=Path,
        default=Path("spar_unit_addresses.json"),
        help="Unit-address map produced by enrich_spar_job_locations.py.",
    )
    parser.add_argument("--cache", type=Path, default=Path("spar_nominatim_cache.json"))
    parser.add_argument("--output", type=Path, default=Path("spar_unit_locations.json"),
                        help="Output map of unit IDs to coordinate pairs; unresolved units are omitted.")
    parser.add_argument("--report", type=Path,
                        help="Detailed unit report; defaults to the output filename with _report before its extension.")
    parser.add_argument(
        "--corrections",
        type=Path,
        default=Path("spar_address_corrections.json"),
        help="Optional organizationUnitId map of Nominatim queries or sourced coordinate overrides.",
    )
    parser.add_argument("--delay", type=float, default=1.1, help="Seconds between uncached requests (minimum 1.0).")
    parser.add_argument("--timeout", type=float, default=25)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--max-requests", type=int, help="Cap on uncached lookups; 0 uses only the cache.")
    parser.add_argument("--refresh", action="store_true", help="Re-geocode addresses even if already cached.")
    args = parser.parse_args()
    report_path = args.report or args.output.with_name(f"{args.output.stem}_report{args.output.suffix}")
    paths = (args.input, args.output, report_path, args.cache, args.corrections)
    if len({path.resolve() for path in paths}) != len(paths):
        parser.error("Input, output, report, cache, and corrections must be separate files.")

    if args.delay < 1.0:
        parser.error("--delay must be at least 1 second to respect Nominatim's public-service limit.")
    if args.timeout <= 0 or args.retries < 0:
        parser.error("--timeout must be positive and --retries non-negative.")
    if args.max_requests is not None and args.max_requests < 0:
        parser.error("--max-requests must be non-negative.")

    try:
        units = read_json_object(args.input)
        cache = read_json_object(args.cache)
        corrections = read_json_object(args.corrections)
        overrides = {}
        for unit_id, correction in corrections.items():
            override = coordinate_override(unit_id, correction)
            if override is not None:
                overrides[unit_id] = override
                continue
            query = correction.get("address") if isinstance(correction, dict) else correction
            if not isinstance(query, str) or not query.strip():
                raise ValueError(f"Correction for unit {unit_id} must provide nonempty query text.")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))

    last_request_at = 0.0
    request_count = 0
    failed = 0
    queried_this_run: dict[str, dict[str, Any]] = {}
    report: dict[str, Any] = {}

    # Verified corrections can also supply locations absent from the address cache.
    for unit_id in dict.fromkeys([*units, *corrections]):
        unit = units.get(unit_id, {})
        requested = False
        valid_unit = isinstance(unit, dict)
        unit = unit if valid_unit else {}
        if valid_unit and unit_id in overrides:
            report[unit_id] = {
                **unit,
                "geocodingQuery": None,
                "addressCorrection": {"applied": False},
                "geocoding": overrides[unit_id],
            }
            continue
        correction = corrections.get(unit_id)
        query = correction.get("address") if isinstance(correction, dict) else correction
        address = query if query is not None else unit.get("address")
        address = " ".join(address.split()) if isinstance(address, str) else ""
        geocoding = {"status": "not_processed", "provider": "Nominatim", "attribution": ATTRIBUTION}
        if not valid_unit:
            geocoding["status"] = "invalid_unit"
        elif not address:
            geocoding["status"] = "missing_address"
        else:
            key = normalized_query(address)
            existing = cache.get(key)
            can_request = args.max_requests is None or request_count < args.max_requests
            if key in queried_this_run:
                geocoding = queried_this_run[key]
            elif not args.refresh and isinstance(existing, dict) and (
                not can_request or not needs_numbered_house_retry(existing)
            ):
                geocoding = cache[key] = validate_cached_result(existing)
            elif can_request:
                pause = args.delay - (time.monotonic() - last_request_at)
                if pause > 0:
                    time.sleep(pause)
                request_count += 1
                requested = True
                try:
                    geocoding = request_nominatim(address, args.timeout, args.retries)
                except Exception as error:
                    failed += 1
                    geocoding["status"] = "error"
                    geocoding["error"] = str(error)
                finally:
                    last_request_at = time.monotonic()
                queried_this_run[key] = geocoding
                if geocoding["status"] != "error":
                    cache[key] = geocoding
                    save_json(args.cache, cache)
                print(f"[{request_count}] {unit_id}: {address} [{geocoding['status']}]", file=sys.stderr)

        report[unit_id] = {
            **unit,
            "geocodingQuery": address or None,
            "addressCorrection": (
                {
                    "applied": True,
                    "address": address,
                    "note": correction.get("note") if isinstance(correction, dict) else None,
                }
                if query is not None
                else {"applied": False}
            ),
            "geocoding": {
                **geocoding,
                "query": address or None,
                "querySource": "correction" if query is not None else "unit_address",
            },
        }
        if requested:
            save_json(report_path, report)

    save_json(args.cache, cache)
    save_json(report_path, report)
    unresolved = []
    coordinates = {}
    for unit_id, result in report.items():
        geocoding = result["geocoding"]
        status = geocoding["status"]
        latitude, longitude = geocoding.get("latitude"), geocoding.get("longitude")
        if status == "matched" and latitude is not None and longitude is not None:
            coordinates[unit_id] = {"latitude": latitude, "longitude": longitude}
        else:
            unresolved.append({
                "unitId": str(unit_id),
                "status": "missing_coordinates" if status == "matched" else status,
                "address": result["geocodingQuery"],
            })

    save_json(args.output, coordinates)
    print(f"Geocoded units: {len(coordinates)}; new Nominatim requests: {request_count}; failures: {failed}.")
    print(f"Results: {args.output}")
    print(f"Detailed report: {report_path}")
    print(f"Address cache: {args.cache}")
    if unresolved:
        print(
            f"Unresolved units: {len(unresolved)}. Add verified query corrections or coordinate overrides "
            f"in {args.corrections} where available, then rerun the script.",
            file=sys.stderr,
        )
        for item in unresolved[:20]:
            print(
                f"  unit {item['unitId']} [{item['status']}]: {item['address'] or '(no address)'}",
                file=sys.stderr,
            )
        if len(unresolved) > 20:
            print(f"  ... and {len(unresolved) - 20} more", file=sys.stderr)
    return 1 if unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
