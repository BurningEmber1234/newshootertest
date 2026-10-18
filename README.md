# RIFT//STRIKE

A self-contained browser-based tactical FPS prototype with a native-WebGL 3D world. Fight a 5v5 match on **Ascent**, a bright hillside town with a wide A site, a central mid courtyard and a B site, choose Counter-Terrorists or Terrorists, and take on squads of bots that move, aim, shoot, and respawn. The camera is first-person, with perspective 3D walls, ground, props and operator models, plus animated first-person weapon viewmodels. Create or join an online room with a short code to play alongside another person.

The browser client and multiplayer server use plain JavaScript and Node's standard library; there are no third-party runtime dependencies.

## The map

**Ascent** is a sun-washed hillside town inspired by Valorant's Ascent, laid out around a central mid courtyard:

- **A site** (west) — entered from A main or the raised A short, with wine, rafters, and a garden behind it.
- **B site** (east) — fed by B main, mid market, and the boat house side room.
- **Mid** — mid top, catwalk, courtyard, and mid bottom connect both halves of the map.
- **Spawns** — attackers start on the north side of town, defenders on the south, each with five spawn points.

Both teams are split across A and B by the bots, so pushes and rotations happen on both sites instead of one central brawl.

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
- **Mouse** — look and aim left/right and up/down (mouse-look locks automatically on desktop)
- **Left mouse button** — fire; hold for automatic fire
- **1 / 2 / 3** — equip Classic, Vandal, or Marshal
- **B** — open the field armory to buy weapons or armor
- **Tab** — hold to view the live leaderboard
- **R** — reload
- **Shift** — sprint
- **Space** — vault / hop
- **Esc** — close a menu, pause, or resume

Matches are first-to-15 team eliminations. Start with a Vandal, Classic sidearm, $2,000, and partial armor; earn credits for eliminations and buy a Marshal or full Kevlar in the field armory. Bots push either site, rotate when a lane goes quiet, reposition in fights, aim, fire, and respawn. The live tactical map shows both teams, both sites, and the lane callouts (A main, mid, market, boat house, and more).

Each weapon has its own hand-drawn first-person viewmodel with gloved hands, soft cel-shaded metal, idle sway, recoil kick, animated magazine reloads and muzzle flash — plus matching silhouettes in the weapon panel and the field armory.
