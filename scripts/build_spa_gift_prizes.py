#!/usr/bin/env python3
"""Build spa-prizes.json and gift-prizes.json from Andy Nguyen archive SPA/GIFT wedge data."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

VO_INTROS = ["Great news!", "Congratulations!", "Congrats!", "Good work!", "You've won!"]
CONGRATS_TEMPLATES = [
    "Congratulations, you've won {core}!",
    "Congrats, you've won {core}!",
    "Good work — you've won {core}!",
    "You've won {core}!",
]


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text[:80] or "prize"


def build_vo_lines(core: str, idx: int) -> tuple[str, str]:
    congrats = CONGRATS_TEMPLATES[idx % len(CONGRATS_TEMPLATES)].format(core=core)
    intro = VO_INTROS[idx % len(VO_INTROS)]
    vo = f"{intro} {congrats}"
    return congrats, vo


# Curated from Andy Nguyen archive — FEATURED SPA TRIP + spa-focused wedge prizes.
SPA_SOURCE = [
    ("FEATURED SPA TRIP: Shangri-La Hotel in Vancouver", 7700, "archive"),
    ("FEATURED SPA TRIP: Argentario Gold Resort & Spa in Italy from Spa Finder Wellness", 7200, "archive"),
    ("FEATURED SPA TRIP: Aventura Spa Palace in Mexico w/ Mexicana Airlines airfare", 7000, "archive"),
    ("FEATURED SPA TRIP: El Conquistador Resort in Puerto Rico", 6700, "archive"),
    ("FEATURED SPA TRIP: Westin Maui Resort & Spa Ka'anapali", 6640, "archive"),
    (
        "FEATURED SPA TRIP: Radisson Aruba Resort & Casino (incl. a day of pampering at Larimar Spa)",
        6500,
        "archive",
    ),
    (
        "FEATURED PRIZE: spa vacation to Safety Harbor Spa & Fitness Center in Tampa, FL via Delta airlines",
        7098,
        "archive",
    ),
    ("TRIP ON THE WHEEL: Gran Velas All Suites & Spa Resort in Nuevo Vallarta", 9600, "archive"),
    ("FEATURED TRIP: Zoëtry Curaçao Resort & Spa (includes an underwater walking tour)", 9470, "archive"),
    ("FEATURED TRIP: Thermae Sylla Spa Wellness Hotel in GREECE", 7134, "spa_resort"),
    ("FEATURED TRIP: to the Salish Lodge & Spa in Washington", 5000, "spa_resort"),
    ("FEATURED TRIP: Springs Resort & Spa in COSTA RICA", 6800, "spa_resort"),
    ("FEATURED TRIP: the Silverado Resort & Spa in Napa Valley", 9250, "spa_resort"),
    ("FEATURED TRIP: Mirror Lake Inn Resort & Spa in Lake Placid, NY", 8000, "spa_resort"),
    ("Trip to Club BARBADOS Resort & Spa", 9680, "spa_resort"),
    ("Trip to Salterra Luxury Collection Resort & Spa in TURKS & CAICOS", 10670, "spa_resort"),
    ("Trip to Corazon Cabo Resort & Spa in MEXICO", 8000, "spa_resort"),
    ("Trip to Hyatt Regency MAUI Resort & Spa", 7700, "spa_resort"),
    ("Trip to Outrigger KAUAI Beach Resort & Spa", 8500, "spa_resort"),
    ("Trip to TIA Wellness Resort in VIETNAM", 8082, "spa_resort"),
]

# Curated GIFT / gift-tag style prizes from archive FEATURED PRIZE entries.
# kind: cash_card | shopping_spree | gift_certificate | merchandise_bundle
GIFT_SOURCE = [
    ("$1,000 Gift Card", 1000, "cash_card", "Generic spend-anywhere gift card (modern wedge style)"),
    ("FEATURED PRIZE: shopping spree at The Sharper Image", 1000, "shopping_spree", "archive"),
    ("FEATURED PRIZE: 1-800-Gift Certificate", 2500, "gift_certificate", "archive"),
    ("FEATURED PRIZE: Giorgio Armani shopping spree", 2500, "shopping_spree", "archive"),
    ("FEATURED PRIZE: NOVICA gift certificate", 2500, "gift_certificate", "archive"),
    ("FEATURED PRIZE #1: Ghurka leather gift certificate", 2500, "gift_certificate", "archive"),
    (
        "FEATURED PRIZE: Co-Pilot navigation software plus Comp USA shopping spree",
        2500,
        "merchandise_bundle",
        "archive",
    ),
    (
        "FEATURED PRIZE: Maui Jim sunglasses + some cash for a beach party",
        2500,
        "merchandise_bundle",
        "archive",
    ),
    (
        "FEATURED PRIZE #3: Service Merchandise GC used to buy a diamond and ruby heart pendant",
        3000,
        "gift_certificate",
        "archive",
    ),
    (
        "FEATURED PRIZE: Fred Joaillier GC used to buy a ring",
        4700,
        "gift_certificate",
        "archive",
    ),
    ("WEEKLONG PRIZE: American Airlines Vacations Travel gift certificate", 7000, "gift_certificate", "archive"),
    ("FEATURED MARVEL PRIZE: Disney shopping spree + Marvel bundle", 7000, "merchandise_bundle", "archive"),
    (
        "FEATURED VEGAS TRIP: Caesars Palace and shopping spree at the Forum Shops",
        6100,
        "shopping_spree",
        "archive",
    ),
    (
        "FEATURED PRIZE: Cartier GC used to buy opera-length pearls with rose luster",
        8250,
        "gift_certificate",
        "archive",
    ),
    ("Van Cleef & Arpels gift certificate", 3500, "gift_certificate", "archive"),
    ("Gucci gift certificate", 4500, "gift_certificate", "archive"),
    ("Protravelgear.com gift certificate", 650, "gift_certificate", "archive"),
]


def spa_display(wording: str) -> str:
    w = wording.strip()
    for prefix in (
        "FEATURED SPA TRIP: ",
        "FEATURED PRIZE: spa vacation to ",
        "FEATURED PRIZE #2: spa vacation to ",
        "TRIP ON THE WHEEL: ",
        "FEATURED TRIP: ",
        "Trip to ",
    ):
        if w.startswith(prefix):
            body = w[len(prefix) :].strip()
            body = re.sub(r"^to (?:the )?", "", body, flags=re.I)
            return body
    return w


def spa_core(display: str) -> str:
    low = display.lower()
    if low.startswith("spa vacation to "):
        return f"a {display[16:]}"
    if "resort & spa" in low or "resort and spa" in low:
        return f"a spa getaway at {display}"
    if "spa wellness" in low or " spa " in low:
        return f"a spa getaway at {display}"
    return f"a spa getaway to {display}"


def gift_display(wording: str) -> str:
    w = wording.strip()
    if w.startswith("$"):
        return w
    for prefix in (
        "FEATURED PRIZE #1: ",
        "FEATURED PRIZE #2: ",
        "FEATURED PRIZE #3: ",
        "FEATURED PRIZE: ",
        "FEATURED MARVEL PRIZE: ",
        "FEATURED VEGAS TRIP: ",
        "WEEKLONG PRIZE: ",
    ):
        if w.startswith(prefix):
            return w[len(prefix) :].strip()
    return w


def gift_core(display: str, kind: str, value_usd: int) -> str:
    if kind == "cash_card":
        return f"a ${value_usd:,} gift card"
    if kind == "shopping_spree":
        if display.lower().startswith("shopping spree"):
            return f"a {display}"
        return f"a shopping spree — {display}"
    if kind == "merchandise_bundle":
        return display
    if "gift certificate" in display.lower() or display.endswith(" GC"):
        return f"a {display}" if not display.lower().startswith("a ") else display
    return f"a ${value_usd:,} gift certificate — {display}"


def build_spa_prizes() -> list[dict]:
    spas = []
    seen_ids: set[str] = set()
    for idx, (wording, value_usd, source) in enumerate(SPA_SOURCE):
        display = spa_display(wording)
        core = spa_core(display)
        prize_id = slugify(display)
        if prize_id in seen_ids:
            prize_id = f"{prize_id}_{idx}"
        seen_ids.add(prize_id)
        congrats, vo = build_vo_lines(core, idx)
        spas.append(
            {
                "id": prize_id,
                "wording": wording if wording.startswith("FEATURED") or wording.startswith("TRIP") else display,
                "display": display,
                "value_usd": value_usd,
                "source": source,
                "congratsText": congrats,
                "voText": vo,
            }
        )
    return spas


def build_gift_prizes() -> list[dict]:
    gifts = []
    seen_ids: set[str] = set()
    for idx, (wording, value_usd, kind, source) in enumerate(GIFT_SOURCE):
        display = gift_display(wording)
        core = gift_core(display, kind, value_usd)
        prize_id = slugify(display)
        if prize_id in seen_ids:
            prize_id = f"{prize_id}_{idx}"
        seen_ids.add(prize_id)
        congrats, vo = build_vo_lines(core, idx)
        gifts.append(
            {
                "id": prize_id,
                "wording": wording,
                "display": display,
                "kind": kind,
                "value_usd": value_usd,
                "source": source,
                "congratsText": congrats,
                "voText": vo,
            }
        )
    return gifts


def main() -> None:
    spa_out = {
        "comment": "Spa wedge prizes — FEATURED SPA TRIP archive entries plus spa-focused resorts.",
        "spas": build_spa_prizes(),
    }
    gift_out = {
        "comment": (
            "Gift wedge prizes from Andy Nguyen archive. "
            "Not all are cash — see kind (cash_card, shopping_spree, gift_certificate, merchandise_bundle)."
        ),
        "gifts": build_gift_prizes(),
    }

    spa_path = ROOT / "data" / "spa-prizes.json"
    gift_path = ROOT / "data" / "gift-prizes.json"
    spa_path.write_text(json.dumps(spa_out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    gift_path.write_text(json.dumps(gift_out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {len(spa_out['spas'])} spa prizes → {spa_path}")
    print(f"Wrote {len(gift_out['gifts'])} gift prizes → {gift_path}")

    kinds = {}
    for g in gift_out["gifts"]:
        kinds[g["kind"]] = kinds.get(g["kind"], 0) + 1
    print("Gift kinds:", kinds)


if __name__ == "__main__":
    main()
