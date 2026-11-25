#!/usr/bin/env python3
"""Review catalogue suggestions and save only explicitly confirmed Nominatim queries."""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

from geocode_spar_units import (
    needs_numbered_house_retry,
    normalized_query,
    read_json_object,
    request_nominatim,
    save_json,
    validate_cached_result,
)


def suggestions(path: Path):
    section = ""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("## "):
            section = line[3:]
        if not line.startswith("| `"):
            continue
        unit, source, catalogue, note = (
            cell.strip().replace(r"\|", "|")
            for cell in re.split(r"(?<!\\)\|", line)[1:-1]
        )
        match = re.fullmatch(r"`(\d+)`\s+(.+)", unit)
        if not match:
            raise ValueError(f"Invalid unit in {path}: {unit}")
        if catalogue == "—":
            continue
        branch, address = catalogue.rsplit(" — ", 1)
        yield (*match.groups(), source, branch, address, note, section)


def main() -> int:
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, default=root / "spar_unresolved_shop_review.md")
    parser.add_argument("--units", type=Path, default=root / "spar_unit_addresses.json")
    parser.add_argument("--corrections", type=Path, default=root / "spar_address_corrections.json")
    parser.add_argument("--cache", type=Path, default=root / "spar_nominatim_cache.json")
    parser.add_argument("--decisions", type=Path, default=root / "spar_shop_review_denials.json")
    parser.add_argument("--revisit-denied", action="store_true", help="Include previously denied suggestions.")
    parser.add_argument("--offline", action="store_true", help="Use only cached Nominatim results.")
    args = parser.parse_args()

    color = sys.stdout.isatty() and "NO_COLOR" not in os.environ and os.environ.get("TERM") != "dumb"

    def address_line(label: str, text: str, code: int) -> str:
        line = f"{label}: {text}"
        return f"\x1b[{code}m{line}\x1b[0m" if color else line

    try:
        rows = list(suggestions(args.review))
        if not rows:
            raise ValueError(f"No catalogue suggestions found in {args.review}.")
        if len({p.resolve() for p in (args.corrections, args.cache, args.decisions)}) != 3:
            raise ValueError("Corrections, cache and decisions must be separate files.")
        corrections = read_json_object(args.corrections)
        units = read_json_object(args.units)
        cache = read_json_object(args.cache)
        denials = read_json_object(args.decisions)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    pending = [
        row for row in rows if row[0] not in corrections
        and (args.revisit_denied or denials.get(row[0]) != row[4])
    ]
    approved = denied = requests = skipped = 0
    last_request = 0.0

    def check(query: str):
        nonlocal requests, last_request
        key = normalized_query(query)
        result = validate_cached_result(cache[key]) if key in cache else {}
        if not args.offline and (not result or needs_numbered_house_retry(result)):
            if requests >= 10:
                return False, "live lookup limit reached"
            else:
                time.sleep(max(0, 1.1 - (time.monotonic() - last_request)))
                requests += 1
                try:
                    result = request_nominatim(query, timeout=25, retries=0)
                except (OSError, ValueError) as error:
                    print(f"Lookup failed: {error}. Using only cached results for this session.")
                    args.offline = True
                else:
                    cache[key] = result
                    save_json(args.cache, cache)
                    result = validate_cached_result(result)
                finally:
                    last_request = time.monotonic()
        matched = (
            result.get("provider") == "Nominatim"
            and result.get("status") == "matched"
            and result.get("latitude") is not None
            and result.get("longitude") is not None
        )
        status = result.get("status", "not checked").replace("_", " ")
        display_name = result.get("displayName") if matched else None
        return matched, display_name or status

    print(f"{len(pending)} suggestions to review. Existing corrections are skipped.")
    try:
        for uid, _, source, branch, address, _, _ in pending:
            source = units.get(uid, {}).get("address") or source
            query = address
            matched, result_label = check(query)
            if not matched:
                skipped += 1
                continue
            print()
            print(address_line("Old", source, 33))
            print(address_line("New", query, 32))
            print(f"Nominatim: {result_label}")
            while True:
                options = ["y=save if this is the intended site", "e=edit", "n=deny", "Enter=skip", "q=quit"]
                action = input(f"[{', '.join(options)}] ").strip().lower()
                if action == "q":
                    raise EOFError
                if action == "":
                    break
                if action == "e":
                    replacement = " ".join(input("Replacement address (Enter to cancel): ").split())
                    if replacement:
                        query = replacement
                        print(address_line("New", query, 32))
                        matched, result_label = check(query)
                        print(f"Nominatim: {result_label}")
                        if not matched:
                            skipped += 1
                            break
                elif action == "n":
                    denials[uid] = address
                    save_json(args.decisions, denials)
                    denied += 1
                    break
                elif action == "y":
                    # Re-read before writing so changes made during review are retained.
                    corrections = read_json_object(args.corrections)
                    if uid in corrections:
                        print("A correction already exists; leaving it unchanged.")
                        break
                    corrections[uid] = {
                        "address": query,
                        "note": f"Manually verified Nominatim match against the catalogue: {branch}, {address}.",
                    }
                    save_json(args.corrections, corrections)
                    approved += 1
                    print("Correction saved.")
                    break
                else:
                    print("Choose one of the displayed actions.")
    except (EOFError, KeyboardInterrupt):
        print("\nStopped. Saved decisions are kept.")
    print(f"Added {approved} corrections; denied {denied} suggestions; skipped {skipped} queries without a usable result.")
    if requests >= 10:
        print("Live lookup limit reached. Restart to check remaining uncached queries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
