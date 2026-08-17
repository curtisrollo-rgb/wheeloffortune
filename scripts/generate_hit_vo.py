#!/usr/bin/env python3
"""Generate letter-hit voiceovers — one clip per letter for counts 1–3 (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

CONFIG_PATH = ROOT / "data" / "vo-hit-lines.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "hit"
MANIFEST_PATH = OUT_DIR / "manifest.json"


def fill_template(template: str, letter: str) -> str:
    return template.replace("{L}", letter.upper())


def main() -> None:
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
    prefix = config.get("tag_prefix", "[congratulatory]")
    letters = list(config.get("letters", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
    count_templates: dict[str, list[str]] = config["counts"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "tag_prefix": prefix,
        "byLetter": {},
    }

    step = 0
    total = len(letters) * len(count_templates)

    for li, ch in enumerate(letters):
        upper = ch.upper()
        manifest["byLetter"][upper] = {}
        for count_key, templates in count_templates.items():
            step += 1
            count = int(count_key)
            template = templates[li % len(templates)]
            text = fill_template(template, upper)
            slug = f"hit_{upper.lower()}_{count}"
            spoken = f"{prefix} {text}"
            out_path = OUT_DIR / f"{slug}.mp3"
            print(f"[{step}/{total}] {upper} x{count}: {spoken!r}")
            audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
            out_path.write_bytes(audio)
            manifest["byLetter"][upper][str(count)] = {
                "id": slug,
                "letter": upper,
                "count": count,
                "text": text,
                "spoken": spoken,
                "file": f"assets/audio/vo/hit/{slug}.mp3",
            }
            time.sleep(0.35)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    clip_count = sum(len(v) for v in manifest["byLetter"].values())
    print(f"\nWrote {clip_count} hit clips -> {OUT_DIR}")


if __name__ == "__main__":
    main()
