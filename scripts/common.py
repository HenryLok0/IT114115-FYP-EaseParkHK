"""Shared helpers for collectors and the Pages publish step."""

from __future__ import annotations

import json
import shutil
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

HKT = timezone(timedelta(hours=8))
USER_AGENT = "EaseParkHK-collector/1.0 (FYP open-data research)"
TIMEOUT_SECONDS = 60
RETRIES = 3

PAGES_LATEST_FILES = (
    "vacancy.json",
    "carparks.json",
    "quality.json",
    "forecast.json",
    "metrics.json",
    "news.json",
    "cameras.json",
    "meters.json",
)


def now_hkt() -> datetime:
    return datetime.now(timezone.utc).astimezone(HKT)


def isoformat_hkt(dt: datetime) -> str:
    return dt.astimezone(HKT).replace(microsecond=0).isoformat()


def fetch_bytes(url: str, retries: int = RETRIES) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < retries:
                time.sleep(2 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def fetch_json(url: str, retries: int = RETRIES) -> Any:
    raw = fetch_bytes(url, retries=retries)
    return json.loads(raw.decode("utf-8-sig"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_json_if_changed(path: Path, payload: Any, ignore_keys: tuple[str, ...] = ()) -> bool:
    comparable = {key: value for key, value in payload.items() if key not in ignore_keys}
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        existing_comparable = {
            key: value for key, value in existing.items() if key not in ignore_keys
        }
        if existing_comparable == comparable:
            return False
    write_json(path, payload)
    return True


def publish_latest_to_pages(root: Path) -> list[str]:
    """Copy dashboard JSON into docs/data so GitHub Pages can read it."""
    src = root / "data" / "latest"
    dest = root / "docs" / "data"
    dest.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for name in PAGES_LATEST_FILES:
        source = src / name
        if source.exists():
            shutil.copy2(source, dest / name)
            copied.append(name)
    return copied
