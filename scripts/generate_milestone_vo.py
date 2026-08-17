#!/usr/bin/env python3
"""Generate milestone announcement voiceovers (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

CONFIG_PATH = ROOT / "data" / "vo-milestone-lines.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "milestones"
MANIFEST_PATH = OUT_DIR / "manifest.json"


def generate_set(
    *,
    api_key: str,
    voice_id: str,
    model_id: str,
    stability: float,
    prefix: str,
    key: str,
    lines: list[dict],
    manifest: dict,
) -> None:
    manifest[key] = []
    for i, line in enumerate(lines):
        spoken = f"{prefix} {line['text']}"
        out_path = OUT_DIR / f"{line['id']}.mp3"
        print(f"[{key}] [{i + 1}/{len(lines)}] {line['id']}: {spoken!r}")
        audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
        out_path.write_bytes(audio)
        print(f"  -> {out_path.name} ({len(audio):,} bytes)")
        manifest[key].append(
            {
                "id": line["id"],
                "text": line["text"],
                "spoken": spoken,
                "file": f"assets/audio/vo/milestones/{line['id']}.mp3",
            }
        )
        time.sleep(0.35)


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
    prefix = config.get("tag_prefix", "[excitedly]")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "tag_prefix": prefix,
        "onlyVowelsRemain": [],
        "noMoreVowels": [],
    }

    generate_set(
        api_key=api_key,
        voice_id=voice_id,
        model_id=model_id,
        stability=stability,
        prefix=prefix,
        key="onlyVowelsRemain",
        lines=config["only_vowels_remain"],
        manifest=manifest,
    )
    generate_set(
        api_key=api_key,
        voice_id=voice_id,
        model_id=model_id,
        stability=stability,
        prefix=prefix,
        key="noMoreVowels",
        lines=config["no_more_vowels"],
        manifest=manifest,
    )

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = len(manifest["onlyVowelsRemain"]) + len(manifest["noMoreVowels"])
    print(f"\nWrote {total} clips -> {OUT_DIR}")


if __name__ == "__main__":
    main()
