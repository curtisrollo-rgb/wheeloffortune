# WoF Game Server (Railway)

WebSocket server for Wheel of Fortune online play (TV host + up to 3 phone controllers). Deploy from GitHub with **Root Directory = `server`**.

**Version:** 0.1.0

## Railway deploy checklist

1. Push repo to GitHub
2. Railway → New Project → Deploy from GitHub
3. Set **Root Directory** to `server` (no leading slash — not `/server`)
4. Do **not** set `RAILPACK_STATIC_FILE_ROOT` on this service (that forces static-site mode)
5. Generate public domain
6. WebSocket URL: `wss://YOUR-DOMAIN.up.railway.app`
7. Test: `GET https://YOUR-DOMAIN.up.railway.app/health`

This service builds from `server/Dockerfile` (Node 20 + `npm ci`) so Railpack cannot misdetect it as a static HTML site.

## Puzzle bank

Multiplayer uses **`server/data/puzzles-cdrom.json`** — ~8,000 Hasbro CD-ROM era puzzles:

| Source | Game |
|--------|------|
| `hasbro-1998` | PS1 / Windows / Mac (1998) — extracted via [Game-Rave](https://game-rave.com/?p=27337) |
| `hasbro-2000` | Wheel of Fortune: 2nd Edition (2000) — [Game-Rave](https://game-rave.com/?p=29020) |
| `hasbro-1998-supplement` | Community PS1-style phrase dump |

Rebuild after updating sources:

```bash
python3 scripts/build_cdrom_puzzles.py
```

Check loaded count: `GET /health` → `"puzzleCount": 8030`

For solo/TV static site, upload `data/puzzles-cdrom.json` to Bluehost (or use `?tv` on index for the old TV-scraped bank).

After creating a room, players can **scan the QR code** on the TV or lobby page to join (no long URL to copy). Set your Railway WebSocket URL once in `data/multiplayer-config.json` so QR links stay short (`join.html?room=CODE` only).

## Local run

```bash
cd server
npm install
npm start
```

Then open http://localhost:8900/multiplayer/ (static site served separately).

## WebSocket ops

| Client → Server | Who | Purpose |
|-----------------|-----|---------|
| `createRoom` | Lobby | Create game, get 4-letter word code |
| `joinRoom` | Phone | Join as p1/p2/p3 with name |
| `attachHost` | TV | Connect display to room |
| `rejoinRoom` | Phone | Reconnect after refresh |
| `startGame` | Lobby/TV | Start when 1+ players joined |
| `spin` | Player | Send spin gauge power (0–1) |
| `guessLetter` | Player | Consonant guess |
| `buyVowel` | Player | Buy a vowel |
| `solve` | Player | Solve attempt |
| `buzz` | Player | Toss-up ring-in |
| `newPuzzle` | Host | Request new puzzle |
| `ping` | Anyone | Keepalive |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Set automatically by Railway |
| `HOST` | `0.0.0.0` | Bind address |
