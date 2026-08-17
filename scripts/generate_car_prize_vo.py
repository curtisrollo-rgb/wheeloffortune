#!/usr/bin/env python3
"""Generate CAR wedge prize voiceovers (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

CARS_PATH = ROOT / "data" / "car-prizes.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "car-prizes"
MANIFEST_PATH = OUT_DIR / "manifest.json"

WIN_PREFIX = "[excitedly]"
WIN_INTRO = "You've won"
CONGRATS_PREFIX = "[excitedly]"
CONGRATS_TEXT = "Congratulations on your new car!"


def article(name: str) -> str:
    word = name.strip().split()[0].lower()
    if word in {"audi", "a3"} or word[0] in "aeiou":
        return "an"
    return "a"


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

    data = json.loads(CARS_PATH.read_text(encoding="utf-8"))
    cars = data["cars"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cars").mkdir(exist_ok=True)

    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "win_prefix": WIN_PREFIX,
        "win_intro": WIN_INTRO,
        "cars": [],
        "congrats": None,
    }

    total = len(cars) + 1
    step = 0

    for car in cars:
        step += 1
        spoken_name = f"{article(car['name'])} {car['name']}!"
        spoken = f"{WIN_PREFIX} {WIN_INTRO}... {spoken_name}"
        out_path = OUT_DIR / "cars" / f"{car['id']}.mp3"
        print(f"[{step}/{total}] {car['name']}: {spoken!r}")
        audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
        out_path.write_bytes(audio)
        print(f"  -> {out_path.name} ({len(audio):,} bytes)")
        manifest["cars"].append(
            {
                "id": car["id"],
                "name": car["name"],
                "spoken": spoken,
                "file": f"assets/audio/vo/car-prizes/cars/{car['id']}.mp3",
            }
        )
        time.sleep(0.35)

    step += 1
    congrats_spoken = f"{CONGRATS_PREFIX} {CONGRATS_TEXT}"
    congrats_path = OUT_DIR / "congrats.mp3"
    print(f"[{step}/{total}] congrats: {congrats_spoken!r}")
    audio = synthesize(api_key, voice_id, model_id, congrats_spoken, stability=stability)
    congrats_path.write_bytes(audio)
    manifest["congrats"] = {
        "text": CONGRATS_TEXT,
        "spoken": congrats_spoken,
        "file": "assets/audio/vo/car-prizes/congrats.mp3",
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {len(manifest['cars'])} car clips + congrats -> {OUT_DIR}")


if __name__ == "__main__":
    main()
