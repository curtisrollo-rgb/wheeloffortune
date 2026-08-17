#!/usr/bin/env python3
"""Build trip-prizes.json with show-style congrats + VO lines from the archive."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "swu-card-archive" / "wheel-show" / "data" / "trip-prizes-clean.json"
OUT_PATH = ROOT / "data" / "trip-prizes.json"

ACRONYMS = {
    "NYC", "FL", "CA", "DC", "HI", "WY", "NY", "USA", "UK", "VIP", "LA", "CRUISE",
}

SPEECH_FIXES = {
    "Rsort": "Resort",
    "Bach Resort": "Beach Resort",
    "he the": "the",
    "mesm TOKYO": "mesm Tokyo",
    "Lapaz": "La Paz",
    "CRUISE of Alaska": "cruise of Alaska",
    "CRUISE": "cruise",
    "WAIKIKI": "Waikiki",
    "BARBADOS": "Barbados",
    "BERMUDA": "Bermuda",
    "ARUBA": "Aruba",
    "HAWAII": "Hawaii",
    "JAMAICA": "Jamaica",
    "COSTA RICA": "Costa Rica",
    "PUERTO RICO": "Puerto Rico",
    "DOMINICAN REPUBLIC": "Dominican Republic",
    "TURKS & CAICOS": "Turks and Caicos",
    "CABO SAN LUCAS": "Cabo San Lucas",
    "PUERTO VALLARTA": "Puerto Vallarta",
    "NUEVO VALLARTA": "Nuevo Vallarta",
    "NAPA VALLEY": "Napa Valley",
    "SONOMA VALLEY": "Sonoma Valley",
    "ATLANTIC CITY": "Atlantic City",
    "PALM SPRINGS": "Palm Springs",
    "LAKE TAHOE": "Lake Tahoe",
    "KEY WEST": "Key West",
    "FLORIDA KEYS & KEY WEST": "Florida Keys and Key West",
    "SOUTHWEST FLORIDA COAST": "Southwest Florida coast",
    "NEW ORLEANS": "New Orleans",
    "NEW YORK": "New York",
    "SAN FRANCISCO": "San Francisco",
    "LAS VEGAS": "Las Vegas",
    "MONTENEGRO": "Montenegro",
    "CAMBODIA": "Cambodia",
    "GREECE": "Greece",
    "ITALY": "Italy",
    "SPAIN": "Spain",
    "IRELAND": "Ireland",
    "BRAZIL": "Brazil",
    "CURAÇAO": "Curaçao",
    "CURACAO": "Curaçao",
    "ANTIGUA": "Antigua",
    "GRENADA": "Grenada",
    "PANAMA": "Panama",
    "CROATIA": "Croatia",
    "VIETNAM": "Vietnam",
    "ROMANIA": "Romania",
    "GEORGIA": "Georgia",
    "MONTANA": "Montana",
    "VERMONT": "Vermont",
    "MEXICO": "Mexico",
    "ALASKA": "Alaska",
    "KAUAI": "Kauai",
    "MAUI": "Maui",
    "JAPAN": "Japan",
    "ICELAND": "Iceland",
    "CANADA": "Canada",
    "MINNESOTA": "Minnesota",
    "FLORIDA": "Florida",
    "BELIZE": "Belize",
    "CANCUN": "Cancun",
    "ACAPULCO": "Acapulco",
    "PENSACOLA": "Pensacola",
    "Kissimmee": "Kissimmee",
    "AULANI": "Aulani",
    "DISCOVER PUERTO RICO": "Discover Puerto Rico",
    "MONTEREY, CALIFORNIA": "Monterey, California",
    "SOUTHERN CALIFORNIA": "Southern California",
    "BIG ISLAND OF HAWAII": "Big Island of Hawaii",
    "ISLANDS OF ANTIGUA": "Islands of Antigua",
    "BRIGHT AND BREEZY": "bright and breezy",
    "iHEARTRADIO THEATER LA": "iHeartRadio Theater LA",
    "NASHVILLE MUSIC CITY": "Nashville Music City",
    "ELVIS DURAN AND THE MORNING SHOW": "Elvis Duran and the Morning Show",
}


DURATION_MAP = {
    "8d": "eight-day",
    "10d": "ten-day",
    "11d": "eleven-day",
    "12d": "twelve-day",
    "13d": "thirteen-day",
    "6d": "six-day",
    "8 days": "eight-day",
    "10 days": "ten-day",
    "11 days": "eleven-day",
    "12 days": "twelve-day",
    "13 days": "thirteen-day",
    "six days": "six-day",
    "eight days": "eight-day",
    "ten days": "ten-day",
    "eleven days": "eleven-day",
    "twelve days": "twelve-day",
    "thirteen days": "thirteen-day",
}


def normalize_expedition(body: str) -> str:
    body = speechify(body)
    low = body.lower()
    for key, spoken in DURATION_MAP.items():
        if low.startswith(key + " in "):
            place = body[len(key) + 4 :]
            return f"{spoken} expedition to {place}"
        if low.startswith(key + " through "):
            place = body[len(key) + 10 :]
            return f"{spoken} expedition through {place}"
    if low.startswith("ten days in the "):
        return f"ten-day expedition to {body[16:]}"
    if low.startswith("twelve days in "):
        return f"twelve-day expedition to {body[15:]}"
    if low.startswith("eight days in the "):
        return f"eight-day expedition to the {body[18:]}"
    if low.startswith("eleven days in "):
        return f"eleven-day expedition to {body[15:]}"
    return f"expedition to {body}"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text.lower()).strip("_")
    return text[:80] or "trip"


def title_word(word: str) -> str:
    if word in ACRONYMS:
        return word
    if word.isupper() and len(word) > 2:
        return word.title()
    return word


def speechify(text: str) -> str:
    for old, new in SPEECH_FIXES.items():
        text = text.replace(old, new)
    text = re.sub(r"\s+", " ", text).strip(" ,.;")
    words = []
    for word in text.split():
        words.append(title_word(word))
    return " ".join(words)


def article(phrase: str) -> str:
    first = re.sub(r"^(the|a|an)\s+", "", phrase.strip(), flags=re.I).split()[0].lower()
    if first in {"8", "11", "18"}:
        return "an"
    if first[:1] in "aeiou":
        return "an"
    if first in {"hour", "honest", "all-week-long", "expedition", "iheart"}:
        return "an"
    return "a"


def prize_phrase(wording: str) -> tuple[str, str]:
    """Return (short_label, spoken_destination_phrase)."""
    w = wording.strip()

    if w.startswith("FEATURED TRIP ALL WEEK LONG:"):
        dest = speechify(w.split(":", 1)[1])
        return "all-week-long vacation", f"to {dest}"

    if w.startswith("FEATURED TRIPS:"):
        dest = speechify(w.split(":", 1)[1])
        return "trip", dest

    if w.startswith("FEATURED TRIP:"):
        body = w.split(":", 1)[1].strip()
        body = re.sub(r"^trip to (?:the )?", "", body, flags=re.I)
        body = re.sub(r"^to (?:the )?", "", body, flags=re.I)
        dest = speechify(body)
        low = dest.lower()
        if low.startswith("a mediterranean cruise"):
            return "Mediterranean cruise", "a Mediterranean cruise"
        if "cruise of alaska" in low or "cruise of" in low:
            return "cruise", f"a {dest}" if not dest.lower().startswith("a ") else dest
        if low.startswith("a "):
            return "prize", dest
        if low.startswith(("an ", "the ")):
            return "prize", dest
        if "cruise" in low and not low.startswith("to "):
            return "cruise", f"a {dest}" if not dest.lower().startswith("a ") else dest
        if dest.lower().startswith(("to ", "the ", "a ", "an ")):
            return "trip", dest
        return "trip", f"to {dest}"

    if w.startswith("FEATURED CRUISE:"):
        dest = speechify(w.split(":", 1)[1])
        if dest.lower().endswith(" cruise"):
            return "cruise", dest
        if dest.lower() in {"caribbean", "alaska", "canada & new england", "scotland and iceland"}:
            return "cruise", f"a {dest} cruise"
        if "regent seven seas" in dest.lower():
            return "cruise", f"a {dest}"
        return "cruise", f"a cruise to {dest}"

    if w.startswith("FEATURED COLLETTE TOUR:"):
        dest = speechify(w.split(":", 1)[1])
        return "Collette tour", f"of {dest}"

    if w.startswith("FEATURED COLLETTE TRIP:"):
        dest = speechify(w.split(":", 1)[1])
        return "Collette trip", dest

    if w.startswith("FEATURED EXPEDITION CRUISE:"):
        dest = normalize_expedition(w.split(":", 1)[1].strip())
        return "expedition cruise", dest

    if w.startswith("FEATURED EXPEDITION:"):
        dest = normalize_expedition(w.split(":", 1)[1].strip())
        return "expedition", dest

    if w.startswith("FEATURED BR EXPEDITION:"):
        dest = normalize_expedition(w.split(":", 1)[1].strip())
        return "expedition", dest

    if w.startswith("FEATURED DISNEY CRUISE:"):
        dest = speechify(w.split(":", 1)[1])
        return "Disney cruise", f"to {dest}"

    if w.startswith("FEATURED DISNEY PRIZE:"):
        dest = speechify(w.split(":", 1)[1])
        low = dest.lower()
        if "cruise" in low:
            return "Disney prize", dest
        if dest.lower() == "aulani":
            return "Disney vacation", "at Aulani"
        if dest.lower() == "rome":
            return "Disney vacation", "to Rome"
        return "Disney vacation", dest

    if w.startswith("FEATURED HAWAIIAN VACATION:"):
        dest = speechify(w.split(":", 1)[1])
        return "Hawaiian vacation", dest

    if w.startswith("FEATURED ISLAND TRIP:"):
        dest = speechify(w.split(":", 1)[1])
        return "island trip", dest

    if w.startswith("FEATURED MUSIC TRIP:"):
        dest = speechify(w.split(":", 1)[1])
        return "music trip", dest

    if w.startswith("FEATURED WINTER WONDERLAND:"):
        dest = speechify(w.split(":", 1)[1])
        return "winter vacation", dest

    if w.startswith("FEATURED WE:"):
        dest = speechify(w.split(":", 1)[1])
        return "vacation", dest

    if w.startswith("Collette Trip to "):
        dest = speechify(w.replace("Collette Trip to ", "", 1))
        return "Collette trip", f"to {dest}"

    if w.startswith("Thrive Travel Trip to "):
        body = w.replace("Thrive Travel Trip to ", "", 1)
        body = re.sub(r"^the ", "", body, flags=re.I)
        dest = speechify(body)
        return "trip", f"to {dest}" if not dest.lower().startswith("to ") else dest

    if w.startswith("Overseas Adventure Travel Trip to "):
        dest = speechify(w.replace("Overseas Adventure Travel Trip to ", "", 1))
        dest = re.sub(r"\s*\(incl$", "", dest, flags=re.I)
        return "adventure travel trip", f"to {dest}"

    if w.startswith("Trip to "):
        body = w.replace("Trip to ", "", 1)
        body = re.sub(r"^the ", "", body, flags=re.I)
        dest = speechify(body)
        return "trip", f"to {dest}" if not dest.lower().startswith("to ") else dest

    dest = speechify(w)
    return "trip", dest


def build_prize_core(prize_type: str, destination: str) -> str:
    if destination.startswith("a ") or destination.startswith("an "):
        core = destination
    elif prize_type == "Mediterranean cruise":
        core = destination
    elif prize_type in {"expedition", "expedition cruise"} and "expedition" in destination:
        core = f"{article(destination)} {destination}"
    elif prize_type in {"Collette tour", "Collette trip"} and destination.startswith("of "):
        core = f"{article(prize_type)} {prize_type} {destination}"
    elif prize_type == "Disney cruise" and destination.startswith("to "):
        core = f"{article('Disney cruise')} Disney cruise {destination}"
    elif prize_type in {"Disney vacation", "Disney prize"} and destination.startswith(("at ", "to ")):
        core = f"{article('Disney vacation')} Disney vacation {destination}"
    elif prize_type == "all-week-long vacation" and destination.startswith("to "):
        core = f"{article('all-week-long vacation')} all-week-long vacation {destination}"
    elif prize_type == "cruise" and not destination.lower().startswith(("a ", "an ", "to ")):
        core = f"{article('cruise ' + destination)} {destination}"
    elif destination.lower().startswith(("to ", "of ", "at ")):
        core = f"{article(prize_type + ' ' + destination)} {prize_type} {destination}"
    elif prize_type == "trip" and not destination.lower().startswith("to "):
        core = f"{article('trip to ' + destination)} trip to {destination}"
    elif prize_type == "prize":
        core = destination
    else:
        core = f"{article(prize_type + ' ' + destination)} {prize_type} {destination}"

    core = re.sub(r"\s+", " ", core)
    core = core.replace("trip to to ", "trip to ")
    core = core.replace("cruise cruise", "cruise")
    core = core.replace("vacation to to ", "vacation to ")
    return core


VO_INTROS = [
    "Great news!",
    "Congratulations!",
    "Congrats!",
    "Good work!",
    "You've won!",
]

CONGRATS_TEMPLATES = [
    "Congratulations, you've won {core}!",
    "Congrats, you've won {core}!",
    "Good work — you've won {core}!",
    "You've won {core}!",
]


def capitalize_first(text: str) -> str:
    if not text:
        return text
    return text[0].upper() + text[1:]


def build_vo_text(core: str, index: int) -> str:
    intro = VO_INTROS[index % len(VO_INTROS)]
    if intro == "You've won!":
        return f"{intro} {capitalize_first(core)}!"
    return f"{intro} You've won {core}!"


def build_congrats_text(core: str, index: int) -> str:
    template = CONGRATS_TEMPLATES[(index + 2) % len(CONGRATS_TEMPLATES)]
    return template.format(core=core)


def main() -> None:
    items = json.loads(SOURCE.read_text(encoding="utf-8"))
    trips = []
    seen_ids: set[str] = set()

    for index, item in enumerate(items):
        wording = item["wording"]
        prize_type, destination = prize_phrase(wording)
        core = build_prize_core(prize_type, destination)
        congrats = build_congrats_text(core, index)
        vo_text = build_vo_text(core, index)

        base_id = slugify(destination or wording)
        trip_id = base_id
        n = 2
        while trip_id in seen_ids:
            trip_id = f"{base_id}_{n}"
            n += 1
        seen_ids.add(trip_id)

        trips.append(
            {
                "id": trip_id,
                "wording": wording,
                "value_usd": item.get("value_usd", 0),
                "congratsText": congrats,
                "voText": vo_text,
            }
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({"comment": "Trip prizes for the TRIP wedge (Andy Nguyen archive).", "trips": trips}, indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(trips)} trips -> {OUT_PATH}")


if __name__ == "__main__":
    main()
