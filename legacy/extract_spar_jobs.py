#!/usr/bin/env python3
"""Convert a SPAR search-API export into a flat JSON array for search/display."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


# API field codes vary in readability; use the stable display labels from the
# response's "columns" array to map them to application-friendly keys.
FIELD_KEYS = {
    "Organisationseinheit": "organizationUnit",
    "Name": "title",
    "Bundesland (Filter Website)": "state",
    "Dienstort": "location",
    "Berufsfeld": "jobField",
    "Beschäftigungsausmaß": "employmentType",
    "Eintritt zum": "start",
    "Schnellbewerbung (ohne Lebenslauf)": "quickApplyWithoutCV",
}


def field_value(field: Any) -> Any:
    if not isinstance(field, dict):
        return field
    value = field.get("stringValue")
    if value in (None, ""):
        json_value = field.get("jsonValue")
        if isinstance(json_value, dict):
            value = json_value.get("value")
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def convert(source: dict[str, Any]) -> list[dict[str, Any]]:
    columns = {
        column.get("code"): column.get("label")
        for column in source.get("columns", [])
        if isinstance(column, dict)
    }
    jobs: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()

    for wrapper in source.get("jobs", []):
        if not isinstance(wrapper, dict):
            continue
        record = wrapper.get("record", wrapper)
        if not isinstance(record, dict):
            continue

        job_id = wrapper.get("id", record.get("id"))
        if job_id is None or job_id in seen_ids:
            continue
        seen_ids.add(job_id)

        raw_fields = record.get("fields", {})
        raw_fields = raw_fields if isinstance(raw_fields, dict) else {}
        job: dict[str, Any] = {"id": job_id}

        for code, field in raw_fields.items():
            label = columns.get(code)
            key = FIELD_KEYS.get(label)
            if key:
                job[key] = field_value(field)
                if key == "organizationUnit" and isinstance(field, dict):
                    option = (
                        field.get("jsonValue", {})
                        .get("value", {})
                        .get("value", {})
                    )
                    if isinstance(option, dict):
                        job["organizationUnitId"] = option.get("id")

        # Consistent keys make client-side indexing and rendering simpler.
        for key in FIELD_KEYS.values():
            job.setdefault(key, None)
        job.setdefault("organizationUnitId", None)

        links = wrapper.get("links", {})
        links = links if isinstance(links, dict) else {}
        job["detailUrl"] = links.get("detailPage")
        job["applicationUrl"] = links.get("applyPage")
        jobs.append(job)

    return jobs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=Path("spar_jobs.json"))
    parser.add_argument("-o", "--output", type=Path, default=Path("spar_jobs_index.json"))
    args = parser.parse_args()

    try:
        source = json.loads(args.input.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        parser.error(str(error))
    if not isinstance(source, dict) or not isinstance(source.get("jobs"), list):
        parser.error("Expected the SPAR API export format with a top-level 'jobs' array.")

    jobs = convert(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + ".tmp")
    temporary.write_text(json.dumps(jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)

    print(f"Wrote {len(jobs)} unique job objects to {args.output}.")
    if source.get("complete") is False or source.get("total_limit_reached") is True:
        print(
            "Warning: source metadata flags complete=false/total_limit_reached=true; "
            "the output is a plain array and does not embed that metadata."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
