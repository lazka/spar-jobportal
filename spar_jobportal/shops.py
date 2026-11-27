"""Match jobs organization units to the public SPAR app shop catalogue."""

from __future__ import annotations

import json
import re
from typing import Any

from .http_client import PoliteOpener
from .storage import as_object, clean_text

SHOPS_ENDPOINT = "https://api-scp.spar-ics.com/mobile/b2c/apps/spar/v1/spar-app-at/v8/public/shops"
REGIONAL_STORE = re.compile(
    r"(?:SM[123]?-|ES[123]?-|GM-|CITY-|EH|SYS)(0[1-6])-([0-9]{3,4})(?![0-9])"
)
INTERSPAR_UNIT = re.compile(r"IM([0-9]{2})(-100)?")


def fetch_shops(opener: PoliteOpener) -> dict[str, dict[str, Any]]:
    """Fetch and index the mobile catalogue by branch number."""
    _, body = opener.get(SHOPS_ENDPOINT, "application/json")
    shops = as_object(json.loads(body)).get("shop")
    if not isinstance(shops, list) or not shops:
        raise ValueError("Expected a non-empty mobile shop catalogue.")
    by_bnr: dict[str, dict[str, Any]] = {}
    for raw in shops:
        shop = as_object(raw)
        bnr = clean_text(shop.get("bnr"))
        if not bnr or bnr in by_bnr or not clean_text(shop.get("shopTypeName")):
            raise ValueError("The mobile shop catalogue has an invalid or duplicate shop entry.")
        by_bnr[bnr] = shop
    return by_bnr


def unit_code(name: str) -> str:
    """Separate the leading code from the human-readable unit name."""
    name = name.lstrip()
    # The regional store code ends at the first non-digit after the branch number.
    if match := REGIONAL_STORE.match(name):
        return match[0]
    return name.split(maxsplit=1)[0] if name else ""


def decode_bnr(code: str) -> str | None:
    """Derive a candidate catalogue bnr from a store unit code."""
    if match := REGIONAL_STORE.fullmatch(code):
        prefix, branch = match.groups()
        number = int(branch)
        return str(int(prefix) * 1000 + number if number < 1000 else number)
    if match := INTERSPAR_UNIT.fullmatch(code):
        suffix = "1" if match[2] else "0"
        return f"8{match[1]}{suffix}"
    return None


def map_unit(
    unit: dict[str, Any],
    by_bnr: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    name = clean_text(unit.get("name"))
    candidate = decode_bnr(unit_code(name or ""))
    shop = by_bnr.get(candidate, {}) if candidate else {}
    return {
        "name": name,
        "bnr": shop.get("bnr"),
        "shopType": shop.get("type"),
        "shopTypeName": shop.get("shopTypeName"),
    }
