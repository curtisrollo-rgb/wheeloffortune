#!/usr/bin/env python3
"""Generate consonant-miss voiceovers — generic + per-letter (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

CONFIG_PATH = ROOT / "data" / "vo-miss-lines.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "miss"
MANIFEST_PATH = OUT_DIR / "manifest.json"


def letter_label(ch: str) -> str:
    return ch.upper()


def fill_template(template: str, ch: str) -> str:
    label = letter_label(ch)
    return template.replace("{L}", label)


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
    prefix = config.get("tag_prefix", "[sympathetically]")
    templates: list[str] = config["templates"]
    letters = list(config.get("letters", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
    variants = int(config.get("variants_per_letter", 2))
    generic_lines: list[dict] = config["generic"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "tag_prefix": prefix,
        "generic": [],
        "byLetter": {},
    }

    step = 0
    total = len(generic_lines) + len(letters) * variants

    for line in generic_lines:
        step += 1
        spoken = f"{prefix} {line['text']}"
        out_path = OUT_DIR / f"{line['id']}.mp3"
        print(f"[{step}/{total}] generic/{line['id']}: {spoken!r}")
        audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
        out_path.write_bytes(audio)
        manifest["generic"].append(
            {
                "id": line["id"],
                "text": line["text"],
                "spoken": spoken,
                "file": f"assets/audio/vo/miss/{line['id']}.mp3",
            }
        )
        time.sleep(0.35)

    for li, ch in enumerate(letters):
        upper = letter_label(ch)
        manifest["byLetter"][upper] = []
        for vi in range(variants):
            step += 1
            template = templates[(li * variants + vi) % len(templates)]
            text = fill_template(template, upper)
            slug = f"letter_{upper.lower()}_{vi + 1}"
            spoken = f"{prefix} {text}"
            out_path = OUT_DIR / f"{slug}.mp3"
            print(f"[{step}/{total}] {upper} v{vi + 1}: {spoken!r}")
            audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
            out_path.write_bytes(audio)
            manifest["byLetter"][upper].append(
                {
                    "id": slug,
                    "letter": upper,
                    "text": text,
                    "spoken": spoken,
                    "file": f"assets/audio/vo/miss/{slug}.mp3",
                }
            )
            time.sleep(0.35)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"\nWrote {len(manifest['generic'])} generic + "
        f"{sum(len(v) for v in manifest['byLetter'].values())} letter clips -> {OUT_DIR}"
    )


if __name__ == "__main__":
    main()
