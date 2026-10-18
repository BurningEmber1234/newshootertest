(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: true });
  const $ = (id) => document.getElementById(id);
  const menu = $('menuScreen'), hud = $('hud'), result = $('resultScreen'), pause = $('pauseScreen');
  const MAP = window.RiftMap;
  const WEAPONS = window.RiftWeapons;
  let world3d = null;
  try { world3d = window.Rift3D?.init(document.getElementById('world3d'), MAP) || null; }
  catch (error) { console.warn('3D renderer unavailable; using the classic renderer.', error); }
  let viewPitch = 0;
  const W = MAP.width, H = MAP.height, map = MAP.grid, FOV = Math.PI * 0.39;
  const SCORE_LIMIT = 15;
  const STARTING_CASH = 2000, ARMOR_PRICE = 650, ARMOR_CAP = 50, KILL_REWARD = 300;
  const TEAM_COLORS = { CT: '#63c2ed', T: '#f08466' };
  const spawnFacing = MAP.spawnFacing;
  const player = { x: MAP.spawns.CT[0][0], y: MAP.spawns.CT[0][1], angle: spawnFacing.CT, health: 100, armor: 25, ammo: 30, reserve: 90, money: STARTING_CASH, team: 'CT', alive: true, kills: 0, deaths: 0, weaponIndex: 1 };
  let weaponIndex = 1;
  let weaponStock = createWeaponStock();
  let bots = [], remoteActors = [], keys = {}, chosenTeam = 'CT';
  let playing = false, paused = false, gameMode = 'offline', onlineSession = null;
  let reloading = false, reloadTimer = 0, buyOpen = false, leaderboardOpen = false;
  let lastTime = 0, elapsed = 0, shots = 0, hits = 0, localElims = 0;
  let lastShot = 0, hitUntil = 0, muzzleUntil = 0, damageUntil = 0, bob = 0, moveBlend = 0, jump = 0, mouseHeld = false;
  let toastUntil = 0, toastText = '', zBuffer = [], viewW = 0, viewH = 0, dpr = 1;
  let scores = { CT: 0, T: 0 }, lastEventId = 0, networkInFlight = false, lastNetworkSync = 0, lastNetworkSuccess = 0;
  let previewCanvas = $('mapPreview'), minimapCanvas = $('minimap');
  const buyScreen = $('buyScreen'), leaderboardScreen = $('leaderboardScreen');

  function createWeaponStock() {
    return WEAPONS.map((weapon, index) => ({ owned: index < 2, ammo: weapon.mag, reserve: weapon.reserve }));
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalizeAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const solid = (x, y) => MAP.isSolid(x, y);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.4);
    viewW = Math.floor(innerWidth * dpr);
    viewH = Math.floor(innerHeight * dpr);
    canvas.width = viewW;
    canvas.height = viewH;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  function castRay(angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let mx = Math.floor(player.x), my = Math.floor(player.y);
    const ddx = Math.abs(1 / (dx || 1e-9)), ddy = Math.abs(1 / (dy || 1e-9));
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let sideX = (dx < 0 ? player.x - mx : mx + 1 - player.x) * ddx;
    let sideY = (dy < 0 ? player.y - my : my + 1 - player.y) * ddy;
    let side = 0, steps = 0;
    while (steps++ < 128) {
      if (sideX < sideY) { sideX += ddx; mx += sx; side = 0; }
      else { sideY += ddy; my += sy; side = 1; }
      if (mx < 0 || my < 0 || mx >= W || my >= H || map[my][mx]) break;
    }
    const rawDistance = side === 0 ? sideX - ddx : sideY - ddy;
    const distance = Math.max(0.04, rawDistance * Math.cos(angle - player.angle));
    const type = mx >= 0 && my >= 0 && mx < W && my < H ? map[my][mx] : 1;
    const hit = side === 0 ? player.y + rawDistance * dy : player.x + rawDistance * dx;
    return { dist: distance, side, type, tex: hit - Math.floor(hit), tileX: mx, tileY: my };
  }

  function drawSky() {
    const horizon = viewH * 0.5;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#3b88c9'); sky.addColorStop(0.42, '#7db9e0');
    sky.addColorStop(0.78, '#cfe1e4'); sky.addColorStop(1, '#f2e3c4');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, viewW, horizon + 2);

    // Slow-drifting cumulus clouds.
    const drift = elapsed * 5 * dpr;
    for (let i = 0; i < 7; i++) {
      const spread = viewW + 280 * dpr;
      const x = ((i * 233 * dpr + drift * (0.35 + i * 0.05)) % spread) - 120 * dpr;
      const y = viewH * (0.07 + (i % 3) * 0.075);
      const puff = (44 + (i % 4) * 15) * dpr;
      ctx.fillStyle = `rgba(255,252,244,${0.32 - (i % 3) * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(x, y, puff, puff * 0.3, 0, 0, Math.PI * 2);
      ctx.ellipse(x + puff * 0.66, y + puff * 0.1, puff * 0.62, puff * 0.28, 0, 0, Math.PI * 2);
      ctx.ellipse(x - puff * 0.58, y + puff * 0.15, puff * 0.48, puff * 0.23, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hazy hills behind the town.
    const hillColors = ['rgba(122,146,112,.45)', 'rgba(104,130,98,.5)'];
    hillColors.forEach((color, layer) => {
      const base = horizon + 1;
      const amplitude = viewH * (0.075 - layer * 0.015);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, base);
      for (let x = 0; x <= viewW; x += 12 * dpr) {
        const wave = Math.sin(x / (viewW * 0.23) + layer * 2.1) * amplitude * 0.6
          + Math.sin(x / (viewW * 0.08) + layer * 4.3) * amplitude * 0.35;
        ctx.lineTo(x, base - amplitude - wave);
      }
      ctx.lineTo(viewW, base); ctx.closePath(); ctx.fill();
    });

    // Distant whitewashed town with terracotta roofs.
    const skyline = [
      [0.01, 0.06, 0.105], [0.115, 0.043, 0.075], [0.19, 0.075, 0.12], [0.305, 0.038, 0.065],
      [0.365, 0.088, 0.15], [0.51, 0.05, 0.08], [0.585, 0.072, 0.115], [0.7, 0.042, 0.07],
      [0.765, 0.082, 0.135], [0.89, 0.052, 0.085], [0.955, 0.068, 0.1],
    ];
    for (const [offset, tall, wide] of skyline) {
      const x = offset * viewW, w = wide * viewW, h = tall * viewH;
      ctx.fillStyle = 'rgba(207,202,182,.62)';
      ctx.fillRect(x, horizon - h, w, h);
      ctx.fillStyle = 'rgba(170,108,80,.7)';
      ctx.beginPath();
      ctx.moveTo(x - 3 * dpr, horizon - h);
      ctx.lineTo(x + w * 0.5, horizon - h - 8 * dpr);
      ctx.lineTo(x + w + 3 * dpr, horizon - h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(72,104,106,.3)';
      ctx.fillRect(x + w * 0.3, horizon - h * 0.72, w * 0.14, h * 0.22);
      ctx.fillRect(x + w * 0.62, horizon - h * 0.72, w * 0.14, h * 0.22);
    }

    const haze = ctx.createLinearGradient(0, horizon - viewH * 0.15, 0, horizon);
    haze.addColorStop(0, 'rgba(244,231,202,0)');
    haze.addColorStop(1, 'rgba(246,232,201,.5)');
    ctx.fillStyle = haze; ctx.fillRect(0, horizon - viewH * 0.15, viewW, viewH * 0.15);
  }

  function drawWorld() {
    if (world3d) {
      ctx.clearRect(0, 0, viewW, viewH);
      const actors = !playing ? [] : (gameMode === 'online' ? remoteActors : bots);
      world3d.render(player, actors, viewPitch, innerWidth, innerHeight);
      drawWeapon();
      return;
    }
    drawSky();

    const floor = ctx.createLinearGradient(0, viewH * 0.5, 0, viewH);
    floor.addColorStop(0, '#cbbd9f'); floor.addColorStop(0.24, '#b0a185');
    floor.addColorStop(0.62, '#8a7c64'); floor.addColorStop(1, '#584f41');
    ctx.fillStyle = floor; ctx.fillRect(0, viewH * 0.5, viewW, viewH * 0.5);
    ctx.fillStyle = 'rgba(255,248,226,.16)';
    ctx.fillRect(0, viewH * 0.5, viewW, 2 * dpr);
    ctx.fillStyle = 'rgba(88,76,58,.08)';
    for (let i = 0; i < 11; i++) {
      ctx.fillRect((i * 0.092 + 0.03) * viewW, viewH * 0.5, Math.max(1, 1.4 * dpr), viewH * 0.5);
    }
    // Paving joints receding toward the horizon.
    const groundTop = viewH * 0.5;
    for (let i = 1; i <= 18; i++) {
      const t = i / 18;
      const y = groundTop + (viewH - groundTop) * t * t;
      ctx.fillStyle = `rgba(74,62,47,${0.05 + t * 0.07})`;
      ctx.fillRect(0, y, viewW, Math.max(1, (0.4 + t) * dpr));
    }
    // Warm sunlight pooling in the middle of the plaza.
    const sun = ctx.createRadialGradient(viewW * 0.58, viewH * 0.62, 0, viewW * 0.58, viewH * 0.62, viewW * 0.55);
    sun.addColorStop(0, 'rgba(255,236,190,.16)'); sun.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, groundTop, viewW, viewH - groundTop);

    const strip = Math.max(1, Math.floor(2 * dpr));
    const cols = Math.ceil(viewW / strip);
    zBuffer = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      const x = i * strip;
      const angle = player.angle - FOV / 2 + (i / cols) * FOV;
      const ray = castRay(angle);
      zBuffer[i] = ray.dist;
      const height = Math.min(viewH * 1.7, viewH / ray.dist * 0.78);
      const top = viewH * 0.5 - height * 0.5;
      const shade = clamp(1 - ray.dist / 30, 0.42, 1) * (ray.side ? 0.84 : 1);
      let base = ray.type === 2 ? [128, 160, 150]
        : ray.type === 3 ? [166, 128, 82]
          : ray.type === 4 ? [186, 118, 90]
            : [203, 189, 160];
      if (ray.tex < 0.03 || ray.tex > 0.97) base = base.map((value) => value * 0.74);
      ctx.fillStyle = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      ctx.fillRect(x, top, strip + 1, height);

      if (ray.type === 3) {
        // Shipping crates: plank lines, dark gaps, and steel corner straps.
        ctx.fillStyle = `rgba(74,48,26,${0.34 * shade})`;
        for (const f of [0.22, 0.47, 0.73]) ctx.fillRect(x, top + height * f, strip + 1, 1.3 * dpr);
        ctx.fillStyle = `rgba(42,34,24,${0.24 * shade})`;
        ctx.fillRect(x, top + height * 0.02, strip + 1, height * 0.05);
        ctx.fillRect(x, top + height * 0.93, strip + 1, height * 0.05);
        if (ray.tex < 0.05 || ray.tex > 0.95) {
          ctx.fillStyle = `rgba(88,84,70,${0.5 * shade})`;
          ctx.fillRect(x, top, strip + 1, height);
        }
      } else {
        // String course and baseboard.
        ctx.fillStyle = `rgba(96,80,60,${0.2 * shade})`;
        ctx.fillRect(x, top + height * 0.31, strip + 1, 1.2 * dpr);
        ctx.fillRect(x, top + height * 0.52, strip + 1, 1.5 * dpr);
        ctx.fillStyle = `rgba(62,52,40,${0.34 * shade})`;
        ctx.fillRect(x, top + height * 0.955, strip + 1, height * 0.045);
        const centre = Math.abs(ray.tex - 0.5);
        // Per-tile facade variation keeps long walls from looking cloned.
        const variant = (((ray.tileX | 0) * 73856093) ^ ((ray.tileY | 0) * 19349663)) >>> 0;
        const doorway = variant % 5 === 0;
        const shuttered = (variant >>> 3) % 3 === 0;
        if (!doorway && centre < 0.15) {
          const winTop = top + height * 0.34, winHeight = height * 0.25;
          ctx.fillStyle = `rgba(38,60,64,${0.68 * shade})`;
          ctx.fillRect(x, winTop, strip + 1, winHeight);
          ctx.fillStyle = `rgba(132,208,200,${0.24 * shade})`;
          ctx.fillRect(x, winTop + winHeight * 0.06, strip + 1, winHeight * 0.16);
          ctx.fillStyle = `rgba(58,44,32,${0.62 * shade})`;
          ctx.fillRect(x, winTop, strip + 1, Math.max(1, winHeight * 0.06));
          ctx.fillRect(x, winTop + winHeight * 0.48, strip + 1, Math.max(1, winHeight * 0.035));
          if (centre < 0.05) {
            ctx.fillStyle = `rgba(44,74,72,${0.55 * shade})`;
            ctx.fillRect(x, winTop - winHeight * 0.05, strip + 1, winHeight * 0.05);
          }
        } else if (shuttered && centre < 0.33) {
          // Iron shutters flanking some windows.
          ctx.fillStyle = `rgba(70,86,74,${0.34 * shade})`;
          ctx.fillRect(x, top + height * 0.31, strip + 1, height * 0.31);
          ctx.fillStyle = `rgba(44,58,48,${0.3 * shade})`;
          ctx.fillRect(x, top + height * 0.45, strip + 1, 1.1 * dpr);
        }
        if (ray.type === 4) {
          // Brick coursing.
          ctx.fillStyle = `rgba(88,48,34,${0.24 * shade})`;
          for (const f of [0.42, 0.68, 0.9]) ctx.fillRect(x, top + height * f, strip + 1, 1.1 * dpr);
        }
        if (ray.type === 2) {
          // Teal facade: painted band and climbing ivy near the eaves.
          ctx.fillStyle = `rgba(226,212,178,${0.5 * shade})`;
          ctx.fillRect(x, top + height * 0.62, strip + 1, 1.2 * dpr);
          if (ray.tex > 0.78 || (ray.tex > 0.2 && ray.tex < 0.26)) {
            ctx.fillStyle = `rgba(58,96,52,${0.5 * shade})`;
            ctx.fillRect(x, top + height * 0.04, strip + 1, height * 0.4);
            ctx.fillStyle = `rgba(96,140,74,${0.34 * shade})`;
            ctx.fillRect(x, top + height * 0.04, strip + 1, height * 0.08);
          }
        }
        // Arched doorway on ground level with a striped awning above it.
        if (doorway && centre < 0.12 && height > viewH * 0.22) {
          const doorTop = top + height * 0.63, doorHeight = height * 0.32;
          ctx.fillStyle = `rgba(48,34,24,${0.72 * shade})`;
          ctx.beginPath();
          ctx.moveTo(x, top + height * 0.95);
          ctx.lineTo(x, doorTop + doorHeight * 0.2);
          ctx.quadraticCurveTo(x, doorTop, x + strip * 0.5, doorTop);
          ctx.quadraticCurveTo(x + strip, doorTop, x + strip, doorTop + doorHeight * 0.2);
          ctx.lineTo(x + strip, top + height * 0.95);
          ctx.fill();
          const stripe = Math.floor(ray.tex * 16) % 2;
          const tealAwning = variant % 3 === 0;
          ctx.fillStyle = stripe
            ? (tealAwning ? `rgba(52,104,92,${0.85 * shade})` : `rgba(206,92,68,${0.82 * shade})`)
            : `rgba(234,220,192,${0.85 * shade})`;
          ctx.fillRect(x, doorTop - height * 0.045, strip + 1, height * 0.045);
          ctx.fillStyle = `rgba(48,36,28,${0.3 * shade})`;
          ctx.fillRect(x, doorTop, strip + 1, Math.max(1, height * 0.006));
        }
      }
      if (height > viewH * 0.1) {
        // Terracotta eaves.
        ctx.fillStyle = `rgba(173,104,72,${0.4 * shade})`;
        ctx.fillRect(x, top, strip + 1, Math.max(1.5, height * 0.032));
        ctx.fillStyle = `rgba(112,64,44,${0.3 * shade})`;
        ctx.fillRect(x, top + height * 0.032, strip + 1, Math.max(1, height * 0.008));
        if (height > viewH * 0.6) {
          ctx.fillStyle = `rgba(214,132,92,${0.22 * shade})`;
          ctx.fillRect(x, top, strip + 1, Math.max(1, height * 0.012));
        }
      }

      const fog = clamp((ray.dist - 9) / 25, 0, 0.6);
      if (fog) {
        ctx.fillStyle = `rgba(235,224,199,${fog * 0.55})`;
        ctx.fillRect(x, top, strip + 1, height);
      }
    }

    for (const [name, site] of Object.entries(MAP.sites)) {
      const point = projectPoint(site.x, site.y);
      if (!point || point.dist >= zAt(point.x)) continue;
      const size = clamp(viewH / point.dist * 0.045, 2, 12 * dpr);
      ctx.fillStyle = 'rgba(217,251,98,.76)';
      ctx.fillRect(point.x - size / 2, viewH * 0.53 - size, size, size * 1.5);
      ctx.fillStyle = 'rgba(217,251,98,.12)';
      ctx.beginPath(); ctx.arc(point.x, viewH * 0.53, size * 2, 0, Math.PI * 2); ctx.fill();
      if (point.dist < 10) {
        ctx.font = `bold ${Math.max(8, 8 * dpr)}px DM Mono, monospace`;
        ctx.fillStyle = '#d9fb62'; ctx.fillText(name, point.x + size, viewH * 0.53 - size);
      }
    }
    drawProps();
    drawActors();
    drawWeapon();
    const haze = ctx.createLinearGradient(0, viewH * 0.43, 0, viewH * 0.7);
    haze.addColorStop(0, 'rgba(240,226,192,0)'); haze.addColorStop(1, 'rgba(240,226,192,.07)');
    ctx.fillStyle = haze; ctx.fillRect(0, viewH * 0.43, viewW, viewH * 0.27);
  }

  function drawProps() {
    const props = MAP.props || [];
    if (!props.length) return;
    const visible = props.map((prop) => ({ prop, point: projectPoint(prop.x, prop.y) }))
      .filter((entry) => entry.point && entry.point.dist > 0.6 && entry.point.dist < 30 && entry.point.dist < zAt(entry.point.x) + 0.45)
      .sort((a, b) => b.point.dist - a.point.dist);
    for (const { prop, point } of visible) {
      const sway = Math.sin(elapsed * 0.9 + prop.x * 1.7) * 0.014;
      const unit = viewH / point.dist;
      const ground = viewH * 0.5 + viewH * 0.39 / point.dist;
      const size = unit * 0.4 * (prop.size || 1);
      const fog = clamp((point.dist - 8) / 22, 0, 0.55);
      const alpha = 1 - fog * 0.7;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (prop.type === 'tree') {
        ctx.fillStyle = '#6b4c31';
        ctx.fillRect(point.x - size * 0.05, ground - size * 0.78, size * 0.1, size * 0.8);
        ctx.fillStyle = '#4d7136';
        ctx.beginPath(); ctx.ellipse(point.x + sway * size, ground - size * 0.95, size * 0.42, size * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5f8a41';
        ctx.beginPath(); ctx.ellipse(point.x - size * 0.14 + sway * size, ground - size * 1.1, size * 0.3, size * 0.26, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#719c4e';
        ctx.beginPath(); ctx.ellipse(point.x + size * 0.16 + sway * size, ground - size * 1.05, size * 0.24, size * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(30,42,26,.28)';
        ctx.beginPath(); ctx.ellipse(point.x, ground, size * 0.34, size * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      } else if (prop.type === 'stall') {
        ctx.fillStyle = '#6d4a2c';
        ctx.fillRect(point.x - size * 0.4, ground - size * 0.62, size * 0.06, size * 0.62);
        ctx.fillRect(point.x + size * 0.34, ground - size * 0.62, size * 0.06, size * 0.62);
        ctx.fillStyle = '#8b6238';
        ctx.fillRect(point.x - size * 0.44, ground - size * 0.4, size * 0.88, size * 0.09);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? '#e8d6b6' : '#2f6a5d';
          ctx.fillRect(point.x - size * 0.5 + i * size * 0.2, ground - size * 0.78, size * 0.2, size * 0.12);
        }
        ctx.fillStyle = '#c9553c';
        ctx.fillRect(point.x - size * 0.3, ground - size * 0.52, size * 0.14, size * 0.12);
        ctx.fillStyle = '#d8b04a';
        ctx.fillRect(point.x - size * 0.06, ground - size * 0.52, size * 0.14, size * 0.12);
        ctx.fillStyle = '#7a9b4b';
        ctx.fillRect(point.x + size * 0.18, ground - size * 0.52, size * 0.14, size * 0.12);
      } else if (prop.type === 'umbrella') {
        ctx.fillStyle = '#7b7466';
        ctx.fillRect(point.x - size * 0.02, ground - size * 0.95, size * 0.04, size * 0.95);
        ctx.fillStyle = '#efe6d2';
        ctx.beginPath(); ctx.ellipse(point.x, ground - size * 0.98, size * 0.46, size * 0.17, 0, Math.PI, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c8815a';
        for (let i = -2; i <= 2; i += 2) {
          ctx.beginPath(); ctx.ellipse(point.x + i * size * 0.13, ground - size * 0.98, size * 0.12, size * 0.15, 0, Math.PI, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#8a6a4a';
        ctx.beginPath(); ctx.ellipse(point.x, ground, size * 0.3, size * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      } else if (prop.type === 'planter') {
        ctx.fillStyle = '#a3917a';
        ctx.fillRect(point.x - size * 0.22, ground - size * 0.34, size * 0.44, size * 0.34);
        ctx.fillStyle = '#8c7a63';
        ctx.fillRect(point.x - size * 0.25, ground - size * 0.4, size * 0.5, size * 0.08);
        ctx.fillStyle = '#4f7a3a';
        ctx.beginPath(); ctx.ellipse(point.x, ground - size * 0.5, size * 0.24, size * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c85a52';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.arc(point.x + i * size * 0.12, ground - size * 0.54 + Math.abs(i) * size * 0.03, size * 0.035, 0, Math.PI * 2); ctx.fill();
        }
      } else if (prop.type === 'barrel') {
        ctx.fillStyle = '#8a5a34';
        ctx.fillRect(point.x - size * 0.15, ground - size * 0.46, size * 0.3, size * 0.46);
        ctx.fillStyle = 'rgba(52,34,20,.5)';
        ctx.fillRect(point.x - size * 0.15, ground - size * 0.36, size * 0.3, size * 0.035);
        ctx.fillRect(point.x - size * 0.15, ground - size * 0.18, size * 0.3, size * 0.035);
        ctx.fillStyle = '#c9a86a';
        ctx.fillRect(point.x - size * 0.15, ground - size * 0.46, size * 0.3, size * 0.035);
      }
      ctx.restore();
    }
  }

  function projectPoint(x, y) {
    const dx = x - player.x, dy = y - player.y;
    const distance = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);
    if (Math.abs(angle) > FOV * 0.62 || distance < 0.1) return null;
    return { x: viewW * (0.5 + Math.tan(angle) / (2 * Math.tan(FOV / 2))), dist: distance, a: angle };
  }

  function zAt(x) {
    if (!zBuffer.length) return 99;
    const index = clamp(Math.floor(x / viewW * zBuffer.length), 0, zBuffer.length - 1);
    return zBuffer[index] || 99;
  }

  function actorRenderPosition(actor, now) {
    if (actor.renderFromX === undefined || actor.renderStart === undefined) return { x: actor.x, y: actor.y };
    const t = clamp((now - actor.renderStart) / 140, 0, 1);
    return {
      x: actor.renderFromX + (actor.x - actor.renderFromX) * t,
      y: actor.renderFromY + (actor.y - actor.renderFromY) * t,
    };
  }

  function drawActors() {
    const actors = gameMode === 'online' ? remoteActors : bots;
    const now = performance.now();
    const visible = actors.filter((actor) => actor.alive).map((actor) => {
      const pos = actorRenderPosition(actor, now);
      return { actor, pos, point: projectPoint(pos.x, pos.y) };
    }).filter((entry) => entry.point).sort((a, b) => b.point.dist - a.point.dist);

    for (const { actor, pos, point } of visible) {
      const sx = point.x, scale = viewH / point.dist, size = scale * 0.38, ground = viewH * 0.5 + scale * 0.38;
      if (point.dist >= zAt(sx) + 0.15) continue;
      const alpha = clamp(1 - Math.max(0, point.dist - 9) / 17, 0.45, 1);
      const sideColor = TEAM_COLORS[actor.team] || '#d9fb62';
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, ground + 3 * dpr, size * 0.52, size * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#252c29';
      ctx.fillRect(sx - size * 0.28, ground - size * 0.28, size * 0.22, size * 0.3);
      ctx.fillRect(sx + size * 0.05, ground - size * 0.28, size * 0.22, size * 0.3);
      ctx.fillStyle = '#111714';
      ctx.fillRect(sx - size * 0.33, ground - size * 0.035, size * 0.28, size * 0.08);
      ctx.fillRect(sx + size * 0.02, ground - size * 0.035, size * 0.3, size * 0.08);
      ctx.fillStyle = actor.hurt ? '#985d4f' : (actor.team === 'CT' ? '#36525a' : '#5a4139');
      ctx.beginPath();
      ctx.moveTo(sx - size * 0.3, ground - size * 0.77); ctx.lineTo(sx + size * 0.27, ground - size * 0.77);
      ctx.lineTo(sx + size * 0.34, ground - size * 0.31); ctx.lineTo(sx + size * 0.24, ground - size * 0.24);
      ctx.lineTo(sx - size * 0.27, ground - size * 0.24); ctx.lineTo(sx - size * 0.36, ground - size * 0.34);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#303630'; ctx.fillRect(sx - size * 0.18, ground - size * 0.7, size * 0.36, size * 0.28);
      ctx.fillStyle = sideColor; ctx.fillRect(sx - size * 0.045, ground - size * 0.68, size * 0.09, size * 0.23);
      ctx.fillStyle = '#7b624c';
      ctx.fillRect(sx - size * 0.4, ground - size * 0.72, size * 0.13, size * 0.29);
      ctx.fillRect(sx + size * 0.27, ground - size * 0.72, size * 0.13, size * 0.29);
      ctx.fillStyle = '#363d35'; ctx.beginPath(); ctx.arc(sx, ground - size * 0.88, size * 0.19, Math.PI, 0); ctx.lineTo(sx + size * 0.18, ground - size * 0.77); ctx.lineTo(sx - size * 0.18, ground - size * 0.77); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a87958'; ctx.fillRect(sx - size * 0.12, ground - size * 0.84, size * 0.24, size * 0.09);
      ctx.fillStyle = sideColor; ctx.fillRect(sx - size * 0.11, ground - size * 0.82, size * 0.22, Math.max(1, size * 0.025));
      ctx.fillStyle = '#171b18'; ctx.fillRect(sx + size * 0.17, ground - size * 0.59, size * 0.55, size * 0.055);
      ctx.fillRect(sx + size * 0.32, ground - size * 0.57, size * 0.08, size * 0.13);
      if (actor.fire) {
        ctx.fillStyle = '#ffbd63'; ctx.beginPath(); ctx.moveTo(sx - size * 0.8, ground - size * 0.69);
        ctx.lineTo(sx - size * 1.2, ground - size * 0.83); ctx.lineTo(sx - size * 1.08, ground - size * 0.67);
        ctx.lineTo(sx - size * 1.27, ground - size * 0.56); ctx.lineTo(sx - size * 0.76, ground - size * 0.59); ctx.fill();
      }
      const hp = clamp(Number(actor.hp) / 100, 0, 1);
      ctx.fillStyle = 'rgba(5,8,7,.75)'; ctx.fillRect(sx - size * 0.27, ground - size * 1.16, size * 0.54, Math.max(2, 2 * dpr));
      ctx.fillStyle = sideColor; ctx.fillRect(sx - size * 0.27, ground - size * 1.16, size * 0.54 * hp, Math.max(2, 2 * dpr));
      if (point.dist < 8 && size > 20 * dpr) {
        ctx.font = `${Math.max(7, Math.min(10, size * 0.09)) * dpr}px DM Mono, monospace`;
        ctx.textAlign = 'center'; ctx.fillStyle = sideColor;
        ctx.fillText(String(actor.name || actor.team).toUpperCase().slice(0, 14), sx, ground - size * 1.23);
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // First-person viewmodels — stylised Valorant-style weapon silhouettes with
  // gloved hands, cel-shaded metal, recoil, reloads and muzzle flash.
  // Local units put the muzzle toward -X and the origin at the trigger.
  // ---------------------------------------------------------------------------
  const GUN = {
    ink: '#090c0e', edge: 'rgba(6,9,11,.55)',
    steelDark: '#171d22', steel: '#242c33', steelMid: '#303a42', steelLight: '#46525c', steelHi: '#5f6d78',
    cream: '#ded8c4', creamDeep: '#b3ab93', creamShadow: '#8a836f',
    accent: '#d94550', accentDeep: '#8d2830',
    wood: '#5a4531', woodDark: '#3a2c20', woodLight: '#7a6044',
    glove: '#222a33', gloveMid: '#2e3843', gloveLight: '#3f4b57', gloveHi: '#55footer',
    sleeve: '#38455a', sleeveDark: '#26303f',
    brass: '#c9a24e',
  };
  GUN.gloveHi = '#5a6a78';

  const VIEWMODELS = {
    classic: { anchorX: 0.845, anchorY: 0.765, rotation: 0.19, scale: 1.06, muzzle: [-306, -20] },
    vandal: { anchorX: 0.878, anchorY: 0.878, rotation: 0.268, scale: 0.82, muzzle: [-660, -20] },
    marshal: { anchorX: 0.928, anchorY: 0.872, rotation: 0.238, scale: 0.82, muzzle: [-750, -22] },
  };

  function gunPoly(points, fill, outline = true) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) { ctx.strokeStyle = GUN.edge; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function gunRect(x, y, w, h, fill, outline = true) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (outline) { ctx.strokeStyle = GUN.edge; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
  }
  function gunLine(x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function gunStripes(x, y, width, height, count, color) {
    const step = width / count;
    for (let i = 0; i < count; i++) gunRect(x + i * step, y, Math.max(2, step * 0.4), height, color, false);
  }
  function gunGradient(x0, y0, x1, y1, stops) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  }

  // Rounded bar with a dark outline — the building block for hands.
  function gunCapsule(x1, y1, x2, y2, radius, fill, outline = true) {
    ctx.lineCap = 'round';
    if (outline) {
      ctx.strokeStyle = GUN.edge; ctx.lineWidth = radius * 2 + 4;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.strokeStyle = fill; ctx.lineWidth = radius * 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  // Forearm: a thick tapered capsule plus a cuff band.
  function drawSleeve(fromX, fromY, toX, toY, width) {
    const dx = toX - fromX, dy = toY - fromY;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const px = -uy, py = ux;
    const waist = width * 0.82;
    gunPoly([
      [fromX + px * width, fromY + py * width],
      [toX + px * waist, toY + py * waist],
      [toX - px * waist, toY - py * waist],
      [fromX - px * width, fromY - py * width],
    ], GUN.sleeve, true);
    // Cuff and fabric fold shading.
    gunPoly([
      [toX + px * waist * 0.12 - ux * 22, toY + py * waist * 0.12 - uy * 22],
      [toX + px * waist * 1.02 - ux * 22, toY + py * waist * 1.02 - uy * 22],
      [toX + px * waist * 1.02, toY + py * waist * 1.02],
      [toX + px * waist * 0.12, toY + py * waist * 0.12],
    ], GUN.sleeveDark, false);
    gunLine(fromX + px * width * 0.45, fromY + py * width * 0.45, toX + px * waist * 0.5, toY + py * waist * 0.5, 'rgba(255,255,255,.08)', 3);
  }

  // Back of a gloved hand: palm plus four knuckle plates and a thumb.
  function drawGlove(cx, cy, angle, scale = 1, dir = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(dir * scale, scale);
    // Palm and wrist.
    gunCapsule(-18, 44, 4, -18, 30, GUN.glove);
    gunCapsule(-20, 46, 0, 18, 17, GUN.gloveMid);
    // Knuckle plates across the top of the hand.
    for (let i = 0; i < 4; i++) {
      const off = -24 + i * 15;
      gunCapsule(off, -10, off + 3, -30, 8, GUN.gloveLight);
      gunCapsule(off, -12, off + 3, -27, 4, 'rgba(255,255,255,.12)', false);
    }
    // Thumb hooked along the side.
    gunCapsule(-26, 22, -46, 4, 12, GUN.gloveHi);
    gunCapsule(10, 30, 26, 44, 8, 'rgba(255,255,255,.06)', false);
    ctx.restore();
  }

  // Fingers curling around the front of a grip, drawn after the weapon.
  function drawFingerWrap(x, y, angle, count, length, spacing, radius = 9, dir = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(dir, 1);
    for (let i = 0; i < count; i++) {
      const yy = i * spacing;
      const taper = 1 - i * 0.07;
      gunCapsule(0, yy, length * taper, yy + 3, radius * taper, i % 2 ? GUN.gloveMid : GUN.glove);
      // Knuckle highlight on each finger.
      gunCapsule(length * taper * 0.72, yy + 1, length * taper, yy + 3, radius * taper * 0.55, GUN.gloveLight, false);
      gunLine(4, yy - radius * 0.3, length * taper * 0.8, yy + radius * 0.2, 'rgba(6,9,11,.35)', 2);
    }
    ctx.restore();
  }

  // A hand wrapped around a vertical grip. The glove sits on the near side of
  // the grip and the fingers cross in front of it, so it reads as a real hold.
  function drawGripHand(gripCenterX, topY, spread = 1) {
    // Three fingers crossing the grip, drawn first so the glove overlaps them.
    for (let i = 0; i < 3; i++) {
      const y = topY + i * 22 * spread;
      gunCapsule(gripCenterX + 34, y + 2, gripCenterX - 26, y + 7, 10 * spread, i % 2 ? GUN.gloveMid : GUN.glove);
      gunCapsule(gripCenterX - 26, y + 7, gripCenterX - 34, y + 15, 10 * spread, GUN.glove, false);
      gunLine(gripCenterX + 20, y + 1, gripCenterX - 14, y + 5, 'rgba(6,9,11,.4)', 2);
    }
    // Back of the hand and wrist on the near side.
    gunCapsule(gripCenterX + 52, topY - 6, gripCenterX + 66, topY + 66 * spread, 26, GUN.glove);
    gunCapsule(gripCenterX + 54, topY + 4, gripCenterX + 62, topY + 48 * spread, 15, GUN.gloveMid, false);
    for (let i = 0; i < 3; i++) {
      const y = topY + i * 22 * spread;
      gunCapsule(gripCenterX + 44, y, gripCenterX + 64, y + 3, 10 * spread, GUN.gloveLight, false);
      gunCapsule(gripCenterX + 44, y - 3, gripCenterX + 60, y - 1, 4 * spread, 'rgba(255,255,255,.14)', false);
    }
    // Knuckle plates on the near side of the glove.
    for (let i = 0; i < 3; i++) {
      const y = topY + 6 + i * 22 * spread;
      gunCapsule(gripCenterX + 50, y, gripCenterX + 20, y + 4, 11 * spread, GUN.gloveLight);
      gunCapsule(gripCenterX + 46, y - 4, gripCenterX + 28, y - 1, 4.5 * spread, 'rgba(255,255,255,.16)', false);
    }
    // Thumb laid over the top of the grip.
    gunCapsule(gripCenterX + 44, topY - 14, gripCenterX - 12, topY - 22, 11 * spread, GUN.gloveHi);
    gunCapsule(gripCenterX + 36, topY - 18, gripCenterX + 6, topY - 23, 4.5 * spread, 'rgba(255,255,255,.12)', false);
  }

  function drawMuzzleFlash(x, y, strength = 1) {
    const seed = Math.floor(lastShot) % 13;
    const wobble = 0.85 + ((seed * 37) % 23) / 80;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2 + (seed % 5 - 2) * 0.1);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 86 * strength);
    glow.addColorStop(0, 'rgba(255,250,226,.9)');
    glow.addColorStop(0.34, 'rgba(255,198,108,.55)');
    glow.addColorStop(1, 'rgba(255,132,36,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 86 * strength, 0, Math.PI * 2); ctx.fill();
    const flare = wobble * strength;
    const star = [[0, -64], [10, -22], [34, -8], [13, 7], [18, 24], [0, 44], [-18, 24], [-13, 7], [-34, -8], [-10, -22]];
    ctx.beginPath();
    ctx.moveTo(star[0][0] * flare, star[0][1] * flare);
    for (let i = 1; i < star.length; i++) ctx.lineTo(star[i][0] * flare, star[i][1] * flare);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,247,214,.95)';
    ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 13 * flare, 26 * flare, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,242,.98)'; ctx.fill();
    // Thin smoke curling off the muzzle.
    ctx.rotate(-0.5);
    ctx.strokeStyle = 'rgba(226,224,216,.22)';
    ctx.lineWidth = 9 * strength;
    ctx.beginPath();
    ctx.moveTo(-6, 18);
    ctx.quadraticCurveTo(26, 46, 4, 74);
    ctx.quadraticCurveTo(-16, 98, 12, 122);
    ctx.stroke();
    ctx.restore();
  }

  function drawShellCasing(x, y, now) {
    const age = now - lastShot;
    if (age < 0 || age > 320) return;
    const t = age / 320;
    ctx.save();
    ctx.translate(x + t * 52, y - Math.sin(t * Math.PI) * 34 + t * t * 96);
    ctx.rotate(t * 9);
    gunRect(-4, -9, 8, 18, GUN.brass, false);
    gunRect(-4, -9, 8, 4, '#e8cc84', false);
    gunRect(-4, 7, 8, 4, '#8d6c2c', false);
    ctx.restore();
  }

  // --- VANDAL ---------------------------------------------------------------
  function drawVandalView(motion) {
    const now = motion.now;
    // Arms run behind the weapon and off the bottom of the frame.
    drawSleeve(88, 120, 226, 300, 40);
    drawSleeve(-352, 58, -214, 224, 34);
    // Stock.
    gunPoly([[104, -34], [228, -16], [252, 44], [188, 92], [110, 60]], GUN.steelDark);
    gunPoly([[118, -26], [214, -12], [222, 6], [124, -10]], GUN.steelMid);
    gunPoly([[196, 60], [250, 46], [256, 62], [200, 78]], GUN.ink);
    gunPoly([[112, 4], [184, 14], [182, 44], [114, 34]], GUN.creamShadow);

    // Receiver.
    gunPoly([[-286, -46], [92, -46], [124, -10], [116, 46], [-266, 40], [-306, -6]], gunGradient(-286, -46, -266, 40, [
      [0, GUN.steelMid], [0.42, GUN.steel], [1, GUN.steelDark],
    ]));
    gunPoly([[-286, -46], [92, -46], [98, -34], [-278, -34]], GUN.steelLight);
    gunPoly([[-266, 34], [114, 40], [116, 46], [-266, 40]], GUN.ink, false);

    // Cream side plate with the red accent slash.
    gunPoly([[-252, -16], [52, -12], [66, 12], [22, 27], [-232, 23]], GUN.cream);
    gunPoly([[-252, -16], [-166, -14], [-178, 25], [-232, 23]], GUN.accent);
    gunPoly([[-166, -14], [-130, -13], [-142, 26], [-178, 25]], GUN.accentDeep);
    gunPoly([[-246, -11], [46, -7], [50, -1], [-244, -5]], 'rgba(255,255,255,.35)', false);
    gunPoly([[-224, 11], [16, 13], [19, 20], [-222, 18]], 'rgba(20,26,30,.22)', false);
    gunLine(-120, 24, 56, 15, GUN.creamDeep, 2);

    // Ejection port, charging handle, bolt.
    gunRect(-150, -14, 64, 21, GUN.ink);
    gunRect(-145, -10, 54, 12, '#070909');
    gunRect(-145, -10, 54, 4, 'rgba(255,255,255,.09)', false);
    gunPoly([[-58, -52], [-12, -52], [-8, -40], [-54, -40]], GUN.steelDark);
    gunStripes(-54, -50, 44, 8, 4, GUN.steelLight);

    // Pistol grip.
    gunPoly([[-4, 28], [72, 34], [90, 104], [42, 134], [-2, 100]], gunGradient(0, 28, 60, 134, [
      [0, GUN.steel], [1, GUN.steelDark],
    ]));
    gunStripes(8, 50, 50, 7, 4, GUN.steelLight);
    gunStripes(12, 68, 46, 7, 4, GUN.steelLight);
    gunPoly([[58, 38], [86, 42], [94, 72], [68, 68]], GUN.cream);
    // Trigger and guard.
    ctx.strokeStyle = GUN.steelMid; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-10, 32); ctx.quadraticCurveTo(-28, 60, 10, 72); ctx.quadraticCurveTo(42, 80, 56, 60); ctx.stroke();
    gunLine(8, 44, 22, 66, GUN.steelLight, 4);

    // Magazine (animated during reloads).
    const magDrop = motion.magDrop;
    ctx.save();
    ctx.translate(0, magDrop);
    if (magDrop) ctx.rotate(magDrop * 0.0018);
    gunPoly([[-178, 26], [-86, 30], [-58, 84], [-72, 166], [-150, 174], [-178, 90]], gunGradient(-178, 26, -80, 166, [
      [0, GUN.steelMid], [0.5, GUN.steel], [1, GUN.steelDark],
    ]));
    gunPoly([[-170, 36], [-94, 40], [-72, 90], [-86, 154], [-138, 160], [-162, 92]], GUN.steelDark);
    gunPoly([[-168, 40], [-142, 42], [-154, 154], [-162, 128]], 'rgba(255,255,255,.12)', false);
    gunPoly([[-150, 168], [-72, 162], [-68, 180], [-148, 186]], GUN.ink);
    gunRect(-154, 72, 72, 6, GUN.creamDeep, false);
    gunRect(-122, 86, 38, 28, GUN.accent, false);
    ctx.restore();

    // Handguard.
    gunPoly([[-500, -44], [-278, -44], [-268, 12], [-492, 16]], gunGradient(-500, -44, -492, 16, [
      [0, GUN.steelLight], [0.38, GUN.steelMid], [1, GUN.steelDark],
    ]));
    gunPoly([[-500, -44], [-278, -44], [-276, -34], [-498, -34]], GUN.steelHi);
    for (let i = 0; i < 4; i++) {
      gunPoly([[-460 + i * 44, -24], [-444 + i * 44, -24], [-438 + i * 44, 8], [-454 + i * 44, 8]], GUN.ink);
    }
    gunStripes(-494, 8, 208, 6, 10, GUN.steelDark);

    // Angled foregrip.
    gunPoly([[-410, 8], [-362, 6], [-336, 84], [-380, 96]], gunGradient(-410, 8, -356, 96, [
      [0, GUN.steelMid], [1, GUN.steelDark],
    ]));
    gunPoly([[-404, 20], [-368, 19], [-352, 74], [-386, 80]], GUN.creamDeep);
    gunRect(-398, 34, 24, 7, GUN.accent, false);

    // Barrel and muzzle brake.
    gunPoly([[-604, -34], [-478, -36], [-478, -8], [-604, -10]], gunGradient(-604, -34, -478, -10, [
      [0, GUN.steelDark], [0.55, GUN.steel], [1, GUN.steelMid],
    ]));
    gunPoly([[-604, -34], [-478, -36], [-478, -30], [-604, -28]], 'rgba(255,255,255,.14)', false);
    gunPoly([[-506, -48], [-474, -48], [-472, -26], [-504, -26]], GUN.steelMid);
    gunPoly([[-644, -40], [-600, -38], [-600, -4], [-644, -2]], GUN.ink);
    gunRect(-630, -34, 8, 28, GUN.steelDark, false);
    gunRect(-616, -34, 8, 28, GUN.steelDark, false);
    gunPoly([[-644, -40], [-600, -38], [-600, -33], [-644, -35]], GUN.steelLight, false);

    // Top rail, rear aperture and front post.
    gunPoly([[-478, -52], [-118, -52], [-118, -44], [-478, -44]], GUN.steelDark);
    gunStripes(-474, -50, 342, 6, 22, GUN.steelLight);
    gunPoly([[-200, -62], [-170, -62], [-168, -52], [-202, -52]], GUN.steelDark);
    ctx.strokeStyle = GUN.steel; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(-185, -66, 10, 0, Math.PI * 2); ctx.stroke();
    gunPoly([[-462, -54], [-446, -54], [-448, -96], [-462, -96]], GUN.steelMid);
    gunPoly([[-468, -100], [-440, -100], [-442, -88], [-466, -88]], GUN.steelLight);

    // Trigger hand wrapped around the pistol grip.
    drawGripHand(28, 46, 1.0);
    // Support hand clamped on the angled foregrip.
    drawGripHand(-414, 6, 0.88);

    if (now > 0 && now < muzzleUntil) drawMuzzleFlash(-764, -20, 1.25);
    if (now > 0) drawShellCasing(-118, -6, now);
  }

  // --- CLASSIC ---------------------------------------------------------------
  function drawClassicView(motion) {
    const now = motion.now;
    drawSleeve(96, 146, 238, 306, 42);
    // Grip (behind the slide so the frame reads correctly).
    gunPoly([[6, 26], [78, 32], [104, 158], [42, 176], [0, 86]], gunGradient(6, 26, 60, 170, [
      [0, GUN.steel], [1, GUN.steelDark],
    ]));
    gunPoly([[18, 44], [66, 50], [88, 150], [52, 160], [24, 82]], GUN.ink);
    gunStripes(30, 64, 44, 7, 3, GUN.steelLight);
    gunStripes(36, 84, 40, 7, 3, GUN.steelLight);
    gunRect(34, 146, 46, 9, GUN.creamDeep, false);
    gunPoly([[64, 36], [78, 38], [82, 78], [68, 76]], GUN.cream);
    gunRect(22, 172, 58, 14, GUN.steelDark);
    gunRect(22, 172, 58, 4, GUN.accentDeep, false);

    // Frame and dust cover.
    gunPoly([[-252, 14], [20, 14], [44, 40], [44, 76], [-224, 72], [-256, 38]], gunGradient(-252, 14, -224, 72, [
      [0, GUN.steelMid], [1, GUN.steelDark],
    ]));
    gunStripes(-24, 28, 36, 7, 3, GUN.steelLight);
    gunPoly([[-256, 36], [40, 40], [40, 48], [-250, 44]], GUN.ink, false);

    // Slide with cream panels and the red accent block.
    gunPoly([[-266, -36], [-20, -36], [16, -14], [16, 16], [-250, 18], [-286, -6]], gunGradient(-266, -36, -250, 18, [
      [0, GUN.steelHi], [0.35, GUN.steelMid], [1, GUN.steel],
    ]));
    gunPoly([[-266, -36], [-20, -36], [-22, -20], [-262, -20]], GUN.cream);
    gunPoly([[-252, -32], [-40, -32], [-42, -26], [-250, -26]], GUN.creamDeep, false);
    // Rear red receiver block and the forward chevron.
    gunPoly([[-266, -36], [-186, -36], [-192, -20], [-262, -20]], GUN.accent);
    gunPoly([[-186, -36], [-150, -36], [-156, -20], [-192, -20]], GUN.accentDeep);
    gunPoly([[-150, -36], [-20, -36], [-22, -30], [-152, -30]], GUN.accent, false);
    gunPoly([[-208, -30], [-176, -30], [-184, -18], [-198, -18]], 'rgba(20,26,30,.55)', false);
    gunPoly([[-140, -34], [-128, -34], [-132, -22], [-144, -22]], 'rgba(20,26,30,.4)', false);
    gunPoly([[-224, 0], [-4, 2], [0, 14], [-236, 12]], 'rgba(10,14,16,.3)', false);
    gunLine(-140, 12, 12, 10, GUN.steelLight, 2);
    // Muzzle and slide serrations.
    gunPoly([[-296, -32], [-262, -34], [-262, -6], [-296, -4]], GUN.ink);
    gunRect(-290, -28, 8, 20, GUN.steelDark, false);
    gunRect(-276, -28, 8, 20, GUN.steelDark, false);
    for (let i = 0; i < 4; i++) gunRect(-56 + i * 11, -26, 5, 36, 'rgba(8,11,13,.45)', false);
    // Hammer and sights.
    gunPoly([[-44, -36], [-18, -36], [-24, -58], [-46, -54]], GUN.steelDark);
    gunPoly([[-262, -36], [-250, -36], [-250, -52], [-262, -52]], GUN.steelMid);
    gunRect(-44, -44, 16, 8, GUN.steelLight, false);
    // Trigger and guard.
    ctx.strokeStyle = GUN.steelMid; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-4, 18); ctx.quadraticCurveTo(-40, 64, 14, 80); ctx.quadraticCurveTo(50, 86, 56, 58); ctx.stroke();
    gunLine(10, 26, 26, 64, GUN.steelLight, 4);

    // Trigger hand wrapped round the grip, thumb laid along the frame.
    drawGripHand(44, 58, 1.05);

    if (now > 0 && now < muzzleUntil) drawMuzzleFlash(-316, -20, 0.95);
  }

  // --- MARSHAL --------------------------------------------------------------
  function drawMarshalView(motion) {
    const now = motion.now;
    drawSleeve(70, 132, 214, 306, 42);
    drawSleeve(-388, 36, -250, 220, 34);
    // Stock and cheek rest.
    gunPoly([[96, -34], [232, -16], [262, 48], [192, 96], [102, 62]], gunGradient(96, -34, 110, 96, [
      [0, GUN.woodLight], [0.5, GUN.wood], [1, GUN.woodDark],
    ]));
    gunPoly([[104, 62], [192, 96], [198, 108], [102, 74]], GUN.ink);
    gunPoly([[126, -28], [214, -14], [220, 2], [130, -12]], 'rgba(255,240,210,.18)', false);
    gunPoly([[148, 40], [214, 30], [206, 66], [150, 60]], GUN.creamDeep);

    // Receiver.
    gunPoly([[-300, -38], [108, -38], [138, 4], [126, 46], [-276, 42], [-314, 4]], gunGradient(-300, -38, -278, 42, [
      [0, GUN.steelMid], [0.5, GUN.steel], [1, GUN.steelDark],
    ]));
    gunPoly([[-300, -38], [108, -38], [112, -28], [-292, -28]], GUN.steelLight);
    gunPoly([[-266, -14], [76, -10], [84, 14], [-254, 20]], GUN.cream);
    gunPoly([[-266, -14], [-184, -12], [-196, 22], [-254, 20]], GUN.accent);
    gunLine(-146, 24, 74, 20, GUN.creamDeep, 2);
    // Bolt handle.
    gunPoly([[-308, -20], [-284, -20], [-284, 12], [-308, 12]], GUN.steelDark);
    gunLine(-296, -8, -326, -28, GUN.steelLight, 8);
    ctx.fillStyle = GUN.steelMid; ctx.beginPath(); ctx.arc(-330, -32, 9, 0, Math.PI * 2); ctx.fill();

    // Pistol grip and trigger.
    gunPoly([[-20, 30], [58, 36], [76, 130], [24, 148], [-18, 94]], gunGradient(-20, 30, 40, 148, [
      [0, GUN.wood], [1, GUN.woodDark],
    ]));
    gunStripes(-6, 52, 48, 7, 3, GUN.woodLight);
    gunStripes(-2, 70, 44, 7, 3, GUN.woodLight);
    gunRect(-52, 144, 52, 13, GUN.steelDark);
    ctx.strokeStyle = GUN.steelMid; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-24, 34); ctx.quadraticCurveTo(-56, 76, 0, 90); ctx.quadraticCurveTo(38, 96, 44, 70); ctx.stroke();

    // Wooden handguard first, then the barrel on top of it.
    gunPoly([[-556, -46], [-310, -46], [-300, 22], [-548, 26]], gunGradient(-556, -46, -546, 26, [
      [0, GUN.woodLight], [0.45, GUN.wood], [1, GUN.woodDark],
    ]));
    gunPoly([[-556, -46], [-310, -46], [-308, -38], [-554, -38]], '#8a6f4e', false);
    for (let i = 0; i < 4; i++) {
      gunPoly([[-520 + i * 52, -26], [-500 + i * 52, -26], [-494 + i * 52, 8], [-514 + i * 52, 8]], '#1a1510');
    }
    gunPoly([[-556, 12], [-306, 16], [-304, 24], [-552, 22]], GUN.steelDark, false);

    // Barrel and muzzle brake.
    gunPoly([[-700, -36], [-292, -40], [-292, -8], [-700, -10]], gunGradient(-700, -36, -292, -10, [
      [0, GUN.steelDark], [0.4, GUN.steel], [0.75, GUN.steelMid], [1, GUN.steelDark],
    ]));
    gunPoly([[-700, -36], [-296, -40], [-296, -34], [-700, -30]], 'rgba(255,255,255,.18)', false);
    for (let i = 0; i < 3; i++) gunRect(-652 + i * 88, -22, 54, 3, GUN.ink, false);
    gunPoly([[-736, -44], [-696, -42], [-696, -4], [-736, -2]], GUN.ink);
    gunRect(-724, -38, 8, 32, GUN.steelDark, false);
    gunRect(-708, -38, 8, 32, GUN.steelDark, false);
    gunPoly([[-736, -44], [-696, -42], [-696, -37], [-736, -39]], GUN.steelLight, false);

    // Scope above everything: mounts, tube, objective bell, eyepiece, turrets.
    gunPoly([[-246, -44], [-218, -44], [-218, -88], [-246, -88]], GUN.steelDark);
    gunPoly([[-352, -44], [-324, -44], [-324, -88], [-352, -88]], GUN.steelDark);
    gunPoly([[-392, -78], [-198, -78], [-194, -96], [-388, -96]], gunGradient(-392, -96, -372, -78, [
      [0, GUN.steelMid], [0.45, GUN.steelLight], [1, GUN.steelDark],
    ]));
    gunPoly([[-384, -94], [-202, -94], [-202, -89], [-384, -89]], 'rgba(255,255,255,.24)', false);
    // Objective bell toward the muzzle.
    gunPoly([[-436, -74], [-388, -74], [-384, -108], [-442, -108]], GUN.steelMid);
    ctx.fillStyle = '#0c2026'; ctx.beginPath(); ctx.ellipse(-433, -91, 12, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,220,235,.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(-433, -91, 12, 17, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(180,240,250,.5)'; ctx.beginPath(); ctx.ellipse(-437, -97, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
    // Eyepiece.
    gunPoly([[-198, -76], [-164, -76], [-160, -98], [-196, -100]], GUN.steelMid);
    ctx.fillStyle = '#0b1114'; ctx.beginPath(); ctx.ellipse(-168, -88, 11, 15, 0, 0, Math.PI * 2); ctx.fill();
    // Turrets.
    gunRect(-300, -110, 20, 16, GUN.steelDark);
    gunRect(-294, -120, 9, 12, GUN.steelLight, false);
    gunRect(-286, -104, 18, 10, GUN.steelDark, false);

    // Trigger hand on the grip.
    drawGripHand(20, 50, 1.02);
    // Support hand under the wooden fore-end.
    drawGripHand(-446, -6, 0.9);

    if (now > 0 && now < muzzleUntil) drawMuzzleFlash(-770, -22, 1.45);
    if (now > 0) drawShellCasing(-236, 0, now);
  }

  function weaponMotion(now, weapon) {
    const moving = moveBlend;
    const breathX = Math.sin(now * 0.00085) * 3.4 * dpr;
    const breathY = Math.cos(now * 0.00115) * 2.6 * dpr;
    const bobX = Math.sin(bob * 8) * moving * 7 * dpr;
    const bobY = Math.abs(Math.cos(bob * 8)) * moving * 5 * dpr;
    const kickAge = now - lastShot;
    const kick = kickAge >= 0 && kickAge < 130 ? 1 - kickAge / 130 : 0;
    const kickEase = kick * kick;
    const recoilX = kickEase * 34 * dpr;
    const recoilY = -kickEase * 9 * dpr;
    const recoilTilt = -kickEase * 0.075;

    let reloadT = 0, reloadDip = 0, reloadTilt = 0, magDrop = 0;
    if (reloading) {
      const total = Math.max(0.2, (weapon.reloadMs || 1200) / 1000);
      reloadT = clamp(1 - reloadTimer / total, 0, 1);
      reloadDip = Math.sin(reloadT * Math.PI) * 128 * dpr;
      reloadTilt = Math.sin(reloadT * Math.PI) * 0.3;
      const magWindow = clamp((reloadT - 0.12) / 0.34, 0, 1);
      magDrop = Math.sin(magWindow * Math.PI) * 120 * dpr;
      if (reloadT > 0.52) magDrop = (1 - clamp((reloadT - 0.52) / 0.22, 0, 1)) * 30 * dpr;
    }
    return {
      now,
      x: breathX + bobX + recoilX,
      y: breathY + bobY + recoilY + reloadDip + (jump ? -jump * 30 * dpr : 0),
      tilt: Math.sin(bob * 4) * moving * 0.012 + recoilTilt + reloadTilt,
      magDrop,
      reloadT,
    };
  }

  function drawWeapon() {
    if (!player.alive) return;
    const weapon = WEAPONS[weaponIndex] || WEAPONS[1];
    const view = VIEWMODELS[weapon.id] || VIEWMODELS.vandal;
    const now = performance.now();
    const motion = weaponMotion(now, weapon);
    const scale = view.scale * clamp(viewH / 700, 0.58, 1.35) * clamp(viewW / 1120, 0.62, 1.15);
    const originX = viewW * view.anchorX + motion.x;
    const originY = viewH * view.anchorY + motion.y;
    const rotation = view.rotation + motion.tilt;

    ctx.save();
    ctx.translate(originX, originY);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);

    // Dark rim under the silhouette so it separates from bright sandstone.
    ctx.save();
    ctx.translate(0, 9);
    ctx.globalAlpha = 0.3;
    if (weapon.id === 'classic') drawClassicView({ ...motion, now: -1 });
    else if (weapon.id === 'marshal') drawMarshalView({ ...motion, now: -1 });
    else drawVandalView({ ...motion, now: -1 });
    ctx.restore();

    if (weapon.id === 'classic') drawClassicView(motion);
    else if (weapon.id === 'marshal') drawMarshalView(motion);
    else drawVandalView(motion);
    ctx.restore();

    // Screen-space bloom around the muzzle while firing.
    if (now < muzzleUntil) {
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      const mx = originX + (view.muzzle[0] * cos - view.muzzle[1] * sin) * scale;
      const my = originY + (view.muzzle[0] * sin + view.muzzle[1] * cos) * scale;
      const bloom = ctx.createRadialGradient(mx, my, 0, mx, my, 190 * dpr);
      bloom.addColorStop(0, 'rgba(255,232,170,.2)');
      bloom.addColorStop(0.4, 'rgba(255,190,110,.09)');
      bloom.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(mx - 190 * dpr, my - 190 * dpr, 380 * dpr, 380 * dpr);
    }
  }

  function moveActor(actor, targetX, targetY, dt, speed) {
    const dx = targetX - actor.x, dy = targetY - actor.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.06) return;
    const step = Math.min(speed * dt, distance);
    const vx = dx / distance * step, vy = dy / distance * step;
    if (!solid(actor.x + vx + Math.sign(vx) * 0.18, actor.y)) actor.x += vx;
    if (!solid(actor.x, actor.y + vy + Math.sign(vy) * 0.18)) actor.y += vy;
  }

  function movePlayer(dt) {
    if (!player.alive || buyOpen || leaderboardOpen) { jump = Math.max(0, jump - dt * 1.8); return; }
    const forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const strafe = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const length = Math.hypot(forward, strafe) || 1;
    const f = forward / length, s = strafe / length;
    const sprint = keys.ShiftLeft || keys.ShiftRight;
    const speed = (sprint ? 4.25 : 2.8) * dt;
    const vx = (Math.cos(player.angle) * f - Math.sin(player.angle) * s) * speed;
    const vy = (Math.sin(player.angle) * f + Math.cos(player.angle) * s) * speed;
    const radius = 0.2;
    if (!solid(player.x + vx + Math.sign(vx) * radius, player.y)) player.x += vx;
    if (!solid(player.x, player.y + vy + Math.sign(vy) * radius)) player.y += vy;
    const moving = Math.hypot(vx, vy) > 0;
    moveBlend += ((moving ? 1 : 0) - moveBlend) * Math.min(1, dt * 8);
    if (moving) bob += dt * (sprint ? 12 : 8);
    jump = Math.max(0, jump - dt * 1.8);
  }

  function localActors() { return [player, ...bots]; }

  function selectLocalTarget(bot) {
    let target = null, nearest = Infinity;
    for (const candidate of localActors()) {
      if (candidate === bot || !candidate.alive || candidate.team === bot.team) continue;
      const distance = Math.hypot(candidate.x - bot.x, candidate.y - bot.y);
      const visible = MAP.lineClear(bot.x, bot.y, candidate.x, candidate.y);
      const value = visible ? distance * 0.76 : distance;
      if (value < nearest) { nearest = value; target = candidate; }
    }
    return target;
  }

  function respawnLocal(actor) {
    const spawn = MAP.spawns[actor.team][actor.spawnSlot || 0];
    actor.x = spawn[0]; actor.y = spawn[1];
    actor.angle = spawnFacing[actor.team] ?? 0;
    const index = Number.isInteger(actor.weaponIndex) ? actor.weaponIndex : 1;
    const weapon = WEAPONS[index] || WEAPONS[1];
    actor.weaponIndex = index;
    actor.hp = actor.health = 100; actor.armor = actor === player ? 25 : 50;
    actor.ammo = weapon.mag; actor.reserve = weapon.reserve;
    actor.alive = true; actor.respawnAt = 0; actor.cooldown = 1 + Math.random() * 1.2;
    if (actor === player) {
      weaponStock[index].ammo = actor.ammo; weaponStock[index].reserve = actor.reserve;
      setToast('BACK IN THE FIGHT'); updateVitals(); updateAmmo();
    }
  }

  function patrolPoint(bot) {
    // Spread squadmates around their site instead of stacking on one tile.
    const site = MAP.sites[bot.objective] || MAP.sites.A;
    const slots = [0, 1, 2, 3, 5, 6, 7, 9, 10, 11];
    const slot = Number.isFinite(bot.spawnSlot) ? bot.spawnSlot : 0;
    const angle = (slot * 2.399) % (Math.PI * 2);
    const radius = 1.1 + (slots[(slot + (bot.patrolRound || 0)) % slots.length] % 5) * 0.42;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = angle + attempt * 1.05;
      const x = site.x + Math.cos(a) * radius;
      const y = site.y + Math.sin(a) * radius;
      if (!solid(x, y)) return [x, y];
    }
    return [site.x, site.y];
  }

  function updateBots(dt) {
    const now = Date.now();
    for (const bot of bots) {
      bot.hurt = Math.max(0, (Number(bot.hurt) || 0) - dt);
      bot.fire = Math.max(0, (Number(bot.fire) || 0) - dt);
      if (!bot.alive) {
        if (bot.respawnAt && now >= bot.respawnAt) respawnLocal(bot);
        continue;
      }
      const target = selectLocalTarget(bot);
      if (!target) continue;
      const dx = target.x - bot.x, dy = target.y - bot.y;
      const distance = Math.hypot(dx, dy);
      const seesTarget = MAP.lineClear(bot.x, bot.y, target.x, target.y);
      bot.stuckTime = (bot.stuckTime || 0);
      const previousX = bot.x, previousY = bot.y;
      // With no enemy in sight, squads take their assigned site like an
      // Ascent execute instead of all funneling through mid.
      let goalX = target.x, goalY = target.y;
      if (!seesTarget || distance > 9) {
        if (!bot.patrol || Math.hypot(bot.patrol[0] - bot.x, bot.patrol[1] - bot.y) < 1.1) {
          bot.patrolRound = (bot.patrolRound || 0) + 1;
          bot.patrol = patrolPoint(bot);
          if (Math.random() < 0.12) bot.objective = bot.objective === 'A' ? 'B' : 'A';
        }
        if (!seesTarget) { goalX = bot.patrol[0]; goalY = bot.patrol[1]; }
      }
      bot.angle = Math.atan2(seesTarget ? dy : goalY - bot.y, seesTarget ? dx : goalX - bot.x);
      if (distance > 4.1 || !seesTarget) {
        bot.pathTimer = (bot.pathTimer || 0) - dt;
        const targetTile = `${Math.floor(goalX)},${Math.floor(goalY)}`;
        if (bot.pathTimer <= 0 || bot.pathTarget !== targetTile || !bot.waypoint) {
          bot.waypoint = MAP.nextWaypoint(bot.x, bot.y, goalX, goalY);
          bot.pathTarget = targetTile;
          bot.pathTimer = 0.45 + Math.random() * 0.2;
        }
        const waypoint = bot.waypoint || [goalX, goalY];
        moveActor(bot, waypoint[0], waypoint[1], dt, bot.speed || 1.35);
        if (Math.hypot(bot.x - previousX, bot.y - previousY) < 0.001) bot.stuckTime += dt;
        else bot.stuckTime = 0;
        if (bot.stuckTime > 0.55) {
          bot.pathTimer = 0; bot.pathTarget = ''; bot.waypoint = null; bot.stuckTime = 0;
          bot.orbitSign = -(bot.orbitSign || 1);
        }
      } else {
        const side = bot.orbitSign || 1;
        const lateralX = -Math.sin(bot.angle) * side * dt * 0.46;
        const lateralY = Math.cos(bot.angle) * side * dt * 0.46;
        if (!solid(bot.x + lateralX + Math.sign(lateralX) * 0.16, bot.y) && !solid(bot.x, bot.y + lateralY + Math.sign(lateralY) * 0.16)) {
          bot.x += lateralX; bot.y += lateralY;
        } else bot.orbitSign = -side;
      }
      bot.cooldown -= dt;
      if (seesTarget && distance < 14 && bot.cooldown <= 0) {
        bot.cooldown = 1.45 + Math.random() * 1.05;
        bot.fire = 0.18;
        damageLocal(bot, target, 7 + Math.floor(Math.random() * 5));
      }
    }
    if (!player.alive && player.respawnAt && now >= player.respawnAt) respawnLocal(player);
  }

  function damageLocal(attacker, target, amount, weaponName = 'VANDAL') {
    if (!target.alive) return;
    const absorbed = Math.min(target.armor || 0, Math.ceil(amount * 0.58));
    target.armor = Math.max(0, (target.armor || 0) - absorbed);
    target.hp = Math.max(0, (target.hp === undefined ? target.health : target.hp) - (amount - absorbed));
    if (target === player) {
      target.health = target.hp;
      damageUntil = performance.now() + 180;
      updateVitals();
    }
    target.hurt = 0.16;
    if (target.hp <= 0) eliminateLocal(attacker, target, weaponName);
  }

  function eliminateLocal(attacker, target, weaponName = 'VANDAL') {
    if (!target.alive) return;
    target.alive = false; target.hp = 0; target.health = 0; target.deaths = (target.deaths || 0) + 1;
    target.respawnAt = Date.now() + 2400;
    if (attacker) {
      attacker.kills = (attacker.kills || 0) + 1;
      scores[attacker.team]++;
      if (attacker === player) { localElims++; player.money = Math.min(16000, player.money + KILL_REWARD); }
      addKillFeed(attacker.name || (attacker === player ? 'OPERATOR' : 'SQUAD'), target.name || 'OPERATOR', attacker.team, weaponName);
      if (target === player) setToast('ELIMINATED — RESPAWNING');
      else if (attacker === player) setToast(`${target.name || 'HOSTILE'} DOWN · +$${KILL_REWARD}`);
      updateScoreboard();
      if (scores[attacker.team] >= SCORE_LIMIT) finish(attacker.team === player.team);
    }
    if (target === player) updateVitals();
  }

  function playerState() { return { x: player.x, y: player.y, angle: player.angle, weaponIndex }; }

  function sendOnlineUpdate(now) {
    if (!onlineSession || networkInFlight || !playing || paused || now - lastNetworkSync < 110) return;
    networkInFlight = true;
    lastNetworkSync = now;
    window.RiftNetwork.update(onlineSession, playerState(), lastEventId)
      .then((response) => { lastNetworkSuccess = performance.now(); applySnapshot(response.snapshot); })
      .catch((error) => handleNetworkError(error))
      .finally(() => { networkInFlight = false; });
  }

  function handleNetworkError(error) {
    const message = error && error.message ? error.message : 'Network connection lost.';
    setConnectionLabel('NO LINK');
    setNetworkStatus(message, 'error');
  }

  function applySnapshot(snapshot) {
    if (!snapshot || !onlineSession) return;
    const previous = new Map(remoteActors.map((actor) => [actor.id, actor]));
    remoteActors = (snapshot.actors || []).filter((actor) => actor.id !== onlineSession.playerId).map((actor) => {
      const old = previous.get(actor.id);
      return {
        ...actor,
        renderFromX: old ? old.x : actor.x,
        renderFromY: old ? old.y : actor.y,
        renderStart: performance.now(),
      };
    });
    if (snapshot.you) {
      const you = snapshot.you;
      player.team = you.team;
      player.alive = you.alive;
      player.health = you.hp;
      player.hp = you.hp;
      player.armor = you.armor;
      player.money = you.money ?? player.money;
      player.kills = you.kills;
      player.deaths = you.deaths;
      player.shots = you.shots;
      player.hits = you.hits;
      if (Array.isArray(you.weaponStock)) weaponStock = you.weaponStock.map((item) => ({ ...item }));
      weaponIndex = Number.isInteger(you.weaponIndex) ? you.weaponIndex : weaponIndex;
      player.weaponIndex = weaponIndex;
      if (!reloading) { player.ammo = you.ammo; player.reserve = you.reserve; }
      if (you.alive) {
        player.x = you.x; player.y = you.y; player.angle = you.angle;
      }
      shots = you.shots || shots;
      hits = you.hits || hits;
      updateVitals(); updateWeaponUI();
    }
    scores = snapshot.scores || scores;
    updateScoreboard();
    for (const event of snapshot.events || []) {
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      if (event.type === 'kill') {
        addKillFeed(event.actorName, event.targetName, event.actorTeam, event.weapon);
        hitUntil = performance.now() + 115;
        if (event.actorId === onlineSession.playerId) localElims++;
        if (event.targetId === onlineSession.playerId) setToast('ELIMINATED — RESPAWNING');
        else if (event.actorId === onlineSession.playerId) setToast(`${event.targetName || 'HOSTILE'} DOWN · +$${KILL_REWARD}`);
      } else if (event.type === 'hit' && event.actorId === onlineSession.playerId) {
        hitUntil = performance.now() + 115;
      } else if (event.type === 'respawn' && event.actorId === onlineSession.playerId) {
        setToast('BACK IN THE FIGHT');
      } else if (event.type === 'buy' && event.actorId === onlineSession.playerId) {
        setBuyFeedback(`${event.item} PURCHASED. BALANCE ${formatMoney(event.money)}.`);
      } else if (event.type === 'equip' && event.actorId === onlineSession.playerId) {
        setToast(`${event.weapon} EQUIPPED`);
      } else if (event.type === 'join') {
        setToast(`${event.actorName} JOINED THE MATCH`);
      }
    }
    lastNetworkSuccess = performance.now();
    setConnectionLabel('ONLINE');
    updateObjective();
    if (snapshot.winner && playing) finish(snapshot.winner === player.team);
  }

  function saveActiveWeapon() {
    if (!weaponStock[weaponIndex]) return;
    weaponStock[weaponIndex].ammo = player.ammo;
    weaponStock[weaponIndex].reserve = player.reserve;
  }

  function updateWeaponUI() {
    const weapon = WEAPONS[weaponIndex] || WEAPONS[1];
    player.weaponIndex = weaponIndex;
    $('weaponName').textContent = weapon.name;
    $('weaponType').innerHTML = `${weapon.type} <i>▴</i>`;
    updateAmmo();
    paintWeaponIcons();
    if ($('buyCash')) $('buyCash').textContent = formatMoney(player.money);
    if (buyOpen) renderBuyMenu();
  }

  function switchWeapon(index, fromShop = false) {
    if (!playing || paused || !player.alive || reloading || (!fromShop && (buyOpen || leaderboardOpen))) return false;
    const stock = weaponStock[index];
    if (!Number.isInteger(index) || index < 0 || index >= WEAPONS.length || !stock || !stock.owned) {
      if (!fromShop && WEAPONS[index]) {
        setToast(`${WEAPONS[index].name} LOCKED — PRESS B TO BUY`);
        openBuyMenu();
      }
      return false;
    }
    saveActiveWeapon();
    weaponIndex = index; player.weaponIndex = index;
    player.ammo = stock.ammo; player.reserve = stock.reserve;
    updateWeaponUI();
    setToast(`${index + 1} — ${WEAPONS[index].name}`);
    if (gameMode === 'online' && onlineSession) {
      window.RiftNetwork.selectWeapon(onlineSession, index, lastEventId)
        .then((response) => applySnapshot(response.snapshot))
        .catch((error) => handleNetworkError(error));
    }
    return true;
  }

  function fire() {
    if (!playing || paused || buyOpen || leaderboardOpen || !player.alive || reloading) return;
    if (!player.ammo) { reload(); return; }
    const weapon = WEAPONS[weaponIndex] || WEAPONS[1];
    const now = performance.now();
    if (now - lastShot < weapon.interval) return;
    lastShot = now; player.ammo--; shots++; muzzleUntil = now + 75; saveActiveWeapon(); updateAmmo();

    if (gameMode === 'online' && onlineSession) {
      window.RiftNetwork.fire(onlineSession, playerState(), lastEventId)
        .then((response) => applySnapshot(response.snapshot))
        .catch((error) => handleNetworkError(error));
      return;
    }

    let target = null, best = 0.075;
    for (const actor of bots) {
      if (!actor.alive || actor.team === player.team) continue;
      const angle = Math.atan2(actor.y - player.y, actor.x - player.x);
      const delta = Math.abs(normalizeAngle(angle - player.angle));
      const distance = Math.hypot(actor.x - player.x, actor.y - player.y);
      const tolerance = Math.min(0.12, 0.045 + 0.15 / distance);
      if (delta < tolerance && MAP.lineClear(player.x, player.y, actor.x, actor.y) && delta < best) {
        best = delta; target = actor;
      }
    }
    if (target) {
      hits++; hitUntil = now + 115;
      damageLocal(player, target, weapon.damage, weapon.name);
    }
    if (!player.ammo) setTimeout(() => { if (playing && !paused) reload(); }, 260);
  }

  function reload() {
    const weapon = WEAPONS[weaponIndex] || WEAPONS[1];
    if (reloading || player.ammo >= weapon.mag || player.reserve <= 0 || !playing || !player.alive || buyOpen || leaderboardOpen) return;
    reloading = true; reloadTimer = weapon.reloadMs / 1000;
    $('reloadIndicator').classList.add('active');
    if (gameMode === 'online' && onlineSession) {
      window.RiftNetwork.reload(onlineSession, lastEventId)
        .then((response) => applySnapshot(response.snapshot))
        .catch((error) => handleNetworkError(error));
    }
  }

  function addKillFeed(attackerName, targetName, team, weaponName = 'VANDAL') {
    const row = document.createElement('div');
    row.className = 'kill-entry';
    const actor = document.createElement('b'); actor.textContent = String(attackerName || 'SQUAD').toUpperCase();
    const target = document.createElement('b'); target.textContent = String(targetName || 'OPERATOR').toUpperCase();
    const mark = document.createElement('span'); mark.textContent = '✕';
    const weapon = document.createElement('span'); weapon.textContent = String(weaponName || 'VANDAL').toUpperCase();
    row.style.borderRightColor = TEAM_COLORS[team] || 'var(--lime)';
    row.append(actor, mark, target, weapon);
    $('killFeed').prepend(row);
    while ($('killFeed').children.length > 4) $('killFeed').lastChild.remove();
  }

  function updateVitals() {
    $('healthValue').textContent = Math.max(0, Math.round(player.health));
    $('armorValue').textContent = Math.max(0, Math.round(player.armor));
    $('healthBar').style.width = clamp(player.health, 0, 100) + '%';
    document.querySelector('.armor-bar i').style.width = clamp(player.armor / 50 * 100, 0, 100) + '%';
    if (buyOpen) renderBuyMenu();
  }

  function updateAmmo() {
    $('ammoValue').textContent = Math.max(0, player.ammo);
    $('reserveValue').textContent = Math.max(0, player.reserve);
  }

  function formatMoney(amount) { return '$' + Math.max(0, Math.floor(Number(amount) || 0)).toLocaleString('en-US'); }

  function setBuyFeedback(message, isError = false) {
    const feedback = $('buyFeedback');
    feedback.textContent = message;
    feedback.classList.toggle('error', isError);
  }

  // Small side-profile silhouettes used in the HUD and armory cards.
  function drawWeaponIcon(canvas, id, color = '#839078') {
    if (!canvas || !canvas.getContext) return;
    const iconCtx = canvas.getContext('2d');
    if (!iconCtx) return;
    const width = canvas.width, height = canvas.height;
    iconCtx.clearRect(0, 0, width, height);
    // All silhouettes are authored in a 640 x 220 box, muzzle pointing left.
    const unit = Math.min(width / 660, height / 230);
    iconCtx.save();
    iconCtx.translate((width - 640 * unit) / 2, (height - 220 * unit) / 2);
    iconCtx.scale(unit, unit);
    iconCtx.fillStyle = color;
    const poly = (points) => {
      iconCtx.beginPath();
      iconCtx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) iconCtx.lineTo(points[i][0], points[i][1]);
      iconCtx.closePath(); iconCtx.fill();
    };
    const box = (x, y, w, h) => iconCtx.fillRect(x, y, w, h);
    if (id === 'classic') {
      // Slide + frame.
      poly([[64, 84], [404, 84], [430, 110], [428, 138], [86, 142], [40, 112]]);
      // Grip.
      poly([[300, 136], [386, 136], [420, 206], [346, 214], [286, 164]]);
      // Trigger guard.
      iconCtx.lineWidth = 12; iconCtx.strokeStyle = color; iconCtx.lineCap = 'round';
      iconCtx.beginPath(); iconCtx.arc(246, 152, 26, 0.15 * Math.PI, 0.85 * Math.PI); iconCtx.stroke();
      // Sights + muzzle detail.
      box(96, 66, 16, 20); box(372, 70, 14, 16); box(40, 94, 30, 34);
      // Grip texture.
      iconCtx.fillStyle = 'rgba(9,14,13,.28)';
      box(310, 156, 56, 8); box(318, 174, 52, 8);
    } else if (id === 'marshal') {
      // Stock + receiver.
      poly([[430, 92], [560, 84], [586, 120], [546, 160], [434, 146]]);
      poly([[92, 96], [446, 88], [470, 118], [462, 146], [96, 148]]);
      // Pistol grip.
      poly([[368, 142], [434, 140], [452, 208], [392, 214], [356, 168]]);
      // Wooden fore-end (slightly stepped).
      poly([[136, 92], [312, 86], [320, 122], [140, 130]]);
      // Barrel + muzzle brake.
      box(30, 100, 130, 20); box(0, 92, 40, 36);
      // Scope.
      box(196, 34, 150, 26);
      box(212, 58, 20, 24); box(306, 58, 20, 24);
      poly([[356, 40], [392, 40], [398, 66], [352, 66]]);
      // Trigger guard.
      iconCtx.lineWidth = 11; iconCtx.strokeStyle = color; iconCtx.lineCap = 'round';
      iconCtx.beginPath(); iconCtx.arc(330, 156, 24, 0.1 * Math.PI, 0.8 * Math.PI); iconCtx.stroke();
    } else {
      // Stock.
      poly([[452, 90], [576, 80], [600, 128], [548, 168], [456, 148]]);
      // Receiver.
      poly([[120, 88], [456, 84], [486, 118], [478, 150], [124, 156], [82, 124]]);
      // Handguard + barrel + brake.
      poly([[46, 96], [126, 92], [128, 150], [50, 154]]);
      box(0, 104, 58, 24); box(-4, 98, 22, 38);
      // Magazine (curved-ish).
      poly([[196, 152], [286, 150], [312, 212], [238, 220], [186, 176]]);
      // Pistol grip.
      poly([[330, 150], [404, 148], [420, 208], [360, 214], [318, 172]]);
      // Top rail, rear sight, charging handle.
      box(130, 76, 310, 12);
      box(300, 56, 22, 22);
      box(120, 66, 60, 12);
      // Magazine detail.
      iconCtx.fillStyle = 'rgba(9,14,13,.28)';
      box(206, 170, 62, 9); box(214, 188, 56, 9);
    }
    iconCtx.restore();
  }

  function paintWeaponIcons() {
    const glyph = document.querySelector('.weapon-glyph');
    if (glyph) drawWeaponIcon(glyph, (WEAPONS[weaponIndex] || WEAPONS[1]).id, '#9aa78c');
    document.querySelectorAll('.buy-weapon-icon').forEach((icon) => {
      drawWeaponIcon(icon, icon.dataset.weapon, '#c9d6bd');
    });
  }

  function addBuyCard(container, { title, details, price, action, disabled = false, active = false, status = '', weaponId = '' }) {
    const card = document.createElement('article');
    card.className = `buy-card${active ? ' active' : ''}`;
    const copy = document.createElement('div');
    if (weaponId) {
      const icon = document.createElement('canvas');
      icon.className = 'buy-weapon-icon';
      icon.width = 96; icon.height = 40;
      icon.dataset.weapon = weaponId;
      card.classList.add('has-icon');
      card.append(icon);
    }
    const heading = document.createElement('h3'); heading.textContent = title;
    const description = document.createElement('p'); description.textContent = details;
    const priceLabel = document.createElement('span'); priceLabel.className = 'buy-price'; priceLabel.textContent = status || `PRICE ${formatMoney(price)}`;
    copy.append(heading, description, priceLabel);
    const button = document.createElement('button'); button.className = 'buy-action'; button.type = 'button';
    button.textContent = active ? 'EQUIPPED' : status && status.startsWith('OWNED') ? 'EQUIP' : `BUY ${formatMoney(price)}`;
    button.disabled = disabled || active;
    if (!button.disabled) button.addEventListener('click', action);
    card.append(copy, button); container.append(card);
  }

  function renderBuyMenu() {
    if (!buyScreen) return;
    $('buyCash').textContent = formatMoney(player.money);
    const container = $('buyItems'); container.innerHTML = '';
    WEAPONS.forEach((weapon, index) => {
      const stock = weaponStock[index] || { owned: false };
      const isActive = index === weaponIndex;
      const status = stock.owned ? `OWNED · ${stock.ammo}/${weapon.mag} IN MAG` : '';
      addBuyCard(container, {
        title: weapon.name,
        details: `${weapon.type} · ${weapon.mag} ROUND MAG · ${weapon.damage} DAMAGE`,
        price: weapon.price,
        active: isActive,
        status,
        weaponId: weapon.id,
        disabled: !stock.owned && player.money < weapon.price,
        action: () => purchaseWeapon(index),
      });
    });
    const armorOwned = player.armor >= ARMOR_CAP;
    addBuyCard(container, {
      title: 'KEVLAR ARMOR',
      details: `REPAIR VEST · ${Math.max(0, ARMOR_CAP - player.armor)} ARMOR POINTS AVAILABLE`,
      price: ARMOR_PRICE,
      active: armorOwned,
      status: armorOwned ? 'ARMOR FULL' : `CURRENT ARMOR ${Math.round(player.armor)}/${ARMOR_CAP}`,
      disabled: armorOwned || player.money < ARMOR_PRICE,
      action: purchaseArmor,
    });
    paintWeaponIcons();
  }

  async function purchaseWeapon(index) {
    const weapon = WEAPONS[index], stock = weaponStock[index];
    if (!weapon || !stock) return;
    const buttonList = $('buyItems').querySelectorAll('button'); buttonList.forEach((button) => { button.disabled = true; });
    try {
      if (gameMode === 'online' && onlineSession) {
        const response = stock.owned
          ? await window.RiftNetwork.selectWeapon(onlineSession, index, lastEventId)
          : await window.RiftNetwork.buy(onlineSession, { kind: 'weapon', weaponIndex: index }, lastEventId);
        applySnapshot(response.snapshot);
      } else {
        if (!stock.owned) {
          if (player.money < weapon.price) throw new Error(`Not enough credits. ${weapon.name} costs ${formatMoney(weapon.price)}.`);
          player.money -= weapon.price;
          stock.owned = true; stock.ammo = weapon.mag; stock.reserve = weapon.reserve;
        }
        switchWeapon(index, true);
      }
      setBuyFeedback(`${weapon.name} READY · ${formatMoney(player.money)} REMAINING.`);
      renderBuyMenu();
    } catch (error) {
      setBuyFeedback(error.message, true);
      renderBuyMenu();
    }
  }

  async function purchaseArmor() {
    if (player.armor >= ARMOR_CAP) return;
    try {
      if (gameMode === 'online' && onlineSession) {
        const response = await window.RiftNetwork.buy(onlineSession, { kind: 'armor' }, lastEventId);
        applySnapshot(response.snapshot);
      } else {
        if (player.money < ARMOR_PRICE) throw new Error(`Not enough credits. Armor costs ${formatMoney(ARMOR_PRICE)}.`);
        player.money -= ARMOR_PRICE;
        player.armor = ARMOR_CAP;
        updateVitals();
      }
      setBuyFeedback(`ARMOR PURCHASED · ${formatMoney(player.money)} REMAINING.`);
      renderBuyMenu();
    } catch (error) {
      setBuyFeedback(error.message, true);
    }
  }

  function openBuyMenu() {
    if (!playing || paused || leaderboardOpen) return;
    if (!player.alive) { setToast('BUY AFTER RESPAWN'); return; }
    buyOpen = true; renderBuyMenu();
    buyScreen.classList.remove('hidden');
    document.exitPointerLock?.();
  }

  function closeBuyMenu() {
    if (!buyOpen) return;
    buyOpen = false; buyScreen.classList.add('hidden');
    if (playing && !paused && !leaderboardOpen) requestPointer();
  }

  function toggleBuyMenu() { if (buyOpen) closeBuyMenu(); else openBuyMenu(); }

  function renderLeaderboard() {
    if (!leaderboardScreen) return;
    $('leaderCtScore').textContent = String(scores.CT || 0).padStart(2, '0');
    $('leaderTScore').textContent = String(scores.T || 0).padStart(2, '0');
    const actors = (gameMode === 'online' ? [player, ...remoteActors] : [player, ...bots]).slice();
    actors.sort((a, b) => (b.kills || 0) - (a.kills || 0) || (a.deaths || 0) - (b.deaths || 0) || String(a.name).localeCompare(String(b.name)));
    const rows = $('leaderboardRows'); rows.innerHTML = '';
    actors.forEach((actor, index) => {
      const tr = document.createElement('tr');
      const local = actor === player || (onlineSession && actor.id === onlineSession.playerId);
      if (local) tr.className = 'local-row';
      const weapon = WEAPONS[actor.weaponIndex] || WEAPONS[1];
      const values = [String(index + 1).padStart(2, '0'), actor.name || 'OPERATOR', actor.team || player.team, weapon.name, String(actor.kills || 0), String(actor.deaths || 0), formatMoney(actor.money)];
      values.forEach((value, column) => {
        const td = document.createElement('td'); td.textContent = value;
        if (column === 0) td.className = 'rank';
        if (column === 1) td.className = 'callsign';
        if (column === 2) td.className = actor.team === 'T' ? 'side-t' : 'side-ct';
        if (column === 6) td.className = 'money';
        tr.append(td);
      });
      rows.append(tr);
    });
  }

  function openLeaderboard() {
    if (!playing || paused || buyOpen) return;
    leaderboardOpen = true; renderLeaderboard();
    leaderboardScreen.classList.remove('hidden');
    document.exitPointerLock?.();
  }

  function closeLeaderboard() {
    if (!leaderboardOpen) return;
    leaderboardOpen = false; leaderboardScreen.classList.add('hidden');
    if (playing && !paused && !buyOpen) requestPointer();
  }

  function updateObjective() {
    const actors = gameMode === 'online' ? remoteActors : bots;
    const alive = actors.filter((actor) => actor.team !== player.team && actor.alive).length;
    $('objectiveSub').textContent = `SITE A / SITE B · ${alive} ENEMY${alive === 1 ? '' : 'IES'} ALIVE`;
    $('teamLabel').textContent = `${player.team} SIDE`;
  }

  function updateScoreboard() {
    $('ctScore').textContent = String(scores.CT || 0).padStart(2, '0');
    $('tScore').textContent = String(scores.T || 0).padStart(2, '0');
    const own = scores[player.team] || 0;
    document.querySelectorAll('#roundProgress i').forEach((bar, index) => {
      bar.style.background = own >= (index + 1) * 3 ? 'var(--lime)' : 'rgba(225,235,213,.18)';
    });
    updateObjective();
    if (leaderboardOpen) renderLeaderboard();
    if (buyOpen) renderBuyMenu();
  }

  function setToast(text) {
    toastText = text;
    toastUntil = performance.now() + 1800;
  }

  function setNetworkStatus(text, kind = '') {
    const status = $('networkStatus');
    status.textContent = text;
    status.classList.toggle('error', kind === 'error');
    status.classList.toggle('success', kind === 'success');
  }

  function setConnectionLabel(text) { $('connectionLabel').textContent = text; }

  function createLocalBots() {
    bots = [];
    for (const team of ['CT', 'T']) {
      for (let slot = 0; slot < 5; slot++) {
        if (team === player.team && slot === 0) continue;
        const spawn = MAP.spawns[team][slot];
        const name = `${team === 'CT' ? 'SENTINEL' : 'RAIDER'} ${String(slot + 1).padStart(2, '0')}`;
        bots.push({
          id: `local-${team}-${slot}`, name, team, x: spawn[0], y: spawn[1],
          angle: spawnFacing[team] ?? 0,
          hp: 100, armor: 50, ammo: WEAPONS[1].mag, reserve: WEAPONS[1].reserve,
          weaponIndex: 1, money: 0, alive: true, kills: 0, deaths: 0,
          isHuman: false, hurt: 0, fire: 0, cooldown: 1.2 + Math.random() * 1.3,
          respawnAt: 0, spawnSlot: slot, speed: 1.35 + Math.random() * 0.3,
          pathTimer: 0, waypoint: null, pathTarget: '', orbitSign: Math.random() < 0.5 ? -1 : 1, stuckTime: 0,
          objective: slot % 2 === 0 ? 'A' : 'B', patrol: null, patrolTimer: 0,
        });
      }
    }
  }

  function setupMatch(mode) {
    gameMode = mode;
    scores = { CT: 0, T: 0 };
    player.team = chosenTeam; player.name = callsign();
    const spawn = MAP.spawns[player.team][0];
    player.x = spawn[0]; player.y = spawn[1];
    player.angle = spawnFacing[player.team] ?? 0;
    player.health = player.hp = 100; player.armor = 25; player.money = STARTING_CASH;
    weaponIndex = 1; player.weaponIndex = weaponIndex; weaponStock = createWeaponStock();
    player.ammo = WEAPONS[weaponIndex].mag; player.reserve = WEAPONS[weaponIndex].reserve; player.alive = true;
    player.kills = 0; player.deaths = 0; player.shots = 0; player.hits = 0; player.spawnSlot = 0; player.respawnAt = 0;
    bots = []; remoteActors = [];
    if (mode === 'offline') createLocalBots();
    elapsed = 0; shots = 0; hits = 0; localElims = 0;
    reloading = false; reloadTimer = 0; lastShot = 0; lastEventId = 0;
    buyOpen = false; leaderboardOpen = false;
    buyScreen.classList.add('hidden'); leaderboardScreen.classList.add('hidden');
    $('killFeed').innerHTML = ''; $('roundNum').textContent = '01';
    $('reloadIndicator').classList.remove('active');
    updateVitals(); updateWeaponUI(); updateScoreboard(); updateObjective();
  }

  function startMatch(mode = 'offline', initialSnapshot = null) {
    setupMatch(mode);
    viewPitch = 0;
    playing = true; paused = false;
    menu.classList.add('hidden'); result.classList.add('hidden'); pause.classList.add('hidden'); hud.classList.remove('hidden');
    $('roomHudTag').classList.toggle('hidden', !onlineSession);
    $('roomHudTag').textContent = onlineSession ? `ROOM ${onlineSession.code}` : '';
    setConnectionLabel(onlineSession ? 'ONLINE' : 'VS BOTS');
    if (onlineSession) {
      lastNetworkSuccess = performance.now(); lastNetworkSync = 0; networkInFlight = false;
      if (initialSnapshot) applySnapshot(initialSnapshot);
    }
    requestPointer(); setToast(onlineSession ? `ROOM ${onlineSession.code} — TAKE THE SITE` : '5V5 — ELIMINATE THE OTHER SQUAD');
    lastTime = performance.now();
  }

  async function leaveOnlineRoom() {
    const session = onlineSession;
    onlineSession = null;
    if (session) {
      try { await window.RiftNetwork.leave(session); } catch (_) { /* room may have expired */ }
    }
  }

  function callsign() { return $('playerName').value.trim().slice(0, 16) || 'OPERATOR'; }

  async function createOnlineRoom() {
    $('hostButton').disabled = true; $('joinButton').disabled = true;
    setNetworkStatus('Opening a secure room on this game server…');
    try {
      await leaveOnlineRoom();
      const response = await window.RiftNetwork.createRoom({ name: callsign(), team: chosenTeam });
      onlineSession = response.session;
      chosenTeam = response.snapshot.you.team;
      updateTeamSelection();
      $('roomCodeLabel').textContent = onlineSession.code;
      $('roomBanner').classList.remove('hidden');
      setNetworkStatus(`Room ${onlineSession.code} is live. Share the code to invite a friend.`, 'success');
      startMatch('online', response.snapshot);
    } catch (error) {
      setNetworkStatus(`${error.message} Start the game with “npm run dev” for online rooms.`, 'error');
    } finally {
      $('hostButton').disabled = false; $('joinButton').disabled = false;
    }
  }

  async function joinOnlineRoom() {
    const code = $('joinCode').value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
    if (code.length < 4) { setNetworkStatus('Enter the room code shared by the host.', 'error'); return; }
    $('hostButton').disabled = true; $('joinButton').disabled = true;
    setNetworkStatus(`Connecting to room ${code}…`);
    try {
      await leaveOnlineRoom();
      const response = await window.RiftNetwork.joinRoom(code, { name: callsign(), team: chosenTeam });
      onlineSession = response.session;
      chosenTeam = response.snapshot.you.team;
      updateTeamSelection();
      $('roomCodeLabel').textContent = onlineSession.code;
      $('roomBanner').classList.remove('hidden');
      $('joinCode').value = onlineSession.code;
      setNetworkStatus(`Connected to ${onlineSession.code} as ${chosenTeam}.`, 'success');
      startMatch('online', response.snapshot);
    } catch (error) {
      setNetworkStatus(error.message, 'error');
    } finally {
      $('hostButton').disabled = false; $('joinButton').disabled = false;
    }
  }

  function updateTeamSelection() {
    $('teamCtButton').classList.toggle('selected', chosenTeam === 'CT');
    $('teamTButton').classList.toggle('selected', chosenTeam === 'T');
  }

  async function quickPlay() {
    await leaveOnlineRoom();
    $('roomBanner').classList.add('hidden');
    setNetworkStatus('Local 5v5 match — four squad bots on each side.', 'success');
    startMatch('offline');
  }

  async function returnToMenu() {
    playing = false; paused = false; mouseHeld = false; buyOpen = false; leaderboardOpen = false;
    document.exitPointerLock?.();
    buyScreen.classList.add('hidden'); leaderboardScreen.classList.add('hidden');
    hud.classList.add('hidden'); pause.classList.add('hidden'); result.classList.add('hidden'); menu.classList.remove('hidden');
    if (onlineSession) await leaveOnlineRoom();
    $('roomBanner').classList.add('hidden');
    setConnectionLabel('OFFLINE');
  }

  function finish(won) {
    if (!playing) return;
    playing = false; paused = false; mouseHeld = false;
    document.exitPointerLock?.();
    buyOpen = false; leaderboardOpen = false; buyScreen.classList.add('hidden'); leaderboardScreen.classList.add('hidden');
    hud.classList.add('hidden'); pause.classList.add('hidden'); result.classList.remove('hidden');
    $('resultTag').textContent = won ? 'SQUAD VICTORY' : 'SQUAD DEFEAT';
    $('resultTitle').innerHTML = won ? 'ASCENT<br>SECURED.' : 'MATCH<br>LOST.';
    $('resultText').textContent = won ? 'Your team reached fifteen eliminations. Clean work.' : 'The other squad reached fifteen. Regroup and re-deploy.';
    $('accuracyResult').textContent = (shots ? Math.round(hits / shots * 100) : 0) + '%';
    $('killsResult').textContent = String(localElims).padStart(2, '0');
    $('timeResult').textContent = formatTime(elapsed);
    if (gameMode === 'online') $('againButton').innerHTML = '<span>BACK TO DEPLOYMENT</span><span class="button-arrow">↗</span>';
    else $('againButton').innerHTML = '<span>RUN IT BACK</span><span class="button-arrow">↗</span>';
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60), remainder = Math.floor(seconds % 60);
    return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
  }

  async function copyRoomCode() {
    if (!onlineSession) return;
    try {
      await navigator.clipboard.writeText(onlineSession.code);
      $('copyRoomButton').textContent = 'COPIED';
      setTimeout(() => { $('copyRoomButton').textContent = 'COPY'; }, 1200);
    } catch (_) {
      $('joinCode').value = onlineSession.code;
      $('joinCode').focus(); $('joinCode').select();
      setNetworkStatus('Room code selected — copy it to invite a friend.', 'success');
    }
  }

  function drawMap(targetCanvas, showRoster) {
    if (!targetCanvas) return;
    const mapCtx = targetCanvas.getContext('2d');
    const width = targetCanvas.width, height = targetCanvas.height;
    const scale = Math.min((width - 12) / W, (height - 12) / H);
    const offsetX = (width - W * scale) / 2, offsetY = (height - H * scale) / 2;
    const showLabels = width >= 300;
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.fillStyle = '#0b1212'; mapCtx.fillRect(0, 0, width, height);

    // Valorant-style plan: solid town blocks in slate, pale walkable ground.
    const solidColors = { 2: '#3d5a51', 3: '#8a6c42', 4: '#7c4938' };
    mapCtx.fillStyle = '#303e39';
    mapCtx.fillRect(offsetX, offsetY, W * scale, H * scale);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (map[y][x] !== 0) continue;
        mapCtx.fillStyle = (x + y) % 2 ? '#c2cec0' : '#cad5c8';
        mapCtx.fillRect(offsetX + x * scale, offsetY + y * scale, scale + 0.4, scale + 0.4);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = map[y][x];
        if (!tile || !solidColors[tile]) continue;
        mapCtx.fillStyle = solidColors[tile];
        mapCtx.fillRect(offsetX + x * scale, offsetY + y * scale, scale + 0.4, scale + 0.4);
      }
    }
    mapCtx.strokeStyle = 'rgba(8,14,13,.9)';
    mapCtx.lineWidth = Math.max(1, scale * 0.16);
    mapCtx.strokeRect(offsetX, offsetY, W * scale, H * scale);

    if (showLabels) {
      mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle';
      for (const callout of MAP.callouts || []) {
        if (callout.site || callout.spawn) continue;
        const x = offsetX + callout.x * scale, y = offsetY + callout.y * scale;
        mapCtx.font = `600 ${Math.max(7, scale * 1.25)}px DM Mono, monospace`;
        mapCtx.fillStyle = callout.minor ? 'rgba(52,72,64,.72)' : 'rgba(35,51,45,.9)';
        mapCtx.fillText(callout.label, x, y);
      }
    }

    for (const [name, site] of Object.entries(MAP.sites)) {
      const x = offsetX + site.x * scale, y = offsetY + site.y * scale;
      const radius = Math.max(5, scale * 0.58);
      mapCtx.beginPath(); mapCtx.arc(x, y, radius, 0, Math.PI * 2);
      mapCtx.fillStyle = 'rgba(14,24,20,.82)'; mapCtx.fill();
      mapCtx.lineWidth = Math.max(1, scale * 0.16); mapCtx.strokeStyle = '#d9fb62'; mapCtx.stroke();
      mapCtx.fillStyle = '#eaff9c';
      mapCtx.font = `bold ${Math.max(6, scale * 0.72)}px DM Mono, monospace`;
      mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle';
      mapCtx.fillText(name, x, y);
    }

    const paintActor = (actor, isLocal = false) => {
      if (!actor || (!actor.alive && !isLocal)) return;
      const x = offsetX + actor.x * scale, y = offsetY + actor.y * scale;
      const radius = Math.max(isLocal ? 3.2 : 2.1, scale * (isLocal ? 0.28 : 0.2));
      mapCtx.beginPath(); mapCtx.arc(x, y, radius, 0, Math.PI * 2);
      mapCtx.fillStyle = TEAM_COLORS[actor.team] || '#e8efdf'; mapCtx.fill();
      mapCtx.lineWidth = Math.max(0.7, scale * 0.06); mapCtx.strokeStyle = 'rgba(10,18,16,.85)'; mapCtx.stroke();
      if (isLocal) {
        mapCtx.strokeStyle = '#f3f4e9'; mapCtx.lineWidth = Math.max(1, scale * 0.08); mapCtx.stroke();
        mapCtx.strokeStyle = TEAM_COLORS[actor.team]; mapCtx.lineWidth = Math.max(1, scale * 0.12);
        mapCtx.beginPath(); mapCtx.moveTo(x, y); mapCtx.lineTo(x + Math.cos(actor.angle) * scale * 0.85, y + Math.sin(actor.angle) * scale * 0.85); mapCtx.stroke();
      }
    };
    if (showRoster && playing) {
      if (gameMode === 'online') remoteActors.forEach((actor) => paintActor(actor));
      else bots.forEach((actor) => paintActor(actor));
      paintActor(player, true);
    } else {
      MAP.spawns.CT.forEach((point, index) => paintActor({ x: point[0], y: point[1], angle: MAP.spawnFacing.CT, team: 'CT', alive: true }, index === 0));
      MAP.spawns.T.forEach((point) => paintActor({ x: point[0], y: point[1], angle: MAP.spawnFacing.T, team: 'T', alive: true }));
    }
  }

  function updateSiteIndicator() {
    let nearest = null, nearestDistance = Infinity;
    for (const [name, site] of Object.entries(MAP.sites)) {
      const distance = Math.hypot(site.x - player.x, site.y - player.y);
      if (distance < nearestDistance) { nearest = name; nearestDistance = distance; }
    }
    if (!nearest) return;
    $('siteLetter').textContent = nearest;
    $('siteName').textContent = nearestDistance < 3.4 ? `ON SITE ${nearest}` : `SITE ${nearest} · ${Math.round(nearestDistance)}M`;
  }

  function requestPointer() {
    if (canvas.requestPointerLock && innerWidth > 720) {
      try {
        const lock = canvas.requestPointerLock();
        if (lock && lock.catch) lock.catch(() => {});
      } catch (_) { /* pointer lock is optional */ }
    }
  }

  function togglePause() {
    if (!playing) return;
    paused = !paused;
    pause.classList.toggle('hidden', !paused);
    hud.classList.toggle('hidden', paused);
    if (paused) document.exitPointerLock?.();
    else { requestPointer(); lastTime = performance.now(); }
  }

  $('playButton').addEventListener('click', quickPlay);
  $('hostButton').addEventListener('click', createOnlineRoom);
  $('joinButton').addEventListener('click', joinOnlineRoom);
  $('joinCode').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6); });
  $('joinCode').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinOnlineRoom(); });
  $('copyRoomButton').addEventListener('click', copyRoomCode);
  $('teamCtButton').addEventListener('click', () => { chosenTeam = 'CT'; updateTeamSelection(); });
  $('teamTButton').addEventListener('click', () => { chosenTeam = 'T'; updateTeamSelection(); });
  $('againButton').addEventListener('click', () => gameMode === 'online' ? returnToMenu() : startMatch('offline'));
  $('resumeButton').addEventListener('click', () => { paused = false; pause.classList.add('hidden'); hud.classList.remove('hidden'); requestPointer(); lastTime = performance.now(); });
  $('buyCloseButton').addEventListener('click', closeBuyMenu);
  $('leaderboardButton').addEventListener('click', () => leaderboardOpen ? closeLeaderboard() : openLeaderboard());
  $('leaderboardCloseButton').addEventListener('click', closeLeaderboard);

  document.addEventListener('pointerlockchange', () => {
    if (playing && !document.pointerLockElement && innerWidth > 720 && !paused && !buyOpen && !leaderboardOpen) togglePause();
  });
  document.addEventListener('mousemove', (event) => {
    if (playing && !paused && !buyOpen && !leaderboardOpen) {
      const sensitivity = document.pointerLockElement === canvas ? 0.0025 : 0.004;
      player.angle = normalizeAngle(player.angle + event.movementX * sensitivity);
      viewPitch = clamp(viewPitch - event.movementY * sensitivity, -0.58, 0.58);
    }
  });
  canvas.addEventListener('mousedown', (event) => {
    if (!playing || paused) return;
    if (event.button === 0) { mouseHeld = true; fire(); }
  });
  window.addEventListener('mouseup', () => { mouseHeld = false; });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('keydown', (event) => {
    if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (event.code === 'Tab' && playing) {
      event.preventDefault();
      if (!leaderboardOpen) openLeaderboard();
      return;
    }
    keys[event.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape' && playing) {
      if (buyOpen) closeBuyMenu();
      else if (leaderboardOpen) closeLeaderboard();
      else if (document.pointerLockElement) document.exitPointerLock();
      else togglePause();
      return;
    }
    if (event.code === 'KeyB' && playing && !paused) { toggleBuyMenu(); return; }
    if (event.code === 'Digit1') { switchWeapon(0); return; }
    if (event.code === 'Digit2') { switchWeapon(1); return; }
    if (event.code === 'Digit3') { switchWeapon(2); return; }
    if (event.code === 'KeyR') reload();
    if (event.code === 'Space' && playing && !paused && jump === 0) jump = 1;
  });
  document.addEventListener('keyup', (event) => {
    keys[event.code] = false;
    if (event.code === 'Tab' && leaderboardOpen) closeLeaderboard();
  });
  window.addEventListener('blur', () => { keys = {}; mouseHeld = false; if (playing && !paused && !buyOpen && !leaderboardOpen) togglePause(); });

  function frame(now) {
    const dt = Math.min(0.04, (now - (lastTime || now)) / 1000);
    lastTime = now;
    if (playing && !paused) {
      elapsed += dt;
      movePlayer(dt);
      if (gameMode === 'online') sendOnlineUpdate(now);
      else updateBots(dt);
      if (mouseHeld) fire();
      if (reloading) {
        reloadTimer -= dt;
        if (reloadTimer <= 0) {
          if (gameMode === 'offline') {
            const amount = Math.min(WEAPONS[weaponIndex].mag - player.ammo, player.reserve);
            player.ammo += amount; player.reserve -= amount; saveActiveWeapon();
          }
          reloading = false;
          $('reloadIndicator').classList.remove('active');
          updateAmmo();
        }
      }
      $('clock').textContent = formatTime(elapsed);
      updateSiteIndicator();
      $('damageFlash').style.opacity = performance.now() < damageUntil ? '.8' : '0';
      $('hitMarker').classList.toggle('active', performance.now() < hitUntil);
      $('toast').textContent = performance.now() < toastUntil ? toastText : '';
      if (gameMode === 'online' && performance.now() - lastNetworkSuccess > 5000) setConnectionLabel('NO LINK');
    }
    drawWorld();
    drawMap(minimapCanvas, true);
    if (!playing) drawMap(previewCanvas, false);
    requestAnimationFrame(frame);
  }

  drawMap(previewCanvas, false);
  requestAnimationFrame(frame);
})();
