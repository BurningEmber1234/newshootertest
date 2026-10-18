(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (id) => document.getElementById(id);
  const menu = $('menuScreen'), hud = $('hud'), result = $('resultScreen'), pause = $('pauseScreen');
  const MAP = window.RiftMap;
  const WEAPONS = window.RiftWeapons;
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

  function drawWeapon() {
    const moving = moveBlend;
    const sway = Math.sin(bob * 8) * moving * 8 * dpr;
    const x = viewW * 0.67 + sway;
    const y = viewH * 0.93 + Math.abs(Math.cos(bob * 8)) * moving * 5 * dpr + (jump ? -jump * 22 * dpr : 0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.08 + Math.sin(bob * 4) * moving * 0.015);
    ctx.fillStyle = '#343b35'; ctx.beginPath(); ctx.moveTo(-30 * dpr, 16 * dpr); ctx.lineTo(80 * dpr, -58 * dpr); ctx.lineTo(118 * dpr, -18 * dpr); ctx.lineTo(35 * dpr, 38 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#565447'; ctx.beginPath(); ctx.moveTo(10 * dpr, 20 * dpr); ctx.lineTo(132 * dpr, -93 * dpr); ctx.lineTo(223 * dpr, -70 * dpr); ctx.lineTo(246 * dpr, -39 * dpr); ctx.lineTo(91 * dpr, 44 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#252b26'; ctx.beginPath(); ctx.moveTo(92 * dpr, 7 * dpr); ctx.lineTo(184 * dpr, -71 * dpr); ctx.lineTo(304 * dpr, -67 * dpr); ctx.lineTo(313 * dpr, -45 * dpr); ctx.lineTo(205 * dpr, -32 * dpr); ctx.lineTo(116 * dpr, 35 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#121714'; ctx.fillRect(265 * dpr, -68 * dpr, 166 * dpr, 13 * dpr); ctx.fillRect(397 * dpr, -73 * dpr, 38 * dpr, 4 * dpr);
    ctx.fillStyle = '#70735d'; ctx.fillRect(190 * dpr, -79 * dpr, 28 * dpr, 10 * dpr); ctx.fillStyle = '#151b16'; ctx.fillRect(197 * dpr, -82 * dpr, 14 * dpr, 7 * dpr);
    ctx.fillStyle = '#41483b'; ctx.beginPath(); ctx.moveTo(197 * dpr, -29 * dpr); ctx.lineTo(244 * dpr, -43 * dpr); ctx.lineTo(267 * dpr, 28 * dpr); ctx.lineTo(226 * dpr, 42 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#31352b'; ctx.fillRect(120 * dpr, 21 * dpr, 66 * dpr, 12 * dpr);
    if (performance.now() < muzzleUntil) {
      ctx.fillStyle = '#fff5c0'; ctx.beginPath(); ctx.moveTo(430 * dpr, -61 * dpr); ctx.lineTo(472 * dpr, -83 * dpr); ctx.lineTo(458 * dpr, -58 * dpr); ctx.lineTo(486 * dpr, -49 * dpr); ctx.lineTo(444 * dpr, -41 * dpr); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
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

  function addBuyCard(container, { title, details, price, action, disabled = false, active = false, status = '' }) {
    const card = document.createElement('article');
    card.className = `buy-card${active ? ' active' : ''}`;
    const copy = document.createElement('div');
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
      if (document.pointerLockElement === canvas) player.angle += event.movementX * 0.0025;
      else player.angle += event.movementX * 0.004;
      player.angle = normalizeAngle(player.angle);
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
