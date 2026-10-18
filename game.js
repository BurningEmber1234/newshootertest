(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (id) => document.getElementById(id);
  const menu = $('menuScreen'), hud = $('hud'), result = $('resultScreen'), pause = $('pauseScreen');
  const MAP = window.RiftMap;
  const W = MAP.width, H = MAP.height, map = MAP.grid, FOV = Math.PI * 0.39;
  const SCORE_LIMIT = 15;
  const TEAM_COLORS = { CT: '#63c2ed', T: '#f08466' };
  const TEAM_NAMES = { CT: 'COUNTER-TERRORISTS', T: 'TERRORISTS' };
  const player = { x: 3.3, y: 2.5, angle: 0.02, health: 100, armor: 50, ammo: 30, reserve: 90, team: 'CT', alive: true };
  let bots = [], remoteActors = [], keys = {}, chosenTeam = 'CT';
  let playing = false, paused = false, gameMode = 'offline', onlineSession = null;
  let reloading = false, reloadTimer = 0;
  let lastTime = 0, elapsed = 0, shots = 0, hits = 0, localElims = 0;
  let lastShot = 0, hitUntil = 0, muzzleUntil = 0, damageUntil = 0, bob = 0, moveBlend = 0, jump = 0, mouseHeld = false;
  let toastUntil = 0, toastText = '', zBuffer = [], viewW = 0, viewH = 0, dpr = 1;
  let scores = { CT: 0, T: 0 }, lastEventId = 0, networkInFlight = false, lastNetworkSync = 0, lastNetworkSuccess = 0;
  let previewCanvas = $('mapPreview'), minimapCanvas = $('minimap');

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
    while (steps++ < 52) {
      if (sideX < sideY) { sideX += ddx; mx += sx; side = 0; }
      else { sideY += ddy; my += sy; side = 1; }
      if (mx < 0 || my < 0 || mx >= W || my >= H || map[my][mx]) break;
    }
    const rawDistance = side === 0 ? sideX - ddx : sideY - ddy;
    const distance = Math.max(0.04, rawDistance * Math.cos(angle - player.angle));
    const type = mx >= 0 && my >= 0 && mx < W && my < H ? map[my][mx] : 1;
    const hit = side === 0 ? player.y + rawDistance * dy : player.x + rawDistance * dx;
    return { dist: distance, side, type, tex: hit - Math.floor(hit) };
  }

  function drawWorld() {
    const sky = ctx.createLinearGradient(0, 0, 0, viewH * 0.56);
    sky.addColorStop(0, '#202a2b'); sky.addColorStop(0.62, '#66706a'); sky.addColorStop(1, '#938d76');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, viewW, viewH * 0.56);
    const floor = ctx.createLinearGradient(0, viewH * 0.48, 0, viewH);
    floor.addColorStop(0, '#676456'); floor.addColorStop(0.26, '#403f37'); floor.addColorStop(1, '#161c1a');
    ctx.fillStyle = floor; ctx.fillRect(0, viewH * 0.48, viewW, viewH * 0.52);
    ctx.fillStyle = 'rgba(16,24,23,.19)';
    ctx.fillRect(0, viewH * 0.1, viewW, viewH * 0.022);
    ctx.fillRect(0, viewH * 0.19, viewW, viewH * 0.012);

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
      const shade = clamp(1 - ray.dist / 18, 0.22, 1) * (ray.side ? 0.76 : 1) * (ray.type === 3 ? 0.82 : 1);
      let base = ray.type === 2 ? [91, 102, 88] : ray.type === 3 ? [116, 106, 73] : [106, 113, 98];
      if (ray.tex < 0.035 || ray.tex > 0.965) base = base.map((value) => value * 0.68);
      ctx.fillStyle = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      ctx.fillRect(x, top, strip + 1, height);
      const horizontal = ((top + height * 0.27) % Math.max(16 * dpr, height * 0.19)) < 1.2 * dpr;
      if (horizontal) {
        ctx.fillStyle = `rgba(14,21,19,${0.14 * shade})`;
        ctx.fillRect(x, top + height * 0.27, strip + 1, 1.3 * dpr);
      }
      if (ray.type === 2 && ray.tex > 0.47 && ray.tex < 0.53) {
        ctx.fillStyle = `rgba(216,182,92,${shade * 0.58})`;
        ctx.fillRect(x, top + height * 0.72, strip + 1, Math.max(2, height * 0.018));
      }
      const fog = clamp((ray.dist - 7) / 16, 0, 0.72);
      if (fog) {
        ctx.fillStyle = `rgba(106,116,103,${fog * 0.45})`;
        ctx.fillRect(x, top, strip + 1, height);
      }
      if (i % Math.max(1, Math.floor(42 * dpr / strip)) === 0) {
        ctx.fillStyle = 'rgba(205,198,165,.035)';
        ctx.fillRect(x, viewH * 0.59, 1, viewH * 0.41);
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
    drawActors();
    drawWeapon();
    const haze = ctx.createLinearGradient(0, viewH * 0.43, 0, viewH * 0.7);
    haze.addColorStop(0, 'rgba(190,179,137,0)'); haze.addColorStop(1, 'rgba(172,155,112,.06)');
    ctx.fillStyle = haze; ctx.fillRect(0, viewH * 0.43, viewW, viewH * 0.27);
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
    if (!player.alive) { jump = Math.max(0, jump - dt * 1.8); return; }
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
    actor.angle = actor.team === 'CT' ? 0.15 : Math.PI + 0.15;
    actor.hp = actor.health = 100; actor.armor = 50; actor.ammo = 30; actor.reserve = 90;
    actor.alive = true; actor.respawnAt = 0; actor.cooldown = 1 + Math.random() * 1.2;
    if (actor === player) { setToast('BACK IN THE FIGHT'); updateVitals(); }
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
      bot.angle = Math.atan2(dy, dx);
      const seesTarget = MAP.lineClear(bot.x, bot.y, target.x, target.y);
      if (distance > 4.1 || !seesTarget) {
        bot.pathTimer = (bot.pathTimer || 0) - dt;
        const targetTile = `${Math.floor(target.x)},${Math.floor(target.y)}`;
        if (bot.pathTimer <= 0 || bot.pathTarget !== targetTile) {
          bot.waypoint = MAP.nextWaypoint(bot.x, bot.y, target.x, target.y);
          bot.pathTarget = targetTile;
          bot.pathTimer = 0.55 + Math.random() * 0.25;
        }
        const waypoint = bot.waypoint || [target.x, target.y];
        moveActor(bot, waypoint[0], waypoint[1], dt, bot.speed || 0.78);
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

  function damageLocal(attacker, target, amount) {
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
    if (target.hp <= 0) eliminateLocal(attacker, target);
  }

  function eliminateLocal(attacker, target) {
    if (!target.alive) return;
    target.alive = false; target.hp = 0; target.health = 0; target.deaths = (target.deaths || 0) + 1;
    target.respawnAt = Date.now() + 2400;
    if (attacker) {
      scores[attacker.team]++;
      if (attacker === player) localElims++;
      addKillFeed(attacker.name || (attacker === player ? 'OPERATOR' : 'SQUAD'), target.name || 'OPERATOR', attacker.team);
      if (target === player) setToast('ELIMINATED — RESPAWNING');
      else if (attacker === player) setToast(`${target.name || 'HOSTILE'} DOWN`);
      updateScoreboard();
      if (scores[attacker.team] >= SCORE_LIMIT) finish(attacker.team === player.team);
    }
    if (target === player) updateVitals();
  }

  function playerState() { return { x: player.x, y: player.y, angle: player.angle }; }

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
      if (!reloading) player.ammo = you.ammo;
      player.reserve = you.reserve;
      player.kills = you.kills;
      player.shots = you.shots;
      player.hits = you.hits;
      if (you.alive) {
        player.x = you.x; player.y = you.y; player.angle = you.angle;
      }
      shots = you.shots || shots;
      hits = you.hits || hits;
      updateVitals(); updateAmmo();
    }
    scores = snapshot.scores || scores;
    updateScoreboard();
    for (const event of snapshot.events || []) {
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      if (event.type === 'kill') {
        addKillFeed(event.actorName, event.targetName, event.actorTeam);
        hitUntil = performance.now() + 115;
        if (event.actorId === onlineSession.playerId) localElims++;
        if (event.targetId === onlineSession.playerId) setToast('ELIMINATED — RESPAWNING');
        else if (event.actorId === onlineSession.playerId) setToast(`${event.targetName || 'HOSTILE'} DOWN`);
      } else if (event.type === 'hit' && event.actorId === onlineSession.playerId) {
        hitUntil = performance.now() + 115;
      } else if (event.type === 'respawn' && event.actorId === onlineSession.playerId) {
        setToast('BACK IN THE FIGHT');
      } else if (event.type === 'join') {
        setToast(`${event.actorName} JOINED THE MATCH`);
      }
    }
    lastNetworkSuccess = performance.now();
    setConnectionLabel('ONLINE');
    updateObjective();
    if (snapshot.winner && playing) finish(snapshot.winner === player.team);
  }

  function fire() {
    if (!playing || paused || !player.alive || reloading) return;
    if (!player.ammo) { reload(); return; }
    const now = performance.now();
    if (now - lastShot < 105) return;
    lastShot = now; player.ammo--; shots++; muzzleUntil = now + 75; updateAmmo();

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
      damageLocal(player, target, 34);
    }
    if (!player.ammo) setTimeout(() => { if (playing && !paused) reload(); }, 260);
  }

  function reload() {
    if (reloading || player.ammo >= 30 || player.reserve <= 0 || !playing || !player.alive) return;
    reloading = true; reloadTimer = 1.45;
    $('reloadIndicator').classList.add('active');
    if (gameMode === 'online' && onlineSession) {
      window.RiftNetwork.reload(onlineSession, lastEventId)
        .then((response) => applySnapshot(response.snapshot))
        .catch((error) => handleNetworkError(error));
    }
  }

  function addKillFeed(attackerName, targetName, team) {
    const row = document.createElement('div');
    row.className = 'kill-entry';
    const actor = document.createElement('b'); actor.textContent = String(attackerName || 'SQUAD').toUpperCase();
    const target = document.createElement('b'); target.textContent = String(targetName || 'OPERATOR').toUpperCase();
    const mark = document.createElement('span'); mark.textContent = '✕';
    const weapon = document.createElement('span'); weapon.textContent = 'VANDAL';
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
  }

  function updateAmmo() {
    $('ammoValue').textContent = Math.max(0, player.ammo);
    $('reserveValue').textContent = Math.max(0, player.reserve);
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
          angle: team === 'CT' ? 0.15 : Math.PI + 0.15,
          hp: 100, armor: 50, ammo: 30, alive: true, kills: 0, deaths: 0,
          isHuman: false, hurt: 0, fire: 0, cooldown: 1.2 + Math.random() * 1.3,
          respawnAt: 0, spawnSlot: slot, speed: 1.05 + Math.random() * 0.25,
          pathTimer: 0, waypoint: null, pathTarget: '',
        });
      }
    }
  }

  function setupMatch(mode) {
    gameMode = mode;
    scores = { CT: 0, T: 0 };
    player.team = chosenTeam;
    const spawn = MAP.spawns[player.team][0];
    player.x = spawn[0]; player.y = spawn[1];
    player.angle = player.team === 'CT' ? 0.15 : Math.PI + 0.15;
    player.health = player.hp = 100; player.armor = 50;
    player.ammo = 30; player.reserve = 90; player.alive = true;
    player.kills = 0; player.deaths = 0; player.shots = 0; player.hits = 0; player.spawnSlot = 0; player.respawnAt = 0;
    bots = []; remoteActors = [];
    if (mode === 'offline') createLocalBots();
    elapsed = 0; shots = 0; hits = 0; localElims = 0;
    reloading = false; reloadTimer = 0; lastShot = 0; lastEventId = 0;
    $('ammoValue').textContent = '30'; $('reserveValue').textContent = '90';
    $('killFeed').innerHTML = ''; $('roundNum').textContent = '01';
    $('reloadIndicator').classList.remove('active');
    updateVitals(); updateAmmo(); updateScoreboard(); updateObjective();
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
    playing = false; paused = false; mouseHeld = false;
    document.exitPointerLock?.();
    hud.classList.add('hidden'); pause.classList.add('hidden'); result.classList.add('hidden'); menu.classList.remove('hidden');
    if (onlineSession) await leaveOnlineRoom();
    $('roomBanner').classList.add('hidden');
    setConnectionLabel('OFFLINE');
  }

  function finish(won) {
    if (!playing) return;
    playing = false; paused = false; mouseHeld = false;
    document.exitPointerLock?.();
    hud.classList.add('hidden'); pause.classList.add('hidden'); result.classList.remove('hidden');
    $('resultTag').textContent = won ? 'SQUAD VICTORY' : 'SQUAD DEFEAT';
    $('resultTitle').innerHTML = won ? 'DUSTLINE<br>SECURED.' : 'MATCH<br>LOST.';
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
    const scale = Math.min((width - 10) / W, (height - 10) / H);
    const offsetX = (width - W * scale) / 2, offsetY = (height - H * scale) / 2;
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.fillStyle = '#111916'; mapCtx.fillRect(0, 0, width, height);
    mapCtx.fillStyle = '#202a24'; mapCtx.fillRect(offsetX, offsetY, W * scale, H * scale);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = map[y][x];
        if (!tile) continue;
        mapCtx.fillStyle = tile === 2 ? '#59685a' : tile === 3 ? '#8a7856' : '#39433d';
        mapCtx.fillRect(offsetX + x * scale, offsetY + y * scale, scale - 0.5, scale - 0.5);
        if (tile === 3) {
          mapCtx.strokeStyle = 'rgba(20,25,19,.65)'; mapCtx.lineWidth = Math.max(0.5, scale * 0.06);
          mapCtx.beginPath(); mapCtx.moveTo(offsetX + x * scale, offsetY + y * scale); mapCtx.lineTo(offsetX + (x + 1) * scale, offsetY + (y + 1) * scale); mapCtx.stroke();
        }
      }
    }
    for (const [name, site] of Object.entries(MAP.sites)) {
      const x = offsetX + site.x * scale, y = offsetY + site.y * scale;
      mapCtx.beginPath(); mapCtx.arc(x, y, Math.max(4, scale * 0.48), 0, Math.PI * 2);
      mapCtx.fillStyle = 'rgba(217,251,98,.17)'; mapCtx.fill();
      mapCtx.lineWidth = Math.max(1, scale * 0.1); mapCtx.strokeStyle = '#d9fb62'; mapCtx.stroke();
      mapCtx.fillStyle = '#eaff9c'; mapCtx.font = `bold ${Math.max(5, scale * 0.5)}px DM Mono, monospace`;
      mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle'; mapCtx.fillText(name, x, y);
    }
    const paintActor = (actor, isLocal = false) => {
      if (!actor || (!actor.alive && !isLocal)) return;
      const x = offsetX + actor.x * scale, y = offsetY + actor.y * scale;
      const radius = Math.max(isLocal ? 3.2 : 2.1, scale * (isLocal ? 0.28 : 0.2));
      mapCtx.beginPath(); mapCtx.arc(x, y, radius, 0, Math.PI * 2);
      mapCtx.fillStyle = TEAM_COLORS[actor.team] || '#e8efdf'; mapCtx.fill();
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
      MAP.spawns.CT.forEach((point, index) => paintActor({ x: point[0], y: point[1], angle: 0.15, team: 'CT', alive: true }, index === 0));
      MAP.spawns.T.forEach((point) => paintActor({ x: point[0], y: point[1], angle: Math.PI + 0.15, team: 'T', alive: true }));
    }
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

  document.addEventListener('pointerlockchange', () => {
    if (playing && !document.pointerLockElement && innerWidth > 720 && !paused) togglePause();
  });
  document.addEventListener('mousemove', (event) => {
    if (playing && !paused) {
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
    keys[event.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape' && playing) {
      if (document.pointerLockElement) document.exitPointerLock();
      else togglePause();
    }
    if (event.code === 'KeyR') reload();
    if (event.code === 'Space' && playing && !paused && jump === 0) jump = 1;
  });
  document.addEventListener('keyup', (event) => { keys[event.code] = false; });
  window.addEventListener('blur', () => { keys = {}; mouseHeld = false; if (playing && !paused) togglePause(); });

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
            const amount = Math.min(30 - player.ammo, player.reserve);
            player.ammo += amount; player.reserve -= amount;
          }
          reloading = false;
          $('reloadIndicator').classList.remove('active');
          updateAmmo();
        }
      }
      $('clock').textContent = formatTime(elapsed);
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
