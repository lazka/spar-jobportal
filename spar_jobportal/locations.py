"""Resolve organization-unit locations from corrections and geocoding."""

from __future__ import annotations

import json
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .http_client import PoliteOpener
from .storage import as_object, clean_text, read_object

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "spar-jobportal-unit-geocoder/2.0 (+https://github.com/lazka/spar-jobportal)"


def coordinates(value: dict[str, Any]) -> list[float] | None:
    lat, lon = value.get("latitude"), value.get("longitude")
    if (
        isinstance(lat, (int, float))
        and not isinstance(lat, bool)
        and -90 <= lat <= 90
        and isinstance(lon, (int, float))
        and not isinstance(lon, bool)
        and -180 <= lon <= 180
    ):
        return [lat, lon]
    return None


def load_corrections(path: Path) -> dict[str, Any]:
    corrections = read_object(path)
    for unit_id, correction in corrections.items():
        entry = as_object(correction)
        address = correction if isinstance(correction, str) else entry.get("address")
        if {"latitude", "longitude"} & entry.keys():
            if coordinates(entry) is None:
                raise ValueError(f"Correction for unit {unit_id} needs valid coordinates.")
            if "address" in entry and not clean_text(address):
                raise ValueError(f"Correction for unit {unit_id} has an invalid address.")
        elif not clean_text(address):
            raise ValueError(f"Correction for unit {unit_id} needs an address.")
    return corrections


def unit_query(address: dict[str, Any], correction: Any) -> str | None:
    query = correction if isinstance(correction, str) else as_object(correction).get("address")
    return clean_text(query) or clean_text(address.get("address"))


def geocode_key(query: str | None) -> str:
    return query.casefold() if query else ""


def resolve_unit(
    unit: dict[str, Any],
    addresses: dict[str, Any],
    corrections: dict[str, Any],
    geocodes: dict[str, Any],
) -> dict[str, Any]:
    unit_id = unit.get("id")
    key = str(unit_id) if unit_id is not None else ""
    entry = as_object(addresses.get(key))
    correction = corrections.get(key)
    override = as_object(correction)
    query = unit_query(entry, correction)
    point = coordinates(override)
    address = clean_text(entry.get("address"))
    if point is not None:
        address = clean_text(override.get("address")) or address
    else:
        cached = as_object(geocodes.get(geocode_key(query)))
        if cached.get("status") == "matched":
            point = coordinates(cached)
            address = address or (query if point is not None else None)
    if address:
        # Keep the country in the source address and geocoding query, not the export.
        address = re.sub(r"(?:^|,\s*)Österreich$", "", address).rstrip() or None
    return {
        "id": unit_id,
        "name": unit.get("name"),
        "orgType": clean_text(entry.get("orgType")),
        "address": address,
        "coordinates": point,
    }


def specific_result(candidate: dict[str, Any]) -> bool:
    category = candidate.get("category") or candidate.get("class")
    address = as_object(candidate.get("address"))
    if category in {"place", "boundary", "highway", "postcode"}:
        return (
            category == "place"
            and candidate.get("type") == "house"
            and bool(address.get("house_number"))
        )
    if address.get("house_number") and (
        address.get("road") or address.get("street") or category == "building"
    ):
        return True
    return category in {
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
    } and bool(candidate.get("name") or address.get(category))


def geocode(opener: PoliteOpener, query: str) -> dict[str, Any]:
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": 5,
            "countrycodes": "at",
        }
    )
    _, body = opener.get(
        f"{NOMINATIM_URL}?{params}", "application/json", {"User-Agent": NOMINATIM_USER_AGENT}
    )
    results = json.loads(body)
    if not isinstance(results, list) or not all(
        isinstance(candidate, dict) for candidate in results
    ):
        raise ValueError("Unexpected response from Nominatim.")
    result = {
        "status": "not_specific" if results else "not_found",
        "query": query,
        "provider": "Nominatim",
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "attribution": "© OpenStreetMap contributors",
    }
    for candidate in results:
        if specific_result(candidate):
            pair = {"latitude": float(candidate["lat"]), "longitude": float(candidate["lon"])}
            if coordinates(pair) is None:
                raise ValueError("Nominatim returned invalid coordinates.")
            result.update(
                pair,
                status="matched",
                displayName=candidate.get("display_name"),
                osmType=candidate.get("osm_type"),
                osmId=candidate.get("osm_id"),
                category=candidate.get("category"),
                type=candidate.get("type"),
                address=candidate.get("address"),
                license=candidate.get("licence"),
            )
            break
    return result
