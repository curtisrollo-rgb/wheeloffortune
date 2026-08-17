#!/usr/bin/env python3
"""Re-canonicalize puzzles-cdrom.json categories to match puzzles.json (76k bank)."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / "data" / "category_map.json"
OUT_PATHS = [
    ROOT / "data" / "puzzles-cdrom.json",
    ROOT / "server" / "data" / "puzzles-cdrom.json",
]


def python_title(text: str) -> str:
    return " ".join(
        word[:1].upper() + word[1:].lower() if word else ""
        for word in re.sub(r"\s+", " ", str(text or "").strip()).split(" ")
    )


def load_aliases() -> dict[str, str]:
    data = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    raw = data.get("aliases") or {}
    return {python_title(k): v for k, v in raw.items()}


def canonical_category(name: str, aliases: dict[str, str]) -> str:
    titled = python_title(name.replace("&", " And ").replace("/", " And ").replace("…", " "))
    return aliases.get(titled, titled)


def puzzle_key(answer: str, category: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", answer.upper()) + "|" + category.lower()


def remap_file(path: Path, aliases: dict[str, str]) -> Counter:
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    seen: set[str] = set()
    for item in data.get("puzzles", []):
        cat = canonical_category(item["category"], aliases)
        key = puzzle_key(item["answer"], cat)
        if key in seen:
            continue
        seen.add(key)
        out.append({**item, "category": cat})
    counts = Counter(p["category"] for p in out)
    data["puzzles"] = out
    data["count"] = len(out)
    data["category_count"] = len(counts)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return counts


def main() -> None:
    aliases = load_aliases()
    for path in OUT_PATHS:
        if not path.exists():
            print(f"Skip missing {path}")
            continue
        counts = remap_file(path, aliases)
        print(f"{path}: {sum(counts.values())} puzzles, {len(counts)} categories")
        for cat, n in counts.most_common():
            print(f"  {n:5d}  {cat}")


if __name__ == "__main__":
    main()
