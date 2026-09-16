#!/usr/bin/env python3
"""Run vacancy, feeds, forecast, then copy JSON for GitHub Pages."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from collect_feeds import collect as collect_feeds
from collect_vacancy import collect as collect_vacancy
from common import publish_latest_to_pages
from forecast import run as run_forecast


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect data, forecast, publish Pages JSON")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--skip-feeds", action="store_true")
    args = parser.parse_args(argv)
    root = Path(args.root)
    summary: dict = {"vacancy": collect_vacancy(root)}
    if not args.skip_feeds:
        summary["feeds"] = collect_feeds(root)
    summary["forecast"] = run_forecast(root)
    summary["pages"] = publish_latest_to_pages(root)
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
