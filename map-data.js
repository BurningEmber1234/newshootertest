/* Shared Ascent-inspired level data for the browser and the multiplayer server.
 *
 * The layout is a stylised tribute to Valorant's Ascent: a bright hillside
 * town with a wide A site to the west, a wide B site to the east, a central
 * mid courtyard, attacker spawn in the north and defender spawn in the south.
 * Walls are solid tiles; rooms and lanes are carved out of the building mass.
 */
(function (root, factory) {
  const data = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  root.RiftMap = data;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const width = 40;
  const height = 34;
  // Tile types: 1 sandstone building, 2 teal-painted facade, 3 wooden crates,
  // 4 terracotta brick. 0 is walkable ground.
  const grid = Array.from({ length: height }, () => Array(width).fill(1));
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const paint = (x, y, w, h, type) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (inBounds(xx, yy) && grid[yy][xx] !== 0) grid[yy][xx] = type;
      }
    }
  };
  const carve = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (inBounds(xx, yy) && xx > 0 && yy > 0 && xx < width - 1 && yy < height - 1) grid[yy][xx] = 0;
      }
    }
  };
  const block = (x, y, w, h, type = 3) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (inBounds(xx, yy) && grid[yy][xx] === 0) grid[yy][xx] = type;
      }
    }
  };

  // --- Rooftop facades (colour blocks for the solid building mass) ---------
  paint(2, 2, 8, 2, 4); paint(2, 8, 4, 3, 4); paint(13, 2, 2, 2, 2);
  paint(10, 5, 3, 3, 2); paint(26, 2, 2, 2, 2); paint(30, 2, 9, 2, 4);
  paint(34, 3, 5, 6, 2); paint(2, 14, 2, 8, 4); paint(6, 16, 2, 2, 2);
  paint(13, 2, 1, 1, 1); paint(26, 5, 1, 3, 2); paint(34, 9, 5, 7, 2);
  paint(15, 24, 2, 2, 2); paint(2, 24, 6, 3, 4); paint(31, 24, 7, 3, 2);
  paint(2, 31, 36, 1, 2);

  // --- Attacker side (north) ----------------------------------------------
  carve(15, 2, 11, 3);            // Attacker spawn
  carve(13, 3, 3, 1);             // Spawn → A corridor
  carve(13, 3, 1, 3);             // A corridor down
  carve(25, 3, 3, 1);             // Spawn → B corridor
  carve(27, 3, 1, 3);             // B corridor down
  carve(19, 4, 3, 2);             // Spawn → mid door
  carve(6, 5, 7, 4);              // A lobby
  carve(27, 5, 7, 4);             // B lobby
  carve(16, 6, 7, 4);             // Mid top
  carve(13, 7, 2, 2);             // Mid cubby
  carve(15, 7, 1, 2);             // Cubby → mid
  carve(23, 8, 4, 2);             // Mid link

  // --- A side (west) -------------------------------------------------------
  carve(6, 9, 4, 6);              // A main
  carve(11, 9, 3, 2);             // A short (top)
  carve(11, 11, 2, 5);            // A short (descent)
  carve(2, 12, 3, 3);             // A wine
  carve(5, 13, 1, 2);             // A wine → A main
  carve(2, 15, 2, 2);             // A wine → rafters
  carve(2, 17, 2, 6);             // A rafters
  carve(5, 16, 8, 8);             // A site
  carve(6, 15, 4, 1);             // A main → A site
  carve(4, 19, 1, 2);             // Rafters → A site
  carve(14, 20, 3, 4);            // A garden
  carve(13, 21, 1, 2);            // A site → garden

  // --- Mid -----------------------------------------------------------------
  carve(18, 10, 3, 2);            // Mid catwalk
  carve(16, 12, 7, 4);            // Mid courtyard
  carve(18, 16, 3, 1);            // Courtyard → mid bottom
  carve(17, 17, 5, 3);            // Mid bottom
  carve(19, 20, 2, 1);            // Mid bottom → pizza
  carve(18, 21, 4, 3);            // Mid pizza
  carve(17, 21, 1, 2);            // Pizza → garden
  carve(23, 19, 3, 4);            // Mid market
  carve(22, 20, 1, 2);            // Mid bottom → market

  // --- B side (east) -------------------------------------------------------
  carve(29, 10, 5, 5);            // B main
  carve(30, 9, 3, 1);             // B lobby → B main
  carve(30, 15, 3, 1);            // B main → B site
  carve(27, 16, 8, 8);            // B site
  carve(26, 20, 1, 2);            // Market → B site
  carve(36, 18, 2, 5);            // Boat house
  carve(35, 20, 1, 2);            // B site → boat house

  // --- Defender side (south) ----------------------------------------------
  carve(15, 27, 11, 4);           // Defender spawn
  carve(9, 28, 6, 2);             // Spawn → A link
  carve(9, 24, 3, 4);             // A link → A site
  carve(25, 28, 5, 2);            // Spawn → B link
  carve(28, 24, 3, 4);            // B link → B site
  carve(19, 24, 3, 3);            // Spawn → CT mid

  // --- Cover ---------------------------------------------------------------
  block(6, 18, 2, 1); block(10, 21, 1, 2); block(7, 22, 2, 1);
  block(29, 18, 2, 1); block(33, 20, 1, 2); block(28, 22, 2, 1);
  block(18, 13, 2, 1, 4); block(20, 14, 1, 1, 4);   // Mid planter
  block(18, 18, 2, 1);                              // Mid bottom crates
  block(7, 12, 1, 2);                               // A main crate
  block(31, 12, 1, 2);                              // B main crate
  block(11, 10, 1, 1);                              // A short crate
  block(24, 21, 1, 1);                              // Market crate

  // Facing outward from spawn toward the map: north attackers face south (+Y),
  // south defenders face north (-Y).
  const spawnFacing = { CT: -Math.PI / 2, T: Math.PI / 2 };
  const spawns = {
    CT: [[16.6, 28.5], [18.6, 29.2], [21.4, 29.2], [23.6, 28.5], [20.0, 28.2]],
    T: [[16.6, 3.2], [18.4, 3.8], [20.2, 3.2], [22.0, 3.8], [23.6, 3.2]],
  };
  const sites = {
    A: { x: 8.5, y: 19.6 },
    B: { x: 30.5, y: 19.6 },
  };
  // Callout labels for the tactical map preview.
  const callouts = [
    { label: 'A SITE', x: 8.5, y: 19.6, site: 'A' },
    { label: 'B SITE', x: 30.5, y: 19.6, site: 'B' },
    { label: 'A LOBBY', x: 9.0, y: 6.8 },
    { label: 'A MAIN', x: 8.6, y: 12.4 },
    { label: 'A SHORT', minor: true, x: 11.9, y: 12.8 },
    { label: 'A WINE', minor: true, x: 3.0, y: 13.0 },
    { label: 'RAFT', minor: true, x: 2.9, y: 19.5 },
    { label: 'GARDEN', minor: true, x: 15.0, y: 21.8 },
    { label: 'MID', x: 17.3, y: 14.4 },
    { label: 'MID TOP', minor: true, x: 19.2, y: 7.6 },
    { label: 'LINK', minor: true, x: 24.6, y: 8.8 },
    { label: 'MARKET', minor: true, x: 24.6, y: 22.2 },
    { label: 'B LOBBY', x: 30.4, y: 6.8 },
    { label: 'B MAIN', x: 32.4, y: 12.4 },
    { label: 'BOAT', minor: true, x: 36.9, y: 21.2 },
    { label: 'T SPAWN', x: 20.0, y: 3.2, spawn: 'T' },
    { label: 'CT SPAWN', x: 20.0, y: 28.8, spawn: 'CT' },
  ];

  // Decorative props (no collision): greenery, market stalls, and planters.
  const props = [
    { type: 'tree', x: 18.5, y: 13.5, size: 1.1 },
    { type: 'tree', x: 20.5, y: 14.5, size: 0.9 },
    { type: 'tree', x: 15.6, y: 21.4, size: 1.0 },
    { type: 'tree', x: 14.4, y: 22.8, size: 0.8 },
    { type: 'tree', x: 7.4, y: 10.6, size: 0.9 },
    { type: 'tree', x: 32.6, y: 21.6, size: 1.0 },
    { type: 'tree', x: 9.4, y: 6.4, size: 0.95 },
    { type: 'tree', x: 30.8, y: 6.4, size: 0.95 },
    { type: 'stall', x: 23.9, y: 22.5, size: 1.0 },
    { type: 'stall', x: 25.4, y: 19.9, size: 0.9 },
    { type: 'umbrella', x: 17.0, y: 14.3, size: 1.0 },
    { type: 'umbrella', x: 21.9, y: 12.9, size: 0.9 },
    { type: 'planter', x: 9.6, y: 20.6, size: 1.0 },
    { type: 'planter', x: 5.6, y: 22.7, size: 0.9 },
    { type: 'planter', x: 29.5, y: 21.4, size: 0.9 },
    { type: 'planter', x: 33.6, y: 19.5, size: 1.0 },
    { type: 'planter', x: 20.2, y: 7.9, size: 0.9 },
    { type: 'barrel', x: 9.5, y: 13.4, size: 0.8 },
    { type: 'barrel', x: 33.4, y: 13.6, size: 0.8 },
    { type: 'barrel', x: 21.4, y: 22.4, size: 0.8 },
  ];

  const isSolid = (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return tx < 0 || ty < 0 || tx >= width || ty >= height || grid[ty][tx] !== 0;
  };
  const lineClear = (x1, y1, x2, y2) => {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(distance * 8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isSolid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  };
  const nextWaypoint = (x, y, targetX, targetY) => {
    let sx = Math.floor(x), sy = Math.floor(y);
    let gx = Math.floor(targetX), gy = Math.floor(targetY);
    if (isSolid(gx + 0.5, gy + 0.5)) {
      const alternatives = [[gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]];
      const open = alternatives.find(([tx, ty]) => !isSolid(tx + 0.5, ty + 0.5));
      if (open) [gx, gy] = open;
    }
    if (sx === gx && sy === gy) return [targetX, targetY];
    const queue = [[sx, sy]];
    const parents = new Map([[`${sx},${sy}`, null]]);
    let reached = false;
    for (let cursor = 0; cursor < queue.length && cursor < width * height; cursor++) {
      const [cx, cy] = queue[cursor];
      if (cx === gx && cy === gy) { reached = true; break; }
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        const key = `${nx},${ny}`;
        if (parents.has(key) || isSolid(nx + 0.5, ny + 0.5)) continue;
        parents.set(key, [cx, cy]);
        queue.push([nx, ny]);
      }
    }
    if (!reached) return [targetX, targetY];
    let pathX = gx, pathY = gy;
    while (parents.get(`${pathX},${pathY}`) && !(parents.get(`${pathX},${pathY}`)[0] === sx && parents.get(`${pathX},${pathY}`)[1] === sy)) {
      [pathX, pathY] = parents.get(`${pathX},${pathY}`);
    }
    if (pathX === sx && pathY === sy) return [targetX, targetY];
    return [pathX + 0.5, pathY + 0.5];
  };

  return {
    name: 'ASCENT', width, height, grid, spawns, spawnFacing, sites, callouts, props,
    isSolid, lineClear, nextWaypoint,
  };
});
