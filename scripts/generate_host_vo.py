#!/usr/bin/env python3
"""Generate TV host announcer voiceovers with variations (ElevenLabs v3)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_elevenlabs_vo import load_env, synthesize  # noqa: E402

CONFIG_PATH = ROOT / "data" / "vo-host-lines.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo" / "host"
MANIFEST_PATH = OUT_DIR / "manifest.json"


def fill(template: str, letter: str) -> str:
    return template.replace("{L}", letter.upper())


def generate_pool(
    api_key: str,
    voice_id: str,
    model_id: str,
    stability: float,
    prefix: str,
    pool_key: str,
    lines: list[dict],
    manifest_pool: list,
    step: list,
    total: int,
    *,
    resume: bool,
) -> None:
    for line in lines:
        out_path = OUT_DIR / f"{line['id']}.mp3"
        spoken = f"{prefix} {line['text']}"
        if resume and out_path.is_file():
            manifest_pool.append(
                {
                    "id": line["id"],
                    "text": line["text"],
                    "spoken": spoken,
                    "file": f"assets/audio/vo/host/{line['id']}.mp3",
                }
            )
            continue
        step[0] += 1
        print(f"[{step[0]}/{total}] {pool_key}/{line['id']}: {spoken!r}")
        audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
        out_path.write_bytes(audio)
        manifest_pool.append(
            {
                "id": line["id"],
                "text": line["text"],
                "spoken": spoken,
                "file": f"assets/audio/vo/host/{line['id']}.mp3",
            }
        )
        time.sleep(0.35)


def write_manifest_from_disk(config: dict) -> None:
    prefix = config.get("tag_prefix", "[excitedly]")
    pick_prefix = config.get("pick_prefix", prefix)
    pick_templates = config.get("pick_templates") or ["The letter {L}."]
    pick_variants = int(config.get("pick_variants_per_letter", 2))
    vowel_prefix = config.get("vowel_prefix", prefix)
    vowel_templates = config.get("vowel_templates") or ["I'd like to buy an {L}."]

    manifest = {
        "voice_id": "",
        "model_id": "eleven_v3",
        "tag_prefix": prefix,
        "welcome": [],
        "turnSpin": [],
        "solveAttempt": [],
        "buyVowel": [],
        "pickByLetter": {},
        "vowelByLetter": {},
    }

    def add(pool, clip_id, text, tag):
        if not (OUT_DIR / f"{clip_id}.mp3").is_file():
            return
        pool.append(
            {
                "id": clip_id,
                "text": text,
                "spoken": f"{tag} {text}",
                "file": f"assets/audio/vo/host/{clip_id}.mp3",
            }
        )

    for line in config.get("welcome", []):
        add(manifest["welcome"], line["id"], line["text"], prefix)
    for line in config.get("turn_spin", []):
        add(manifest["turnSpin"], line["id"], line["text"], prefix)
    for line in config.get("solve_attempt", []):
        add(manifest["solveAttempt"], line["id"], line["text"], prefix)
    for line in config.get("buy_vowel", []):
        add(manifest["buyVowel"], line["id"], line["text"], prefix)

    for ch in config.get("letters", ""):
        upper = ch.upper()
        clips = []
        for vi in range(pick_variants):
            text = fill(pick_templates[vi % len(pick_templates)], upper)
            clip_id = f"pick_{upper}_{vi + 1:02d}"
            add(clips, clip_id, text, pick_prefix)
        if clips:
            manifest["pickByLetter"][upper] = clips

    for ch in config.get("vowels", "AEIOU"):
        upper = ch.upper()
        clips = []
        for ti, template in enumerate(vowel_templates):
            text = fill(template, upper)
            clip_id = f"vowel_{upper}_{ti + 1:02d}"
            add(clips, clip_id, text, vowel_prefix)
        if clips:
            manifest["vowelByLetter"][upper] = clips

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = (
        len(manifest["welcome"])
        + len(manifest["turnSpin"])
        + len(manifest["solveAttempt"])
        + len(manifest["buyVowel"])
        + sum(len(v) for v in manifest["pickByLetter"].values())
        + sum(len(v) for v in manifest["vowelByLetter"].values())
    )
    print(f"Rebuilt manifest with {total} clips -> {MANIFEST_PATH}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Generate TV host announcer VO")
    parser.add_argument("--resume", action="store_true", help="Skip clips that already exist")
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="Rebuild manifest.json from MP3 files on disk (no API calls)",
    )
    args = parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    if args.manifest_only:
        write_manifest_from_disk(config)
        return

    env = load_env()
    api_key = env.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("Missing ELEVENLABS_API_KEY in wheeloffortune/.env")

    voice_id = env.get("ELEVENLABS_VOICE_ID")
    if not voice_id:
        raise SystemExit("Missing ELEVENLABS_VOICE_ID in wheeloffortune/.env")

    model_id = env.get("ELEVENLABS_MODEL_ID") or "eleven_v3"
    stability = float(env.get("ELEVENLABS_STABILITY", "0.4"))
    prefix = config.get("tag_prefix", "[excitedly]")

    letters = list(config.get("letters", ""))
    vowels = list(config.get("vowels", "AEIOU"))
    pick_variants = int(config.get("pick_variants_per_letter", 2))
    pick_templates = config.get("pick_templates") or ["The letter {L}."]
    vowel_templates = config.get("vowel_templates") or ["I'd like to buy an {L}."]

    total = (
        len(config.get("welcome", []))
        + len(config.get("turn_spin", []))
        + len(config.get("solve_attempt", []))
        + len(config.get("buy_vowel", []))
        + len(letters) * pick_variants
        + len(vowels) * len(vowel_templates)
    )
    if args.resume:
        existing = len(list(OUT_DIR.glob("*.mp3")))
        total = max(total - existing, 0)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "voice_id": voice_id,
        "model_id": model_id,
        "tag_prefix": prefix,
        "welcome": [],
        "turnSpin": [],
        "solveAttempt": [],
        "buyVowel": [],
        "pickByLetter": {},
        "vowelByLetter": {},
    }

    step = [0]

    generate_pool(
        api_key, voice_id, model_id, stability, prefix,
        "welcome", config.get("welcome", []), manifest["welcome"], step, total, resume=args.resume,
    )
    generate_pool(
        api_key, voice_id, model_id, stability, prefix,
        "turnSpin", config.get("turn_spin", []), manifest["turnSpin"], step, total, resume=args.resume,
    )
    generate_pool(
        api_key, voice_id, model_id, stability, prefix,
        "solveAttempt", config.get("solve_attempt", []), manifest["solveAttempt"], step, total, resume=args.resume,
    )
    generate_pool(
        api_key, voice_id, model_id, stability, prefix,
        "buyVowel", config.get("buy_vowel", []), manifest["buyVowel"], step, total, resume=args.resume,
    )

    pick_prefix = config.get("pick_prefix", prefix)
    for ch in letters:
        upper = ch.upper()
        manifest["pickByLetter"][upper] = []
        for vi in range(pick_variants):
            template = pick_templates[vi % len(pick_templates)]
            text = fill(template, upper)
            clip_id = f"pick_{upper}_{vi + 1:02d}"
            spoken = f"{pick_prefix} {text}"
            out_path = OUT_DIR / f"{clip_id}.mp3"
            if args.resume and out_path.is_file():
                manifest["pickByLetter"][upper].append(
                    {
                        "id": clip_id,
                        "text": text,
                        "spoken": spoken,
                        "file": f"assets/audio/vo/host/{clip_id}.mp3",
                    }
                )
                continue
            step[0] += 1
            print(f"[{step[0]}/{total}] pick/{upper}/{clip_id}: {spoken!r}")
            audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
            out_path.write_bytes(audio)
            manifest["pickByLetter"][upper].append(
                {
                    "id": clip_id,
                    "text": text,
                    "spoken": spoken,
                    "file": f"assets/audio/vo/host/{clip_id}.mp3",
                }
            )
            time.sleep(0.35)
        if not manifest["pickByLetter"][upper]:
            del manifest["pickByLetter"][upper]

    vowel_prefix = config.get("vowel_prefix", prefix)
    for ch in vowels:
        upper = ch.upper()
        manifest["vowelByLetter"][upper] = []
        for ti, template in enumerate(vowel_templates):
            text = fill(template, upper)
            clip_id = f"vowel_{upper}_{ti + 1:02d}"
            spoken = f"{vowel_prefix} {text}"
            out_path = OUT_DIR / f"{clip_id}.mp3"
            if args.resume and out_path.is_file():
                manifest["vowelByLetter"][upper].append(
                    {
                        "id": clip_id,
                        "text": text,
                        "spoken": spoken,
                        "file": f"assets/audio/vo/host/{clip_id}.mp3",
                    }
                )
                continue
            step[0] += 1
            print(f"[{step[0]}/{total}] vowel/{upper}/{clip_id}: {spoken!r}")
            audio = synthesize(api_key, voice_id, model_id, spoken, stability=stability)
            out_path.write_bytes(audio)
            manifest["vowelByLetter"][upper].append(
                {
                    "id": clip_id,
                    "text": text,
                    "spoken": spoken,
                    "file": f"assets/audio/vo/host/{clip_id}.mp3",
                }
            )
            time.sleep(0.35)
        if not manifest["vowelByLetter"][upper]:
            del manifest["vowelByLetter"][upper]

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {step[0]} host VO clips -> {OUT_DIR}")


if __name__ == "__main__":
    main()
