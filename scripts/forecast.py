#!/usr/bin/env python3
"""30-minute private-car vacancy forecast and baseline evaluation.

Research question: can Transport Department open data predict private-car
vacancy 30 minutes ahead better than persistence (assume unchanged)?

Only vacancy_type A numeric counts are used. -1 / missing / B / C are excluded.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from common import isoformat_hkt, now_hkt, write_json
from collect_vacancy import parse_source_time

HORIZON_MINUTES = 30
STEP_MINUTES = 15
HORIZON_STEPS = HORIZON_MINUTES // STEP_MINUTES
TOLERANCE_MINUTES = 8


def load_history(history_dir: Path) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    if not history_dir.exists():
        return snapshots
    for path in sorted(history_dir.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                snapshots.append(json.loads(line))
    snapshots.sort(key=lambda item: item.get("ts") or "")
    return snapshots


def type_a_count(park: dict[str, Any] | None, vehicle: str = "privateCar") -> int | None:
    if not park:
        return None
    row = park.get(vehicle)
    if not isinstance(row, list) or len(row) < 2:
        return None
    vacancy, vacancy_type = row[0], row[1]
    if vacancy_type != "A":
        return None
    if vacancy in (None, -1, "-1"):
        return None
    try:
        value = int(vacancy)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return value


def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = parse_source_time(value.replace("T", " ", 1)[:19])
    return parsed


def minutes_between(left: datetime, right: datetime) -> float:
    return (right - left).total_seconds() / 60.0


def nearest_index(times: list[datetime], target: datetime) -> int | None:
    best_i = None
    best_abs = None
    for i, current in enumerate(times):
        gap = abs(minutes_between(current, target))
        if best_abs is None or gap < best_abs:
            best_abs = gap
            best_i = i
    if best_i is None or best_abs is None or best_abs > TOLERANCE_MINUTES:
        return None
    return best_i


def persistence_pred(y_now: int) -> float:
    return float(y_now)


def trend_pred(y_now: int, y_prev: int | None) -> float:
    """Linear trend over one 15-minute step, projected 30 minutes, floored at 0."""
    if y_prev is None:
        return float(y_now)
    delta = y_now - y_prev
    return max(0.0, float(y_now + HORIZON_STEPS * delta))


def mae_rmse(errors: list[float]) -> dict[str, float | None | int]:
    if not errors:
        return {"mae": None, "rmse": None, "n": 0}
    mae = sum(abs(item) for item in errors) / len(errors)
    rmse = math.sqrt(sum(item * item for item in errors) / len(errors))
    return {"mae": round(mae, 3), "rmse": round(rmse, 3), "n": len(errors)}


def evaluate(snapshots: list[dict[str, Any]], carparks: dict[str, Any]) -> dict[str, Any]:
    times: list[datetime] = []
    usable: list[dict[str, Any]] = []
    for snapshot in snapshots:
        ts = parse_ts(snapshot.get("ts"))
        if ts is None:
            continue
        times.append(ts)
        usable.append(snapshot)

    persistence_errors: list[float] = []
    trend_errors: list[float] = []
    by_hour: dict[str, list[float]] = {}
    by_district: dict[str, list[float]] = {}

    for i, origin in enumerate(usable):
        origin_time = times[i]
        target_time = origin_time + timedelta(minutes=HORIZON_MINUTES)
        j = nearest_index(times, target_time)
        if j is None or j <= i:
            continue
        prev = usable[i - 1]["p"] if i > 0 else {}
        origin_parks = origin.get("p") or {}
        future_parks = usable[j].get("p") or {}
        for park_id, park in origin_parks.items():
            y_now = type_a_count(park)
            y_true = type_a_count(future_parks.get(park_id))
            if y_now is None or y_true is None:
                continue
            y_prev = type_a_count((prev or {}).get(park_id))
            p_hat = persistence_pred(y_now)
            t_hat = trend_pred(y_now, y_prev)
            p_err = p_hat - y_true
            t_err = t_hat - y_true
            persistence_errors.append(p_err)
            trend_errors.append(t_err)
            hour_key = f"{origin_time.hour:02d}"
            by_hour.setdefault(hour_key, []).append(p_err)
            district = (
                (carparks.get(park_id) or {}).get("district_en")
                or (carparks.get(park_id) or {}).get("district_tc")
                or "Unknown"
            )
            by_district.setdefault(str(district), []).append(p_err)

    persistence = mae_rmse(persistence_errors)
    trend = mae_rmse(trend_errors)
    improvement = None
    if persistence["mae"] is not None and trend["mae"] is not None and persistence["mae"] > 0:
        improvement = round(
            100.0 * (persistence["mae"] - trend["mae"]) / persistence["mae"], 2
        )
    return {
        "horizon_minutes": HORIZON_MINUTES,
        "snapshot_count": len(usable),
        "persistence": persistence,
        "trend": trend,
        "trend_mae_improvement_pct_vs_persistence": improvement,
        "by_hour_persistence_mae": {
            hour: mae_rmse(values)["mae"] for hour, values in sorted(by_hour.items())
        },
        "by_district_persistence_mae": {
            district: mae_rmse(values)
            for district, values in sorted(
                by_district.items(), key=lambda item: item[0]
            )
        },
        "note": (
            "Need snapshots about 30 minutes apart before MAE/RMSE are defined."
            if persistence["n"] == 0
            else "Only type A private-car counts are scored. -1, missing, B and C are excluded."
        ),
    }


def current_forecast(latest_snapshot: dict[str, Any] | None, previous: dict[str, Any] | None) -> dict[str, Any]:
    parks_out: dict[str, Any] = {}
    current_parks = (latest_snapshot or {}).get("p") or {}
    previous_parks = (previous or {}).get("p") or {}
    for park_id, park in current_parks.items():
        y_now = type_a_count(park)
        if y_now is None:
            continue
        y_prev = type_a_count(previous_parks.get(park_id))
        parks_out[park_id] = {
            "privateCar_now": y_now,
            "persistence": round(persistence_pred(y_now), 1),
            "trend": round(trend_pred(y_now, y_prev), 1),
        }
    return parks_out


def run(root: Path) -> dict[str, Any]:
    generated_at = now_hkt()
    snapshots = load_history(root / "data" / "history")
    carparks_path = root / "data" / "latest" / "carparks.json"
    carparks = {}
    if carparks_path.exists():
        carparks = json.loads(carparks_path.read_text(encoding="utf-8")).get("parks") or {}
    metrics = evaluate(snapshots, carparks)
    latest = snapshots[-1] if snapshots else None
    previous = snapshots[-2] if len(snapshots) >= 2 else None
    forecast = {
        "generated_at": isoformat_hkt(generated_at),
        "horizon_minutes": HORIZON_MINUTES,
        "methods": {
            "persistence": "Assume vacancy stays at the latest type A count.",
            "trend": "Project the last 15-minute change over 30 minutes, floored at 0.",
        },
        "parks": current_forecast(latest, previous),
    }
    write_json(root / "data" / "latest" / "forecast.json", forecast)
    write_json(root / "data" / "latest" / "metrics.json", {**metrics, "generated_at": isoformat_hkt(generated_at)})
    return {
        "generated_at": isoformat_hkt(generated_at),
        "snapshot_count": metrics["snapshot_count"],
        "pairs": metrics["persistence"]["n"],
        "forecast_parks": len(forecast["parks"]),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Forecast 30-minute private-car vacancy")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    print(json.dumps(run(Path(args.root)), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
