#!/usr/bin/env python3
"""Generate SPA wedge prize voiceovers (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

SPAS_PATH = ROOT / "data" / "spa-prizes.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "spa-prizes"
MANIFEST_PATH = OUT_DIR / "manifest.json"

VO_PREFIX = "[excitedly]"
CONGRATS_PREFIX = "[excitedly]"
CONGRATS_TEXT = "Congratulations on your spa getaway!"


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

    data = json.loads(SPAS_PATH.read_text(encoding="utf-8"))
    spas = data["spas"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "spas").mkdir(exist_ok=True)

    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "vo_prefix": VO_PREFIX,
        "spas": [],
        "congrats": None,
    }

    total = len(spas) + 1
    step = 0

    for spa in spas:
        step += 1
        spoken = f"{VO_PREFIX} {spa['voText']}"
        out_path = OUT_DIR / "spas" / f"{spa['id']}.mp3"
        print(f"[{step}/{total}] {spa.get('display', spa['wording'])[:60]}...")
        synthesize(api_key, voice_id, spoken, out_path, model_id=model_id, stability=stability)
        manifest["spas"].append(
            {
                "id": spa["id"],
                "display": spa.get("display", ""),
                "voText": spa["voText"],
                "spoken": spoken,
                "file": f"assets/audio/vo/spa-prizes/spas/{spa['id']}.mp3",
            }
        )
        time.sleep(0.35)

    step += 1
    congrats_spoken = f"{CONGRATS_PREFIX} {CONGRATS_TEXT}"
    congrats_path = OUT_DIR / "spa_congrats.mp3"
    print(f"[{step}/{total}] congrats...")
    synthesize(api_key, voice_id, congrats_spoken, congrats_path, model_id=model_id, stability=stability)
    manifest["congrats"] = {
        "text": CONGRATS_TEXT,
        "spoken": congrats_spoken,
        "file": "assets/audio/vo/spa-prizes/spa_congrats.mp3",
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest['spas'])} spa clips → {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
