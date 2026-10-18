# RIFT//STRIKE

A self-contained browser-based tactical FPS prototype. Fight a 5v5 match on **Dustline Depot**, choose Counter-Terrorists or Terrorists, and take on squads of bots that move, aim, shoot, and respawn. Create or join an online room with a short code to play alongside another person.

The browser client and multiplayer server use plain JavaScript and Node's standard library; there are no third-party runtime dependencies.

## Run locally

Use Node.js 18 or newer:

```sh
npm run dev            # http://localhost:4173
```

The server binds to `0.0.0.0` so another device can join when it can reach the host. Open the page, choose a side and a callsign, then:

- **Quick Play** — local 5v5 match against bots.
- **Create Online Room** — start a network match and share the five-character room code.
- **Join** — enter a room code from a match hosted on the same reachable server.

Online rooms are held in server memory and use same-origin JSON polling. Keep the Node server running for the full match. For players outside your local network, the host must make the server's port reachable (for example, by deploying the Node server or configuring a suitable network tunnel/port forward). Static hosting alone supports Quick Play, but not online rooms.

You can use another port with `PORT=8080 npm run dev`.

## Build

```sh
npm run build
```

Copies the client files into `dist/`. The exported static site can be hosted anywhere for Quick Play. Online multiplayer requires the Node server in `server.js` because static hosts do not run the room API.

## Controls

- **W / A / S / D** — move and strafe
- **Mouse** — aim (mouse-look locks automatically on desktop)
- **Left mouse button** — fire; hold for automatic fire
- **R** — reload
- **Shift** — sprint
- **Space** — vault / hop
- **Esc** — pause or resume

Matches are first-to-15 team eliminations. Players respawn, armor absorbs part of incoming damage, and the live tactical map shows both teams and bomb sites A/B.
