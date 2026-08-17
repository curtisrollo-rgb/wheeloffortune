# WoF Game Server (Railway)

WebSocket server for Wheel of Fortune online play (TV host + up to 3 phone controllers). Deploy from GitHub with **Root Directory = `server`**.

**Version:** 0.1.0

## Railway deploy checklist

1. Push repo to GitHub
2. Railway → New Project → Deploy from GitHub
3. Set **Root Directory** to `server`
4. Generate public domain
5. WebSocket URL: `wss://YOUR-DOMAIN.up.railway.app`
6. Test: `GET https://YOUR-DOMAIN.up.railway.app/health`

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
