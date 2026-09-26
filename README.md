# Party Dash 🌈🎲

A beginner-friendly 2–4 player worldwide multiplayer board game.

## What is included

- Real-time multiplayer using Socket.IO
- Create/join rooms with a 5-character code
- 2–4 players
- Synchronized turns and dice rolls
- 30-space cartoon-style board
- Coins and a finish condition
- Responsive UI for phone, tablet and desktop browsers

## Run it locally

Install Node.js 20+.

Then:

```bash
cd party-dash
npm install
npm start
```

Open http://localhost:3000 in your browser.

For local multiplayer testing, open the URL in multiple browser windows.

## Put it online

For the first public version, deploy this Node.js project to a host that supports long-lived WebSocket connections. Set the `PORT` environment variable if your host requires it.

Then share the public HTTPS URL with friends.

## Important architecture

Browser clients <-> Socket.IO server <-> game state in memory

For the prototype, rooms live in server memory. If the server restarts, rooms disappear.

For production we should next add:
1. Persistent accounts
2. Redis adapter / shared state for multiple server instances
3. Database for profiles and stats
4. Reconnect/resume
5. Server-side validation and rate limiting
6. HTTPS and production environment variables
7. Mobile/desktop packaging with Capacitor or Electron
8. Optional matchmaking
