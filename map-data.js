/* Shared Dustline Depot level data for the browser and the multiplayer server. */
(function (root, factory) {
  const data = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  root.RiftMap = data;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const width = 24;
  const height = 24;
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0,
    ),
  );
  const wall = (x, y, w, h, type = 1) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (grid[yy] && grid[yy][xx] !== undefined) grid[yy][xx] = type;
      }
    }
  };

  // Dustline Depot: a compact industrial yard with two bomb sites, long lanes,
  // and short connector routes through concrete, steel, and cargo cover.
  wall(6, 3, 1, 5, 2); wall(7, 7, 4, 1, 1); wall(11, 4, 1, 4, 2);
  wall(14, 3, 1, 5, 1); wall(16, 4, 4, 1, 2); wall(19, 5, 1, 3, 1);
  wall(3, 10, 5, 1, 2); wall(8, 10, 1, 4, 1); wall(11, 10, 4, 1, 1);
  wall(15, 10, 1, 4, 2); wall(17, 10, 4, 1, 1); wall(20, 11, 1, 4, 2);
  wall(3, 15, 1, 4, 1); wall(4, 18, 4, 1, 2); wall(8, 16, 1, 4, 1);
  wall(11, 15, 1, 5, 2); wall(13, 17, 4, 1, 1); wall(17, 15, 1, 5, 2);
  wall(19, 18, 3, 1, 1);
  // Cargo pallets and concrete barriers give the central lanes extra cover.
  wall(5, 5, 2, 1, 3); wall(13, 12, 2, 1, 3); wall(9, 20, 2, 1, 3);
  wall(3, 6, 1, 2, 3); wall(18, 12, 1, 2, 3); wall(5, 13, 2, 1, 3);

  const spawns = {
    CT: [[3.3, 2.5], [4.2, 3.8], [2.4, 5.5], [4.1, 6.8], [2.4, 8.3]],
    T: [[20.5, 21.2], [21.4, 20.5], [21.3, 16.8], [19.1, 16.3], [17.8, 20.6]],
  };
  const sites = {
    A: { x: 8.8, y: 8.2 },
    B: { x: 15.7, y: 14.5 },
  };
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

  return { width, height, grid, spawns, sites, isSolid, lineClear, nextWaypoint };
});
