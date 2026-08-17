#!/usr/bin/env python3
"""Generate category announcement voiceovers (intro + pause + category name)."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

CONFIG_PATH = ROOT / "data" / "vo-category-intros.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "categories"
MANIFEST_PATH = OUT_DIR / "manifest.json"

LOWercase_WORDS = {"and", "or", "the"}


def slugify(name: str) -> str:
    s = name.lower().replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def mood_slug(mood: str) -> str:
    aliases = {
        "excitedly": "excitedly",
        "good mood happy": "happy",
    }
    return aliases.get(mood) or slugify(mood)


def spoken_category(name: str) -> str:
    words = name.split()
    out: list[str] = []
    for i, word in enumerate(words):
        lower = word.lower()
        if lower == "tv":
            out.append("TV")
        elif i > 0 and lower in LOWercase_WORDS:
            out.append(lower)
        else:
            out.append(word)
    return " ".join(out)


def normalize_intro(entry: str | dict, default_mood: str) -> tuple[str, str]:
    if isinstance(entry, str):
        return entry, default_mood
    return entry["text"], entry.get("mood") or default_mood


def build_line(intro: str, category: str, pause: str, mood: str, model_id: str) -> str:
    spoken = spoken_category(category)
    tagged = f"[{mood}] {intro}" if mood else intro
    if model_id == "eleven_v3":
        return f"{tagged}... {spoken}!"
    return f'{tagged} <break time="{pause}" /> {spoken}.'


def clip_entry(
    *,
    slug: str,
    category: str,
    intro: str,
    mood: str,
    text: str,
    mood_key: str,
) -> dict:
    filename = f"{slug}_{mood_key}.mp3"
    return {
        "slug": slug,
        "mood_key": mood_key,
        "category": category,
        "spoken": spoken_category(category),
        "intro": intro,
        "mood": mood,
        "text": text,
        "file": f"assets/audio/vo/categories/{filename}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate category VO clips")
    parser.add_argument(
        "--only-mood",
        help='Generate only this mood tag (e.g. "good mood happy")',
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip synthesis when the output MP3 already exists",
    )
    args = parser.parse_args()

    env = load_env()
    api_key = env.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("Missing ELEVENLABS_API_KEY in wheeloffortune/.env")

    voice_id = env.get("ELEVENLABS_VOICE_ID")
    if not voice_id:
        raise SystemExit("Missing ELEVENLABS_VOICE_ID in wheeloffortune/.env")

    model_id = env.get("ELEVENLABS_MODEL_ID") or "eleven_v3"
    stability = float(env.get("ELEVENLABS_STABILITY", "0.4"))
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    default_mood = config.get("default_mood", "enthusiastically")
    moods: list[str] = config.get("moods") or [default_mood]
    if args.only_mood:
        moods = [args.only_mood]

    intros: list[str | dict] = config["intros"]
    categories: list[str] = config["categories"]
    pause = config.get("pause", "0.9s")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"voice_id": voice_id, "model_id": model_id, "moods": moods, "clips": []}

    total = len(categories) * len(moods)
    step = 0

    for i, category in enumerate(categories):
        intro_text, _intro_mood = normalize_intro(intros[i % len(intros)], default_mood)
        slug = slugify(category)

        for mood in moods:
            step += 1
            mood_key = mood_slug(mood)
            text = build_line(intro_text, category, pause, mood, model_id)
            out_path = OUT_DIR / f"{slug}_{mood_key}.mp3"

            print(f"[{step}/{total}] {slug} ({mood!r})")
            print(f"  text:  {text!r}")

            if args.skip_existing and out_path.is_file():
                print(f"  -> skip existing {out_path.name}")
            else:
                audio = synthesize(api_key, voice_id, model_id, text, stability=stability)
                out_path.write_bytes(audio)
                print(f"  -> {out_path.name} ({len(audio):,} bytes)")
                time.sleep(0.35)

            manifest["clips"].append(
                clip_entry(
                    slug=slug,
                    category=category,
                    intro=intro_text,
                    mood=mood,
                    text=text,
                    mood_key=mood_key,
                )
            )

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {len(manifest['clips'])} clips -> {OUT_DIR}")
    print(f"Manifest -> {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
