import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from collect_vacancy import (  # noqa: E402
    compact_history_parks,
    parse_carpark_metadata,
    parse_source_time,
    parse_vacancy_results,
    quality_summary,
    collect,
    write_json_if_changed,
    HKT,
)


SAMPLE_VACANCY = {
    "results": [
        {
            "park_Id": "27",
            "privateCar": [
                {
                    "vacancy_type": "A",
                    "vacancy": 3,
                    "lastupdate": "2026-09-16 20:00:00",
                }
            ],
            "motorCycle": [
                {
                    "vacancy_type": "A",
                    "vacancy": 2,
                    "lastupdate": "2026-09-16 20:00:00",
                }
            ],
        },
        {
            "park_Id": "tdc5p1",
            "privateCar": [
                {
                    "vacancy_type": "B",
                    "vacancy": -1,
                    "lastupdate": "2026-09-16 20:28:02",
                }
            ],
        },
        {
            "park_Id": "stale1",
            "privateCar": [
                {
                    "vacancy_type": "C",
                    "vacancy": 0,
                    "lastupdate": "2026-01-18 16:55:54",
                }
            ],
        },
        {
            "park_Id": "empty1",
        },
    ]
}

SAMPLE_INFO = {
    "results": [
        {
            "park_Id": "27",
            "name": "Yau Lai Shopping Centre Carpark",
            "district": "Kwun Tong District",
            "displayAddress": "Yau Tong, KLN",
            "latitude": 22.29,
            "longitude": 114.23,
            "opening_status": "OPEN",
            "privateCar": {"space": 11},
            "motorCycle": {"space": 2},
        }
    ]
}

SAMPLE_BASIC = {
    "car_park": [
        {
            "park_id": "27",
            "name_en": "Yau Lai Shopping Centre Carpark",
            "name_tc": "油麗商場停車場",
            "district_en": "Kwun Tong",
            "district_tc": "觀塘",
            "displayAddress_en": "Yau Tong, KLN",
            "displayAddress_tc": "油塘",
            "latitude": 22.29,
            "longitude": 114.23,
        }
    ]
}


class CollectVacancyTests(unittest.TestCase):
    def test_parse_keeps_minus_one_and_omits_empty_parks(self):
        parks = parse_vacancy_results(SAMPLE_VACANCY)
        self.assertEqual(set(parks), {"27", "tdc5p1", "stale1", "empty1"})
        self.assertEqual(parks["27"]["privateCar"]["v"], 3)
        self.assertEqual(parks["tdc5p1"]["privateCar"]["v"], -1)
        self.assertEqual(parks["tdc5p1"]["privateCar"]["t"], "B")
        self.assertEqual(parks["empty1"], {})

    def test_quality_treats_minus_one_as_unavailable_not_zero(self):
        parks = parse_vacancy_results(SAMPLE_VACANCY)
        collected_at = datetime(2026, 9, 16, 20, 30, tzinfo=HKT)
        quality = quality_summary(parks, collected_at)
        private_car = quality["vehicles"]["privateCar"]
        self.assertEqual(private_car["reported"], 3)
        self.assertEqual(private_car["available"], 2)
        self.assertEqual(private_car["unavailable"], 1)
        self.assertEqual(private_car["types"]["A"], 1)
        self.assertEqual(private_car["types"]["B"], 1)
        self.assertEqual(private_car["types"]["C"], 1)
        self.assertEqual(private_car["stale"]["over_1d"], 1)
        self.assertGreater(private_car["max_lag_minutes"], 24 * 60)

    def test_history_rows_are_compact(self):
        parks = parse_vacancy_results(SAMPLE_VACANCY)
        compact = compact_history_parks(parks)
        self.assertEqual(compact["27"]["privateCar"], [3, "A"])
        self.assertEqual(compact["tdc5p1"]["privateCar"], [-1, "B"])
        self.assertNotIn("u", json.dumps(compact))

    def test_source_time_is_hong_kong_local(self):
        parsed = parse_source_time("2026-09-16 19:35:35")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.tzinfo, HKT)
        self.assertIsNone(parse_source_time(None))

    def test_zh_info_fills_traditional_chinese_names(self):
        zh_info = {
            "results": [
                {
                    "park_Id": "27",
                    "name": "油麗商場停車場",
                    "district": "觀塘區",
                    "displayAddress": "油塘",
                }
            ]
        }
        metadata = parse_carpark_metadata(SAMPLE_INFO, SAMPLE_BASIC, zh_info)
        self.assertEqual(metadata["27"]["name_tc"], "油麗商場停車場")
        self.assertEqual(metadata["27"]["district_tc"], "觀塘區")
        metadata = parse_carpark_metadata(SAMPLE_INFO, SAMPLE_BASIC)
        park = metadata["27"]
        self.assertEqual(park["name_tc"], "油麗商場停車場")
        self.assertEqual(park["district_tc"], "觀塘")
        self.assertEqual(park["spaces"]["privateCar"], 11)

    def test_collect_writes_latest_and_appends_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = collect(
                root,
                fetched={
                    "vacancy": SAMPLE_VACANCY,
                    "info": SAMPLE_INFO,
                    "basic": SAMPLE_BASIC,
                },
            )
            second = collect(
                root,
                fetched={
                    "vacancy": SAMPLE_VACANCY,
                    "info": SAMPLE_INFO,
                    "basic": SAMPLE_BASIC,
                },
            )
            vacancy_path = root / "data" / "latest" / "vacancy.json"
            quality_path = root / "data" / "latest" / "quality.json"
            carparks_path = root / "data" / "latest" / "carparks.json"
            history_path = Path(first["history_path"])
            self.assertTrue(vacancy_path.exists())
            self.assertTrue(quality_path.exists())
            self.assertTrue(carparks_path.exists())
            lines = history_path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(first["park_count"], 4)
            self.assertEqual(second["park_count"], 4)
            snapshot = json.loads(lines[0])
            self.assertIn("ts", snapshot)
            self.assertEqual(snapshot["p"]["tdc5p1"]["privateCar"], [-1, "B"])

    def test_metadata_file_not_rewritten_when_parks_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "carparks.json"
            payload = {"updated_at": "2026-09-16T20:00:00+08:00", "parks": {"27": {"name_en": "A"}}}
            self.assertTrue(write_json_if_changed(path, payload, ignore_keys=("updated_at",)))
            first_mtime = path.stat().st_mtime
            later = {"updated_at": "2026-09-16T20:15:00+08:00", "parks": {"27": {"name_en": "A"}}}
            self.assertFalse(write_json_if_changed(path, later, ignore_keys=("updated_at",)))
            self.assertEqual(path.stat().st_mtime, first_mtime)
            changed = {"updated_at": "2026-09-16T20:15:00+08:00", "parks": {"27": {"name_en": "B"}}}
            self.assertTrue(write_json_if_changed(path, changed, ignore_keys=("updated_at",)))


if __name__ == "__main__":
    unittest.main()
