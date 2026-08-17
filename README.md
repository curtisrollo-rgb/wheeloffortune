# Wheel of Fortune

Solo prototype plus Jackbox-style online multiplayer (TV display + phone controllers).

## Repo layout

```
wheeloffortune/
├── index.html              Solo / dev mode (local play)
├── css/                    Shared game styles
├── js/
│   ├── main.js             Solo client only
│   ├── game-state.js       Shared game rules (solo + future server)
│   ├── host-app.js         TV display client
│   ├── controller-app.js   Phone controller client
│   ├── board.js, wheel.js, …
│   └── net/
│       ├── config.js       WebSocket URL + room URL helpers
│       ├── client.js       WofClient (WebSocket ops)
│       ├── lobby.js        Create-room flow
│       └── join.js         Join-room flow
├── multiplayer/            Online HTML pages + multiplayer CSS only
│   ├── index.html          Lobby (create room)
│   ├── join.html           Enter code + name
│   ├── host.html           TV display
│   └── controller.html     Phone controls
├── data/                   Puzzles, wedges, VO lines
├── assets/                 Audio + images
├── scripts/                VO generation (ElevenLabs)
└── server/                 Railway WebSocket game server
    ├── index.js
    ├── rooms.js
    ├── wof-game.js
    ├── package.json
    └── railway.toml
```

Static files (HTML, JS, CSS, audio) deploy to Bluehost/Netlify. The game server deploys to Railway with **Root Directory = `server`**.

## Local development

Terminal 1 — game server:

```bash
cd server
npm install
npm start
```

Terminal 2 — static site:

```bash
python3 -m http.server 8900
```

Open:

| Page | URL |
|------|-----|
| Solo prototype | http://localhost:8900/ |
| Online lobby | http://localhost:8900/multiplayer/ |
| Join game | http://localhost:8900/multiplayer/join.html |

WebSocket defaults to `ws://localhost:8080` on localhost. Health check: http://localhost:8080/health

## Railway deploy (server)

1. Push this repo to GitHub
2. Railway → New Project → Deploy from GitHub
3. Set **Root Directory** to `server`
4. Generate a public domain
5. Use `wss://YOUR-APP.up.railway.app` in the multiplayer lobby

See [server/README.md](server/README.md) for server API details.

## VO generation

Copy `.env.example` to `.env` and add your ElevenLabs API key. Run scripts under `scripts/` to regenerate MP3 assets.
