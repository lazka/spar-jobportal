"""Read and write the updater's local JSON files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def as_object(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split()) or None


def read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return value


def save_json(path: Path, value: Any) -> None:
    newline = "\n"
    if path.exists():
        with path.open("rb") as existing:
            if existing.readline().endswith(b"\r\n"):
                newline = "\r\n"
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline=newline
    )
    temporary.replace(path)
