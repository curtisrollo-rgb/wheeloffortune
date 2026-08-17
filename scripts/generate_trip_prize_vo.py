#!/usr/bin/env python3
"""Generate TRIP wedge prize voiceovers (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

TRIPS_PATH = ROOT / "data" / "trip-prizes.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "trip-prizes"
MANIFEST_PATH = OUT_DIR / "manifest.json"

VO_PREFIX = "[excitedly]"
CONGRATS_PREFIX = "[excitedly]"
CONGRATS_TEXT = "Congratulations on your trip!"


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

    data = json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    trips = data["trips"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "trips").mkdir(exist_ok=True)

    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "vo_prefix": VO_PREFIX,
        "trips": [],
        "congrats": None,
    }

    total = len(trips) + 1
    step = 0

    for trip in trips:
        step += 1
        spoken = f"{VO_PREFIX} {trip['voText']}"
        out_path = OUT_DIR / "trips" / f"{trip['id']}.mp3"
        print(f"[{step}/{total}] {trip['wording'][:60]}...")
        print(f"  {spoken!r}")
        audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
        out_path.write_bytes(audio)
        print(f"  -> {out_path.name} ({len(audio):,} bytes)")
        manifest["trips"].append(
            {
                "id": trip["id"],
                "wording": trip["wording"],
                "congratsText": trip["congratsText"],
                "voText": trip["voText"],
                "spoken": spoken,
                "file": f"assets/audio/vo/trip-prizes/trips/{trip['id']}.mp3",
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
        "file": "assets/audio/vo/trip-prizes/congrats.mp3",
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {len(manifest['trips'])} trip clips + congrats -> {OUT_DIR}")


if __name__ == "__main__":
    main()
