#!/usr/bin/env python3
"""Collect metered parking, traffic notices, and camera locations as JSON."""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from common import fetch_bytes, isoformat_hkt, now_hkt, write_json

NS_SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

METER_FILES = {
    "hong_kong_island": {
        "en": "https://www.td.gov.hk/filemanager/en/content_5036/opendata/hki_parking_spaces_eng.xlsx",
        "zh": "https://www.td.gov.hk/filemanager/tc/content_5036/opendata/hki_parking_spaces_chi.xlsx",
    },
    "kowloon": {
        "en": "https://www.td.gov.hk/filemanager/en/content_5036/opendata/kln_parking_spaces_eng.xlsx",
        "zh": "https://www.td.gov.hk/filemanager/tc/content_5036/opendata/kln_parking_spaces_chi.xlsx",
    },
    "new_territories": {
        "en": "https://www.td.gov.hk/filemanager/en/content_5036/opendata/nt_parking_spaces_eng.xlsx",
        "zh": "https://www.td.gov.hk/filemanager/tc/content_5036/opendata/nt_parking_spaces_chi.xlsx",
    },
}

NEWS_FEEDS = {
    "Temporary Road Closure": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Notices_on_Temporary_Road_Closure.xml",
    "Expressways": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Notices_on_Expressways.xml",
    "Prohibited Zone": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Notices_on_Prohibited_Zone.xml",
    "Special Traffic and Transport Arrangement": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Special_Traffic_and_Transport_Arrangement.xml",
    "Other Notices": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Other_Notices.xml",
    "Temporary Speed Limits": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Notices_on_Temporary_Speed_Limits.xml",
    "Clearways": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Notices_on_Clearways.xml",
    "Public Transports": "https://www.td.gov.hk/datagovhk_tis/traffic-notices/Notices_on_Public_Transports.xml",
}

CAMERA_URLS = {
    "en": "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml",
    "zh": "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml",
}


def local_tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def col_index(cell_ref: str) -> int:
    letters = "".join(char for char in cell_ref if char.isalpha())
    index = 0
    for char in letters.upper():
        index = index * 26 + (ord(char) - 64)
    return index - 1


def cell_text(cell: ET.Element, shared: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value = cell.find(f"{{{NS_SS}}}v")
    is_elem = cell.find(f"{{{NS_SS}}}is")
    if cell_type == "s" and value is not None and value.text:
        try:
            return shared[int(value.text)]
        except (ValueError, IndexError):
            return value.text
    if cell_type == "inlineStr" and is_elem is not None:
        return "".join(node.text or "" for node in is_elem.iter() if local_tag(node) == "t")
    if value is not None:
        return value.text or ""
    return ""


def xlsx_to_records(content: bytes) -> list[dict[str, Any]]:
    """Parse the first worksheet of a simple .xlsx file without pandas."""
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root:
                if local_tag(si) != "si":
                    continue
                shared.append(
                    "".join(node.text or "" for node in si.iter() if local_tag(node) == "t")
                )
        sheet_name = next(
            name for name in archive.namelist() if name.startswith("xl/worksheets/sheet")
        )
        sheet = ET.fromstring(archive.read(sheet_name))
        rows: list[list[str]] = []
        for row in sheet.iter():
            if local_tag(row) != "row":
                continue
            values: dict[int, str] = {}
            for cell in list(row):
                if local_tag(cell) != "c":
                    continue
                ref = cell.attrib.get("r", "A1")
                values[col_index(ref)] = cell_text(cell, shared)
            if not values:
                continue
            width = max(values) + 1
            rows.append([values.get(i, "") for i in range(width)])
    if not rows:
        return []
    headers = [str(item).strip() or f"col_{i}" for i, item in enumerate(rows[0])]
    records: list[dict[str, Any]] = []
    for row in rows[1:]:
        record = {}
        empty = True
        for i, header in enumerate(headers):
            value = row[i].strip() if i < len(row) else ""
            if value != "":
                empty = False
            record[header] = value
        if not empty:
            records.append(record)
    return records


def parse_notices(xml_bytes: bytes, feed_name: str) -> list[dict[str, str]]:
    root = ET.fromstring(xml_bytes)
    notices: list[dict[str, str]] = []
    for notice in root.findall("Notice"):
        title_en = (notice.findtext("Title_EN") or "").strip()
        title_tc = (notice.findtext("Title_TC") or "").strip()
        content_en = (notice.findtext("Content_EN") or "").strip()
        content_tc = (notice.findtext("Content_TC") or "").strip()
        if ".pdf" in content_en.lower() and ".pdf" in content_tc.lower():
            continue
        if not title_en and not title_tc:
            continue
        notices.append(
            {
                "feed": feed_name,
                "title_en": title_en[:200],
                "title_tc": title_tc[:200],
                "content_en": content_en[:500],
                "content_tc": content_tc[:500],
            }
        )
    return notices


def parse_cameras(xml_bytes: bytes) -> list[dict[str, str]]:
    root = ET.fromstring(xml_bytes)
    cameras: list[dict[str, str]] = []
    for image in root.findall("image"):
        cameras.append(
            {
                "key": image.findtext("key") or "",
                "region": image.findtext("region") or "",
                "district": image.findtext("district") or "",
                "description": image.findtext("description") or "",
                "latitude": image.findtext("latitude") or "",
                "longitude": image.findtext("longitude") or "",
                "url": image.findtext("url") or "",
            }
        )
    return cameras


def collect_meters() -> dict[str, Any]:
    regions: dict[str, Any] = {}
    for region, urls in METER_FILES.items():
        regions[region] = {}
        for lang, url in urls.items():
            try:
                records = xlsx_to_records(fetch_bytes(url))
                regions[region][lang] = records
                regions[region][f"{lang}_count"] = len(records)
            except Exception as error:  # noqa: BLE001
                print(f"Warning: meter {region}/{lang} failed: {error}", file=sys.stderr)
                regions[region][lang] = []
    return regions


def collect_news() -> list[dict[str, str]]:
    notices: list[dict[str, str]] = []
    for feed_name, url in NEWS_FEEDS.items():
        try:
            notices.extend(parse_notices(fetch_bytes(url), feed_name))
        except Exception as error:  # noqa: BLE001
            print(f"Warning: news feed {feed_name} failed: {error}", file=sys.stderr)
    return notices


def collect_cameras() -> dict[str, list[dict[str, str]]]:
    cameras: dict[str, list[dict[str, str]]] = {}
    for lang, url in CAMERA_URLS.items():
        try:
            cameras[lang] = parse_cameras(fetch_bytes(url))
        except Exception as error:  # noqa: BLE001
            print(f"Warning: cameras {lang} failed: {error}", file=sys.stderr)
            cameras[lang] = []
    return cameras


def collect(root: Path) -> dict[str, Any]:
    collected_at = now_hkt()
    latest = root / "data" / "latest"
    meters = collect_meters()
    news = collect_news()
    cameras = collect_cameras()
    write_json(
        latest / "meters.json",
        {"collected_at": isoformat_hkt(collected_at), "regions": meters},
    )
    write_json(
        latest / "news.json",
        {"collected_at": isoformat_hkt(collected_at), "notices": news},
    )
    write_json(
        latest / "cameras.json",
        {"collected_at": isoformat_hkt(collected_at), "cameras": cameras},
    )
    return {
        "collected_at": isoformat_hkt(collected_at),
        "news_count": len(news),
        "camera_count": len(cameras.get("en") or []),
        "meter_regions": {name: value.get("en_count", 0) for name, value in meters.items()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect meters, news, and cameras")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    summary = collect(Path(args.root))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
