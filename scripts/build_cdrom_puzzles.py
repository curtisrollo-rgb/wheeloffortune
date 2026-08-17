#!/usr/bin/env python3
"""Build Hasbro CD-ROM era puzzle bank from Game-Rave extraction guides.

Sources:
  - PS1 / Windows / Mac (1998) — game-rave.com/?p=27337 (~2,400 puzzles)
  - Wheel of Fortune 2 (2000) — game-rave.com/?p=29020 (~2,500 puzzles)
  - Supplemental category JSON (community PS1-style dump)

PS2 (2003): no public extraction guide found; add manually if a ROM dump is available.

Usage:
  python3 scripts/build_cdrom_puzzles.py
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATHS = [
    ROOT / "server" / "data" / "puzzles-cdrom.json",
    ROOT / "data" / "puzzles-cdrom.json",
]
CATEGORY_MAP_PATH = ROOT / "data" / "category_map.json"
MOTZKUS_URL = (
    "https://gist.githubusercontent.com/michaelmotzkus/"
    "de82e06c8538399909103108049788b9/raw/phrases.json"
)

CDROM_EXTRA_ALIASES = {
    "Fict. Char.": "Fictional Character",
    "Fict Chars.": "Fictional Character",
    "Fic. Char.": "Fictional Character",
    "Fic. Chars.": "Fictional Character",
    "Prop.name": "Proper Name",
    "Prop.names": "Proper Name",
    "Prop Name": "Proper Name",
    "Prop Names": "Proper Name",
    "Husb.&wife": "People",
    "Husband And Wife": "People",
    "Wherearewe?": "Place",
    "Where Are We?": "Place",
    "Who Is It?": "Proper Name",
    "Who Said It?": "Phrase",
    "Fill In…1st": "Phrase",
    "Fill In…last": "Phrase",
    "Fill In The Blanks": "Phrase",
    "Fill In The Number": "Phrase",
    "Next Line Please": "Phrase",
    "Classic Tv": "Tv Show Title",
    "Song&artist": "Song Title",
    "The 60's": "Decade",
    "The 70's": "Decade",
    "The 80's": "Decade",
    "The 90's": "Decade",
    "The 90s": "Decade",
    "Around The House": "Around The House",
    "On The Map": "Place",
    "Rhyme Time": "Rhyme Time",
    "Final Round": "Phrase",
}

GUIDES = [
    {
        "game": "hasbro-1998",
        "title": "Wheel of Fortune (1998)",
        "url": "https://game-rave.com/?p=27337",
    },
    {
        "game": "hasbro-2000",
        "title": "Wheel of Fortune: 2nd Edition (2000)",
        "url": "https://game-rave.com/?p=29020",
    },
]

SKIP_HEADERS = {
    "standard puzzles",
    "bonus round",
    "left to do:",
    "fill in the blank (first word)",
    "fill in the blank (last word)",
    "fill in the blanks",
    "fill in the number",
}

SKIP_LINE_PREFIXES = (
    "http",
    "version ",
    "written by",
    "welcome to",
    "this guide",
    "to use the guide",
    "please note",
    "these puzzles",
    "for ",
    "left to do",
    "#####",
)


def strip_html(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def normalize_category_name(name: str) -> str:
    name = strip_html(name)
    name = re.sub(r"\s*-\s*Bonus Round\s*$", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def python_title(text: str) -> str:
    text = strip_html(text)
    return " ".join(
        word[:1].upper() + word[1:].lower() if word else ""
        for word in re.sub(r"\s+", " ", text.strip()).split(" ")
    )


def load_aliases() -> dict[str, str]:
    merged = {python_title(k): v for k, v in CDROM_EXTRA_ALIASES.items()}
    if CATEGORY_MAP_PATH.exists():
        data = json.loads(CATEGORY_MAP_PATH.read_text(encoding="utf-8"))
        raw = data.get("aliases") or {}
        merged.update({python_title(k): v for k, v in raw.items()})
    return merged


def canonical_category(name: str, aliases: dict[str, str]) -> str:
    cleaned = normalize_category_name(name)
    titled = python_title(
        cleaned.replace("&", " And ")
        .replace("/", " And ")
        .replace("…", " ")
    )
    return aliases.get(titled, titled)


def normalize_answer(raw: str) -> str:
    text = strip_html(raw).upper()
    text = text.replace("’", "'").replace("`", "'")
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("&", " AND ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_plus_answers(raw: str) -> str | None:
    matches = re.findall(r"\+\+\s*(.+?)\s*\+\+", raw, flags=re.I)
    if not matches:
        return None
    if "?" in raw and len(matches) == 1:
        return normalize_answer(matches[0])
    if len(matches) == 1:
        return normalize_answer(matches[0])
    return normalize_answer(" ".join(matches))


def clean_answer_line(raw: str) -> str | None:
    line = raw.strip()
    if not line:
        return None
    if line.startswith("-"):
        line = line[1:].strip()
    if "++" in line:
        extracted = extract_plus_answers(line)
        if extracted:
            return extracted
    if "/" in line and "++" not in line:
        parts = [p.strip() for p in line.split("/") if p.strip()]
        line = parts[0] if parts else line
    if "?" in line:
        return None
    answer = normalize_answer(line)
    if len(answer) < 2:
        return None
    if answer in {"FEET", "LEGS", "WINGS"} and len(line) < 20:
        return None
    return answer


def is_category_header(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("-") or stripped.startswith("#"):
        return False
    lower = stripped.lower()
    if any(lower.startswith(p) for p in SKIP_LINE_PREFIXES):
        return False
    if lower in SKIP_HEADERS:
        return False
    if len(stripped) > 70:
        return False
    if re.search(r"[.!?]", stripped):
        return False
    if not re.match(r"^[A-Za-z0-9&'/,\s–-]+$", stripped):
        return False
    return True


def parse_game_rave_html(html: str, game_id: str, aliases: dict[str, str]) -> list[dict]:
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.I | re.S)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.I | re.S)

    puzzles: list[dict] = []
    parts = re.split(r"<strong[^>]*>(.*?)</strong>", html, flags=re.I | re.S)

    for i in range(1, len(parts), 2):
        category_raw = normalize_category_name(re.sub(r"<[^>]+>", "", parts[i]).strip())
        if not category_raw or len(category_raw) > 70:
            continue
        if category_raw.lower() in SKIP_HEADERS:
            continue
        if category_raw.lower().endswith("bonus round"):
            continue

        chunk = parts[i + 1] if i + 1 < len(parts) else ""
        for raw_item in re.findall(r"<li[^>]*>(.*?)</li>", chunk, flags=re.I | re.S):
            text = strip_html(raw_item)
            if not text or "dataLayer" in text:
                continue
            answer = clean_answer_line(text)
            if not answer:
                continue
            cat = canonical_category(category_raw, aliases)
            puzzles.append(
                {
                    "category": cat,
                    "answer": answer,
                    "source": game_id,
                }
            )

    return puzzles


def parse_game_rave_markdown(text: str, game_id: str, aliases: dict[str, str]) -> list[dict]:
    puzzles: list[dict] = []
    current_cat: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("- "):
            answer = clean_answer_line(line)
            if answer and current_cat:
                cat = canonical_category(current_cat, aliases)
                puzzles.append(
                    {
                        "category": cat,
                        "answer": answer,
                        "source": game_id,
                    }
                )
            continue
        if is_category_header(line):
            current_cat = line

    return puzzles


def fetch_url(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "wheeloffortune-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def load_motzkus(aliases: dict[str, str]) -> list[dict]:
    try:
        req = urllib.request.Request(MOTZKUS_URL, headers={"User-Agent": "wheeloffortune-build/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(f"  motzkus skip: {exc}")
        return []

    puzzles = []
    for category, phrases in data.items():
        cat = canonical_category(category, aliases)
        for phrase in phrases:
            answer = clean_answer_line(phrase)
            if answer:
                puzzles.append(
                    {
                        "category": cat,
                        "answer": answer,
                        "source": "hasbro-1998-supplement",
                    }
                )
    return puzzles


def puzzle_key(answer: str, category: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", answer.upper()) + "|" + category.lower()


def dedupe_puzzles(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        key = puzzle_key(item["answer"], item["category"])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def assign_ids(puzzles: list[dict]) -> list[dict]:
    out = []
    for p in puzzles:
        digest = hashlib.sha1(f"{p['source']}|{p['category']}|{p['answer']}".encode()).hexdigest()[:12]
        out.append({**p, "id": f"cdrom-{digest}"})
    return out


def main() -> None:
    aliases = load_aliases()
    all_puzzles: list[dict] = []

    for guide in GUIDES:
        print(f"Fetching {guide['title']}…")
        html = fetch_url(guide["url"])
        parsed = parse_game_rave_html(html, guide["game"], aliases)
        if not parsed:
            parsed = parse_game_rave_markdown(html, guide["game"], aliases)
        print(f"  parsed {len(parsed)} puzzles")
        all_puzzles.extend(parsed)

    print("Fetching supplemental PS1-style phrase dump…")
    all_puzzles.extend(load_motzkus(aliases))

    merged = dedupe_puzzles(all_puzzles)
    merged = assign_ids(merged)

    by_source: dict[str, int] = {}
    for p in merged:
        by_source[p["source"]] = by_source.get(p["source"], 0) + 1

    payload = {
        "version": 1,
        "description": "Hasbro / Artech CD-ROM era puzzles (1998 PS1 + 2000 2nd Edition; PS2 2003 TBD)",
        "sources": [g["title"] for g in GUIDES],
        "count": len(merged),
        "by_source": by_source,
        "puzzles": merged,
    }

    for path in OUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {path} ({len(merged)} puzzles)")

    print("By source:", by_source)


if __name__ == "__main__":
    main()
