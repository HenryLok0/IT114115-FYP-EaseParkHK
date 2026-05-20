#!/usr/bin/env python3
"""
Generate sitemap.xml for EaseParkHK public pages.
Fetches car park IDs from government open data APIs.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET

import requests

BASE_URL = os.environ.get("SITE_BASE_URL", "https://easeparkhk.henrylok.me").rstrip("/")
INFO_EN_URL = "https://api.data.gov.hk/v1/carpark-info-vacancy"
INFO_ZH_URL = "https://resource.data.one.gov.hk/td/carpark/basic_info_all.json"
REQUEST_TIMEOUT = 120

# District slugs match navbar links in app/templates/indexbase.html.j2
DISTRICTS = [
    "Central & Western",
    "Wan Chai",
    "Eastern",
    "Southern",
    "Yau Tsim Mong",
    "Sham Shui Po",
    "Kowloon City",
    "Wong Tai Sin",
    "Kwun Tong",
    "Kwai Tsing",
    "Tsuen Wan",
    "Yuen Long",
    "Tuen Mun",
    "North",
    "Tai Po",
    "Sha Tin",
    "Sai Kung",
    "Islands",
]

# Public GET pages (no POST-only, tokens, or per-user URLs)
STATIC_PAGES = [
    ("/", "daily", "1.0"),
    ("/zh", "daily", "1.0"),
    ("/hong_kong_island", "daily", "0.9"),
    ("/kowloon", "daily", "0.9"),
    ("/new_territories", "daily", "0.9"),
    ("/zh/hong_kong_island", "daily", "0.9"),
    ("/zh/kowloon", "daily", "0.9"),
    ("/zh/new_territories", "daily", "0.9"),
    ("/metered_parking_spaces_hong_kong_island", "weekly", "0.8"),
    ("/metered_parking_spaces_kowloon", "weekly", "0.8"),
    ("/metered_parking_spaces_new_territories", "weekly", "0.8"),
    ("/zh/metered_parking_spaces_hong_kong_island", "weekly", "0.8"),
    ("/zh/metered_parking_spaces_kowloon", "weekly", "0.8"),
    ("/zh/metered_parking_spaces_new_territories", "weekly", "0.8"),
    ("/camera", "hourly", "0.8"),
    ("/zh/camera", "hourly", "0.8"),
    ("/news", "hourly", "0.8"),
    ("/zh/news", "hourly", "0.8"),
    ("/privacy_policy", "monthly", "0.5"),
    ("/ai-chatbox", "monthly", "0.6"),
    ("/carparkinfo", "daily", "0.7"),
    ("/login", "monthly", "0.4"),
    ("/register", "monthly", "0.4"),
    ("/settings", "monthly", "0.4"),
    ("/reset_password_request", "monthly", "0.3"),
    ("/zh/login", "monthly", "0.4"),
    ("/zh/register", "monthly", "0.4"),
    ("/zh/settings", "monthly", "0.4"),
    ("/zh/reset_password_request", "monthly", "0.3"),
]


def district_path(district: str, *, zh: bool = False) -> str:
    slug = quote(district, safe="&")
    prefix = "/zh" if zh else ""
    return f"{prefix}/carparkinfo/{slug}"


def fetch_park_ids() -> list[str]:
    """Collect unique car park IDs from EN and ZH open data sources."""
    ids: set[str] = set()

    en_res = requests.get(INFO_EN_URL, timeout=REQUEST_TIMEOUT)
    en_res.raise_for_status()
    for item in en_res.json().get("results", []):
        park_id = item.get("park_Id")
        if park_id:
            ids.add(str(park_id))

    zh_res = requests.get(INFO_ZH_URL, timeout=REQUEST_TIMEOUT)
    zh_res.raise_for_status()
    zh_data = json.loads(zh_res.content.decode("utf-8-sig"))
    for item in zh_data.get("car_park", []):
        park_id = item.get("park_id")
        if park_id:
            ids.add(str(park_id))

    return sorted(ids)


def carpark_path(park_id: str, *, zh: bool = False) -> str:
    slug = quote(park_id, safe="")
    prefix = "/zh" if zh else ""
    return f"{prefix}/carpark/{slug}"


def build_url_entries() -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = list(STATIC_PAGES)

    for district in DISTRICTS:
        entries.append((district_path(district), "daily", "0.85"))
        entries.append((district_path(district, zh=True), "daily", "0.85"))

    for park_id in fetch_park_ids():
        entries.append((carpark_path(park_id), "hourly", "0.7"))
        entries.append((carpark_path(park_id, zh=True), "hourly", "0.7"))

    return entries


def render_sitemap(entries: list[tuple[str, str, str]]) -> str:
    lastmod = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    for path, changefreq, priority in entries:
        url = ET.SubElement(urlset, "url")
        ET.SubElement(url, "loc").text = f"{BASE_URL}{path}"
        ET.SubElement(url, "lastmod").text = lastmod
        ET.SubElement(url, "changefreq").text = changefreq
        ET.SubElement(url, "priority").text = priority

    ET.indent(urlset, space="  ")
    xml_body = ET.tostring(urlset, encoding="unicode", xml_declaration=False)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_body + "\n"


def render_robots() -> str:
    return f"User-agent: *\nAllow: /\n\nSitemap: {BASE_URL}/sitemap.xml\n"


def write_outputs(content: str, robots: str) -> None:
    repo_root = Path(__file__).resolve().parent.parent
    targets = [
        repo_root / "sitemap.xml",
        repo_root / "app" / "static" / "sitemap.xml",
        repo_root / "app" / "static" / "robots.txt",
        repo_root / "robots.txt",
    ]
    for path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.name == "robots.txt":
            path.write_text(robots, encoding="utf-8")
        else:
            path.write_text(content, encoding="utf-8")
        print(f"Wrote {path}")


def main() -> int:
    try:
        entries = build_url_entries()
        xml = render_sitemap(entries)
        robots = render_robots()
        write_outputs(xml, robots)
        print(f"Generated {len(entries)} URLs for {BASE_URL}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
