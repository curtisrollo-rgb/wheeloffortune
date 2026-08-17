#!/usr/bin/env python3
"""Generate Wheel of Fortune voiceover MP3s via ElevenLabs API.

Usage (from repo root):
  cp wheeloffortune/.env.example wheeloffortune/.env   # add your key
  python3 wheeloffortune/scripts/generate_elevenlabs_vo.py --list-voices
  python3 wheeloffortune/scripts/generate_elevenlabs_vo.py
  python3 wheeloffortune/scripts/generate_elevenlabs_vo.py --id land_money
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
LINES_PATH = ROOT / "data" / "vo-lines.json"
OUT_DIR = ROOT / "assets" / "audio" / "vo"
API_BASE = "https://api.elevenlabs.io/v1"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    for key in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID", "ELEVENLABS_STABILITY"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def api_request(api_key: str, method: str, path: str, body: dict | None = None) -> bytes:
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json" if body is not None or path.endswith("voices") else "audio/mpeg",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"ElevenLabs API error {e.code}: {detail}") from e


def list_voices(api_key: str) -> None:
    raw = api_request(api_key, "GET", "/voices")
    data = json.loads(raw.decode())
    voices = data.get("voices") or data
    print(f"{'voice_id':<28} {'name'}")
    print("-" * 56)
    for v in voices:
        print(f"{v.get('voice_id', ''):<28} {v.get('name', '')}")


def synthesize(
    api_key: str,
    voice_id: str,
    model_id: str,
    text: str,
    *,
    stability: float = 0.4,
) -> bytes:
    path = f"/text-to-speech/{voice_id}"
    body = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {"stability": stability, "similarity_boost": 0.75},
    }
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"TTS error {e.code}: {detail}") from e


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate WoF voiceover via ElevenLabs")
    parser.add_argument("--list-voices", action="store_true", help="Print available voice IDs")
    parser.add_argument("--id", help="Generate only this line id from vo-lines.json")
    parser.add_argument("--text", help="Generate a one-off line (for testing)")
    parser.add_argument("--out", default="welcome_test.mp3", help="Output filename for --text")
    args = parser.parse_args()

    env = load_env()
    api_key = env.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit(f"Missing ELEVENLABS_API_KEY. Copy {ENV_PATH.name}.example to {ENV_PATH.name}")

    if args.list_voices:
        list_voices(api_key)
        return

    voice_id = env.get("ELEVENLABS_VOICE_ID")
    if not voice_id:
        raw = api_request(api_key, "GET", "/voices")
        voices = json.loads(raw.decode()).get("voices") or []
        if not voices:
            raise SystemExit("No voices on account. Set ELEVENLABS_VOICE_ID in .env")
        voice_id = voices[0]["voice_id"]
        print(f"Using first voice: {voices[0].get('name')} ({voice_id})")

    model_id = env.get("ELEVENLABS_MODEL_ID") or "eleven_v3"
    stability = float(env.get("ELEVENLABS_STABILITY", "0.4"))

    if args.text:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = OUT_DIR / args.out
        print(f"Generating test: {args.text!r}")
        audio = synthesize(api_key, voice_id, model_id, args.text, stability=stability)
        out_path.write_bytes(audio)
        print(f"  -> {out_path} ({len(audio):,} bytes)")
        return

    lines = json.loads(LINES_PATH.read_text())["lines"]
    if args.id:
        lines = [ln for ln in lines if ln["id"] == args.id]
        if not lines:
            raise SystemExit(f"Unknown line id: {args.id}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for line in lines:
        out_path = OUT_DIR / f"{line['id']}.mp3"
        print(f"Generating {line['id']}: {line['text']!r}")
        audio = synthesize(api_key, voice_id, model_id, line["text"], stability=stability)
        out_path.write_bytes(audio)
        print(f"  -> {out_path} ({len(audio):,} bytes)")


if __name__ == "__main__":
    main()
