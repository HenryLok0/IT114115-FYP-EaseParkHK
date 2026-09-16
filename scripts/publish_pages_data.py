#!/usr/bin/env python3
"""Copy latest dataset files into docs/data for GitHub Pages."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import publish_latest_to_pages


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish latest JSON to docs/data")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    copied = publish_latest_to_pages(Path(args.root))
    print(json.dumps({"copied": copied}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
