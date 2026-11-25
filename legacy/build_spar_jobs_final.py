#!/usr/bin/env python3
"""Join job records with cached unit addresses and geocoding into one JSON array."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=Path, default=Path("spar_jobs_index.json"))
    parser.add_argument("--units", type=Path, default=Path("spar_unit_addresses.json"))
    parser.add_argument("--geocoded", type=Path, default=Path("spar_unit_locations.json"))
    parser.add_argument("--report", type=Path, help="Detailed unit report; defaults to the geocoded filename with _report before its extension.")
    parser.add_argument("--output", type=Path, default=Path("frontend/spar_jobs_final.json"))
    args = parser.parse_args()

    try:
        jobs = load_json(args.jobs, [])
        units = load_json(args.units, {})
        geocoded = load_json(args.geocoded, {})
        report_path = args.report or args.geocoded.with_name(
            f"{args.geocoded.stem}_report{args.geocoded.suffix}"
        )
        report = load_json(report_path, {})
    except (OSError, json.JSONDecodeError) as error:
        parser.error(str(error))
    if not isinstance(jobs, list):
        parser.error(f"{args.jobs} must contain a JSON array of jobs.")
    if not all(isinstance(data, dict) for data in (units, geocoded, report)):
        parser.error("Unit address, geocoding, and report files must contain JSON objects.")

    result: list[dict[str, Any]] = []
    with_coordinates = 0
    for source_job in jobs:
        if not isinstance(source_job, dict):
            continue
        job = dict(source_job)
        if job.get("quickApplyWithoutCV") == "Nein":
            job["quickApplyWithoutCV"] = False
        unit_id = job.pop("organizationUnitId", None)
        unit_name = job.pop("organizationUnit", None)
        key = str(unit_id) if unit_id is not None else None
        address_entry = units.get(key, {}) if key is not None else {}
        location = geocoded.get(key, {}) if key is not None else {}
        location = location if isinstance(location, dict) else {}
        legacy = isinstance(location.get("geocoding"), dict)
        geocode_entry = location if legacy else report.get(key, {})
        address_entry = address_entry if isinstance(address_entry, dict) else {}
        geocode_entry = geocode_entry if isinstance(geocode_entry, dict) else {}
        geo = geocode_entry.get("geocoding")
        geo = geo if isinstance(geo, dict) else {}

        address = geocode_entry.get("address") or address_entry.get("address")
        correction = geocode_entry.get("addressCorrection")
        if (
            not address
            and geo.get("status") == "matched"
            and isinstance(correction, dict)
            and correction.get("applied")
        ):
            address = correction.get("address")
        pair = geo if legacy else location
        latitude = pair.get("latitude")
        longitude = pair.get("longitude")
        coordinates = None
        if latitude is not None and longitude is not None:
            coordinates = [latitude, longitude]
            with_coordinates += 1

        unit = {
            "id": unit_id,
            "name": unit_name,
            "address": address,
            "addressSourceJobId": (
                geocode_entry.get("sourceJobId") or address_entry.get("sourceJobId")
            ),
            "coordinates": coordinates,  # [latitude, longitude], not GeoJSON order
        }
        job["unit"] = unit
        result.append(job)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + ".tmp")
    temporary.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(args.output)
    print(
        f"Wrote {len(result)} job objects to {args.output}; "
        f"{with_coordinates} currently have coordinates."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
