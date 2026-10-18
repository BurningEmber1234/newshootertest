# RIFT//STRIKE

A self-contained browser-based tactical FPS prototype inspired by classic competitive shooters. No build step, bundler, or third-party runtime dependencies are required.

## Run locally

Pick whichever you have installed — they all serve the same files:

```sh
npm run dev            # Node.js 18+ (http://localhost:4173)
```

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`. Use a custom port with `PORT=8080 npm run dev`.

Or simply open `index.html` in a modern desktop browser.

## Build

```sh
npm run build
```

Copies the static site into `dist/`, ready to upload to any static host. There is no bundling or minification step.

## Controls

- **W / A / S / D** — move and strafe
- **Mouse** — aim (mouse-look locks automatically on desktop)
- **Left mouse button** — fire; hold for automatic fire
- **R** — reload
- **Shift** — sprint
- **Space** — vault / hop
- **Esc** — pause or resume

Eliminate all five hostiles before they take you down. Your health, armor, ammo, accuracy, and mission time are tracked.
