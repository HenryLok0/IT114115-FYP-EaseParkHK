import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from collect_feeds import parse_cameras, parse_notices  # noqa: E402
from collect_vacancy import HKT  # noqa: E402
from forecast import evaluate, type_a_count, trend_pred  # noqa: E402


NEWS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Notices>
  <Notice>
    <Title_EN>Road closed</Title_EN>
    <Title_TC>closed-tc</Title_TC>
    <Content_EN>Central closed tonight</Content_EN>
    <Content_TC>central-tc</Content_TC>
  </Notice>
  <Notice>
    <Title_EN>PDF only</Title_EN>
    <Title_TC>pdf-tc</Title_TC>
    <Content_EN>see file.pdf</Content_EN>
    <Content_TC>see file.pdf</Content_TC>
  </Notice>
</Notices>
""".encode("utf-8")

CAMERA_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<image_list>
  <image>
    <key>H101</key>
    <region>Hong Kong Island</region>
    <district>Central</district>
    <description>Connaught Road</description>
    <latitude>22.28</latitude>
    <longitude>114.16</longitude>
    <url>https://example.com/cam.jpg</url>
  </image>
</image_list>
"""


class FeedParseTests(unittest.TestCase):
    def test_notices_skip_pdf_only(self):
        notices = parse_notices(NEWS_XML, "Temporary Road Closure")
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]["title_tc"], "closed-tc")

    def test_cameras(self):
        cameras = parse_cameras(CAMERA_XML)
        self.assertEqual(len(cameras), 1)
        self.assertEqual(cameras[0]["key"], "H101")


class ForecastTests(unittest.TestCase):
    def test_type_a_ignores_missing_and_status_codes(self):
        self.assertEqual(type_a_count({"privateCar": [12, "A"]}), 12)
        self.assertIsNone(type_a_count({"privateCar": [-1, "A"]}))
        self.assertIsNone(type_a_count({"privateCar": [1, "B"]}))
        self.assertIsNone(type_a_count({}))

    def test_trend_is_floored_at_zero(self):
        self.assertEqual(trend_pred(10, 4), 22.0)
        self.assertEqual(trend_pred(1, 10), 0.0)

    def test_persistence_mae_on_30_minute_pairs(self):
        start = datetime(2026, 9, 16, 12, 0, tzinfo=HKT)
        snapshots = []
        values = [10, 10, 16]
        for i, value in enumerate(values):
            ts = start + timedelta(minutes=15 * i)
            snapshots.append(
                {
                    "ts": ts.replace(microsecond=0).isoformat(),
                    "p": {"27": {"privateCar": [value, "A"]}},
                }
            )
        metrics = evaluate(snapshots, {"27": {"district_en": "Kwun Tong District"}})
        self.assertEqual(metrics["persistence"]["n"], 1)
        self.assertEqual(metrics["persistence"]["mae"], 6.0)
        self.assertEqual(metrics["trend"]["mae"], 6.0)


if __name__ == "__main__":
    unittest.main()
