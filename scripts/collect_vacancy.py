#!/usr/bin/env python3
"""Collect Hong Kong car park vacancy snapshots into a git-friendly dataset.

No API key is required. The government endpoints are public open data.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from common import (
    HKT,
    fetch_json,
    isoformat_hkt,
    now_hkt,
    write_json,
    write_json_if_changed,
)

VACANCY_URL = (
    "https://api.data.gov.hk/v1/carpark-info-vacancy"
    "?data=vacancy&vehicleTypes=privateCar,motorCycle,LGV,HGV,coach&lang=en_US"
)
INFO_URL = "https://api.data.gov.hk/v1/carpark-info-vacancy"
ZH_INFO_URL = "https://api.data.gov.hk/v1/carpark-info-vacancy?lang=zh_TW"
BASIC_INFO_URL = "https://resource.data.one.gov.hk/td/carpark/basic_info_all.json"

VEHICLE_TYPES = ("privateCar", "motorCycle", "LGV", "HGV", "coach", "CV")


def parse_source_time(value: Any) -> datetime | None:
    """Parse Transport Department lastupdate strings as Hong Kong local time."""
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt).replace(tzinfo=HKT)
        except ValueError:
            continue
    return None


def first_vehicle_entry(item: dict[str, Any], vehicle: str) -> dict[str, Any] | None:
    raw = item.get(vehicle)
    if isinstance(raw, list):
        return raw[0] if raw and isinstance(raw[0], dict) else None
    if isinstance(raw, dict):
        return raw
    return None


def extract_vehicle(item: dict[str, Any], vehicle: str) -> dict[str, Any] | None:
    entry = first_vehicle_entry(item, vehicle)
    if entry is None or "vacancy" not in entry:
        return None
    return {
        "v": entry.get("vacancy"),
        "t": entry.get("vacancy_type"),
        "u": entry.get("lastupdate"),
    }


def parse_vacancy_results(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    parks: dict[str, dict[str, Any]] = {}
    for item in payload.get("results") or []:
        park_id = item.get("park_Id") or item.get("park_id")
        if not park_id:
            continue
        vehicles: dict[str, Any] = {}
        for vehicle in VEHICLE_TYPES:
            extracted = extract_vehicle(item, vehicle)
            if extracted is not None:
                vehicles[vehicle] = extracted
        parks[str(park_id)] = vehicles
    return parks


def compact_history_parks(parks: dict[str, dict[str, Any]]) -> dict[str, dict[str, list[Any]]]:
    compact: dict[str, dict[str, list[Any]]] = {}
    for park_id, vehicles in parks.items():
        row: dict[str, list[Any]] = {}
        for vehicle, values in vehicles.items():
            row[vehicle] = [values.get("v"), values.get("t")]
        compact[park_id] = row
    return compact


def quality_summary(parks: dict[str, dict[str, Any]], collected_at: datetime) -> dict[str, Any]:
    vehicles: dict[str, Any] = {}
    for vehicle in VEHICLE_TYPES:
        reported = 0
        available = 0
        unavailable = 0
        types: dict[str, int] = {"A": 0, "B": 0, "C": 0, "other": 0}
        stale = {"over_30min": 0, "over_2h": 0, "over_1d": 0}
        lags: list[float] = []
        for values in parks.values():
            entry = values.get(vehicle)
            if not entry:
                continue
            reported += 1
            vacancy = entry.get("v")
            if vacancy == -1:
                unavailable += 1
            elif isinstance(vacancy, (int, float)):
                available += 1
            vacancy_type = str(entry.get("t") or "other")
            if vacancy_type in types:
                types[vacancy_type] += 1
            else:
                types["other"] += 1
            source_time = parse_source_time(entry.get("u"))
            if source_time is None:
                continue
            lag_minutes = (collected_at - source_time).total_seconds() / 60
            if lag_minutes < 0:
                lag_minutes = 0
            lags.append(lag_minutes)
            if lag_minutes > 24 * 60:
                stale["over_1d"] += 1
            elif lag_minutes > 120:
                stale["over_2h"] += 1
            elif lag_minutes > 30:
                stale["over_30min"] += 1
        park_count = max(len(parks), 1)
        vehicles[vehicle] = {
            "reported": reported,
            "available": available,
            "unavailable": unavailable,
            "types": types,
            "stale": stale,
            "max_lag_minutes": round(max(lags), 1) if lags else None,
            "median_lag_minutes": round(sorted(lags)[len(lags) // 2], 1) if lags else None,
            "available_pct": round(100.0 * available / park_count, 2),
        }
    private_car = vehicles["privateCar"]
    return {
        "collected_at": isoformat_hkt(collected_at),
        "park_count": len(parks),
        "vehicles": vehicles,
        "coverage": {
            "privateCar_available_pct": private_car["available_pct"],
            "privateCar_unavailable_pct": round(
                100.0 * private_car["unavailable"] / max(len(parks), 1), 2
            ),
        },
    }


def extract_spaces(info: dict[str, Any]) -> dict[str, int | None]:
    spaces: dict[str, int | None] = {}
    for vehicle in VEHICLE_TYPES:
        entry = first_vehicle_entry(info, vehicle)
        if entry and isinstance(entry.get("space"), (int, float)):
            spaces[vehicle] = int(entry["space"])
        else:
            spaces[vehicle] = None
    return spaces


def parse_carpark_metadata(
    info_payload: dict[str, Any] | None,
    basic_payload: dict[str, Any] | None,
    zh_info_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    parks: dict[str, dict[str, Any]] = {}
    for item in (info_payload or {}).get("results") or []:
        park_id = str(item.get("park_Id") or "")
        if not park_id:
            continue
        parks[park_id] = {
            "park_id": park_id,
            "name_en": item.get("name"),
            "name_tc": None,
            "district_en": item.get("district"),
            "district_tc": None,
            "displayAddress_en": item.get("displayAddress"),
            "displayAddress_tc": None,
            "latitude": item.get("latitude"),
            "longitude": item.get("longitude"),
            "opening_status": item.get("opening_status"),
            "spaces": extract_spaces(item),
        }
    for item in (zh_info_payload or {}).get("results") or []:
        park_id = str(item.get("park_Id") or "")
        if not park_id:
            continue
        current = parks.setdefault(
            park_id,
            {
                "park_id": park_id,
                "name_en": None,
                "name_tc": None,
                "district_en": None,
                "district_tc": None,
                "displayAddress_en": None,
                "displayAddress_tc": None,
                "latitude": item.get("latitude"),
                "longitude": item.get("longitude"),
                "opening_status": item.get("opening_status"),
                "spaces": extract_spaces(item),
            },
        )
        current["name_tc"] = item.get("name")
        current["district_tc"] = item.get("district")
        current["displayAddress_tc"] = item.get("displayAddress")
        if current.get("latitude") is None:
            current["latitude"] = item.get("latitude")
        if current.get("longitude") is None:
            current["longitude"] = item.get("longitude")
    for item in (basic_payload or {}).get("car_park") or []:
        park_id = str(item.get("park_id") or "")
        if not park_id:
            continue
        current = parks.setdefault(
            park_id,
            {
                "park_id": park_id,
                "name_en": item.get("name_en"),
                "name_tc": None,
                "district_en": item.get("district_en"),
                "district_tc": None,
                "displayAddress_en": item.get("displayAddress_en"),
                "displayAddress_tc": None,
                "latitude": item.get("latitude"),
                "longitude": item.get("longitude"),
                "opening_status": item.get("opening_status"),
                "spaces": {vehicle: None for vehicle in VEHICLE_TYPES},
            },
        )
        current["name_tc"] = current.get("name_tc") or item.get("name_tc")
        current["name_en"] = current.get("name_en") or item.get("name_en")
        current["district_tc"] = current.get("district_tc") or item.get("district_tc")
        current["district_en"] = current.get("district_en") or item.get("district_en")
        current["displayAddress_tc"] = item.get("displayAddress_tc")
        current["displayAddress_en"] = current.get("displayAddress_en") or item.get(
            "displayAddress_en"
        )
        if current.get("latitude") is None:
            current["latitude"] = item.get("latitude")
        if current.get("longitude") is None:
            current["longitude"] = item.get("longitude")
    return parks


def append_history(path: Path, snapshot: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")


def collect(root: Path, fetched: dict[str, Any] | None = None) -> dict[str, Any]:
    collected_at = now_hkt()
    vacancy_payload = (fetched or {}).get("vacancy") or fetch_json(VACANCY_URL)
    parks = parse_vacancy_results(vacancy_payload)
    if not parks:
        raise RuntimeError("Vacancy API returned no parks")

    info_payload = (fetched or {}).get("info")
    basic_payload = (fetched or {}).get("basic")
    zh_info_payload = (fetched or {}).get("zh_info")
    if fetched is None:
        try:
            info_payload = fetch_json(INFO_URL)
        except RuntimeError as error:
            print(f"Warning: car park info fetch failed: {error}", file=sys.stderr)
        try:
            zh_info_payload = fetch_json(ZH_INFO_URL)
        except RuntimeError as error:
            print(f"Warning: Chinese car park info fetch failed: {error}", file=sys.stderr)
        try:
            basic_payload = fetch_json(BASIC_INFO_URL)
        except RuntimeError as error:
            print(f"Warning: bilingual basic info fetch failed: {error}", file=sys.stderr)

    quality = quality_summary(parks, collected_at)
    metadata = parse_carpark_metadata(info_payload, basic_payload, zh_info_payload)
    latest_vacancy = {
        "collected_at": isoformat_hkt(collected_at),
        "source": VACANCY_URL,
        "park_count": len(parks),
        "parks": parks,
    }
    history_snapshot = {
        "ts": isoformat_hkt(collected_at),
        "n": len(parks),
        "p": compact_history_parks(parks),
        "q": quality["coverage"],
    }

    data_root = root / "data"
    write_json(data_root / "latest" / "vacancy.json", latest_vacancy)
    write_json(data_root / "latest" / "quality.json", quality)
    if metadata:
        write_json_if_changed(
            data_root / "latest" / "carparks.json",
            {
                "updated_at": isoformat_hkt(collected_at),
                "park_count": len(metadata),
                "parks": metadata,
            },
            ignore_keys=("updated_at",),
        )
    history_path = data_root / "history" / f"{collected_at.date().isoformat()}.jsonl"
    append_history(history_path, history_snapshot)
    return {
        "collected_at": isoformat_hkt(collected_at),
        "park_count": len(parks),
        "history_path": str(history_path),
        "quality": quality["coverage"],
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect HK car park vacancy snapshots")
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Repository root (default: parent of scripts/)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summary = collect(Path(args.root))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
