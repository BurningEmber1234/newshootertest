(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (id) => document.getElementById(id);
  const menu = $('menuScreen'), hud = $('hud'), result = $('resultScreen'), pause = $('pauseScreen');
  const W = 24, H = 24, FOV = Math.PI * 0.39;
  const map = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 1 : 0));
  const wall = (x, y, w, h, type = 1) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) map[yy][xx] = type; };
  // A compact industrial depot with lanes, crates, and a defensible central site.
  wall(6, 3, 1, 5, 2); wall(7, 7, 4, 1, 1); wall(11, 4, 1, 4, 2);
  wall(14, 3, 1, 5, 1); wall(16, 4, 4, 1, 2); wall(19, 5, 1, 3, 1);
  wall(3, 10, 5, 1, 2); wall(8, 10, 1, 4, 1); wall(11, 10, 4, 1, 1);
  wall(15, 10, 1, 4, 2); wall(17, 10, 4, 1, 1); wall(20, 11, 1, 4, 2);
  wall(3, 15, 1, 4, 1); wall(4, 18, 4, 1, 2); wall(8, 16, 1, 4, 1);
  wall(11, 15, 1, 5, 2); wall(13, 17, 4, 1, 1); wall(17, 15, 1, 5, 2);
  wall(19, 18, 3, 1, 1); wall(5, 5, 2, 1, 3); wall(13, 12, 2, 1, 3); wall(9, 20, 2, 1, 3);
  const player = { x: 3.3, y: 2.5, angle: 0.02, health: 100, armor: 75, ammo: 30, reserve: 90 };
  const spawns = [[12.2, 3.1], [17.5, 8.8], [10.2, 13.4], [19, 16.5], [4.6, 20.5]];
  let enemies = [], keys = {}, playing = false, paused = false, reloading = false, reloadTimer = 0;
  let lastTime = 0, elapsed = 0, shots = 0, hits = 0, killed = 0, lastShot = 0, toastUntil = 0, hitUntil = 0, muzzleUntil = 0, damageUntil = 0, bob = 0, moveBlend = 0, jump = 0, mouseHeld = false;
  let zBuffer = [], viewW = 0, viewH = 0, dpr = 1, toastText = '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normalizeAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  function resize() { dpr = Math.min(window.devicePixelRatio || 1, 1.4); viewW = Math.floor(innerWidth * dpr); viewH = Math.floor(innerHeight * dpr); canvas.width = viewW; canvas.height = viewH; canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px'; }
  window.addEventListener('resize', resize); resize();
  function solid(x, y) { const ix = Math.floor(x), iy = Math.floor(y); return ix < 0 || iy < 0 || ix >= W || iy >= H || map[iy][ix] !== 0; }
  function castRay(angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle); let mx = Math.floor(player.x), my = Math.floor(player.y);
    const ddx = Math.abs(1 / (dx || 1e-9)), ddy = Math.abs(1 / (dy || 1e-9));
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let sideX = (dx < 0 ? player.x - mx : mx + 1 - player.x) * ddx;
    let sideY = (dy < 0 ? player.y - my : my + 1 - player.y) * ddy;
    let side = 0, steps = 0;
    while (steps++ < 52) {
      if (sideX < sideY) { sideX += ddx; mx += sx; side = 0; } else { sideY += ddy; my += sy; side = 1; }
      if (mx < 0 || my < 0 || mx >= W || my >= H || map[my][mx]) break;
    }
    let dist = side === 0 ? sideX - ddx : sideY - ddy;
    dist = Math.max(.04, dist * Math.cos(angle - player.angle));
    const type = (mx >= 0 && my >= 0 && mx < W && my < H) ? map[my][mx] : 1;
    const hit = side === 0 ? player.y + dist / Math.max(.001, Math.cos(angle - player.angle)) * dy : player.x + dist / Math.max(.001, Math.cos(angle - player.angle)) * dx;
    return { dist, side, type, tex: hit - Math.floor(hit) };
  }
  function drawWorld(dt) {
    const sky = ctx.createLinearGradient(0, 0, 0, viewH * .56); sky.addColorStop(0, '#202a2b'); sky.addColorStop(.62, '#66706a'); sky.addColorStop(1, '#938d76'); ctx.fillStyle = sky; ctx.fillRect(0, 0, viewW, viewH * .56);
    const floor = ctx.createLinearGradient(0, viewH * .48, 0, viewH); floor.addColorStop(0, '#676456'); floor.addColorStop(.26, '#403f37'); floor.addColorStop(1, '#161c1a'); ctx.fillStyle = floor; ctx.fillRect(0, viewH * .48, viewW, viewH * .52);
    // Soft industrial roof beams and a distant haze band.
    ctx.fillStyle = 'rgba(16,24,23,.19)'; ctx.fillRect(0, viewH * .1, viewW, viewH * .022); ctx.fillRect(0, viewH * .19, viewW, viewH * .012);
    const strip = Math.max(1, Math.floor(2 * dpr)); const cols = Math.ceil(viewW / strip); zBuffer = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      const x = i * strip, angle = player.angle - FOV / 2 + (i / cols) * FOV; const ray = castRay(angle); zBuffer[i] = ray.dist;
      const height = Math.min(viewH * 1.7, viewH / ray.dist * .78); const top = viewH * .5 - height * .5;
      const shade = clamp(1 - ray.dist / 18, .22, 1) * (ray.side ? .76 : 1) * (ray.type === 3 ? .82 : 1);
      let base = ray.type === 2 ? [91, 102, 88] : ray.type === 3 ? [116, 106, 73] : [106, 113, 98];
      if (ray.tex < .035 || ray.tex > .965) base = base.map(v => v * .68);
      const light = Math.round(shade * 255);
      ctx.fillStyle = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      ctx.fillRect(x, top, strip + 1, height);
      // Regular concrete panel seams and occasional amber hazard strips.
      const horizontal = ((top + height * .27) % Math.max(16 * dpr, height * .19)) < 1.2 * dpr;
      if (horizontal) { ctx.fillStyle = `rgba(14,21,19,${.14 * shade})`; ctx.fillRect(x, top + height * .27, strip + 1, 1.3 * dpr); }
      if (ray.type === 2 && ray.tex > .47 && ray.tex < .53) { ctx.fillStyle = `rgba(216,182,92,${shade * .58})`; ctx.fillRect(x, top + height * .72, strip + 1, Math.max(2, height * .018)); }
      const fog = clamp((ray.dist - 7) / 16, 0, .72); if (fog) { ctx.fillStyle = `rgba(106,116,103,${fog * .45})`; ctx.fillRect(x, top, strip + 1, height); }
      // Floor perspective seams imply concrete slabs.
      if (i % Math.max(1, Math.floor(42 * dpr / strip)) === 0) { ctx.fillStyle = 'rgba(205,198,165,.035)'; ctx.fillRect(x, viewH * .59, 1, viewH * .41); }
      void light;
    }
    // Low site marker in the world, visible as a small projected beacon.
    const site = projectPoint(13.1, 12.3); if (site && site.dist < zAt(site.x)) { const s = clamp(viewH / site.dist * .05, 2, 13 * dpr); ctx.fillStyle = 'rgba(218,251,98,.75)'; ctx.fillRect(site.x - s / 2, viewH * .53 - s, s, s * 1.4); ctx.fillStyle = 'rgba(218,251,98,.2)'; ctx.beginPath(); ctx.arc(site.x, viewH * .53, s * 2, 0, Math.PI * 2); ctx.fill(); }
    drawEnemies(); drawWeapon();
    // Subtle motion/film texture overlays.
    const haze = ctx.createLinearGradient(0, viewH * .43, 0, viewH * .7); haze.addColorStop(0, 'rgba(190,179,137,0)'); haze.addColorStop(1, 'rgba(172,155,112,.06)'); ctx.fillStyle = haze; ctx.fillRect(0, viewH * .43, viewW, viewH * .27);
  }
  function projectPoint(x, y) { const dx = x - player.x, dy = y - player.y; const dist = Math.hypot(dx, dy); const a = normalizeAngle(Math.atan2(dy, dx) - player.angle); if (Math.abs(a) > FOV * .62 || dist < .1) return null; return { x: viewW * (.5 + Math.tan(a) / (2 * Math.tan(FOV / 2))), dist, a }; }
  function zAt(x) { const index = clamp(Math.floor(x / viewW * zBuffer.length), 0, zBuffer.length - 1); return zBuffer[index] || 99; }
  function drawEnemies() {
    const visible = enemies.filter(e => e.alive).map(e => ({ e, p: projectPoint(e.x, e.y) })).filter(o => o.p).sort((a, b) => b.p.dist - a.p.dist);
    for (const { e, p } of visible) {
      const sx = p.x, scale = viewH / p.dist, size = scale * .38, ground = viewH * .5 + scale * .38;
      if (p.dist >= zAt(sx) + .15) continue;
      const alpha = clamp(1 - Math.max(0, p.dist - 9) / 17, .45, 1); ctx.save(); ctx.globalAlpha = alpha;
      // Long shadow.
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, ground + 3 * dpr, size * .52, size * .12, 0, 0, Math.PI * 2); ctx.fill();
      // Legs and boots.
      ctx.fillStyle = '#252c29'; ctx.fillRect(sx - size * .28, ground - size * .28, size * .22, size * .3); ctx.fillRect(sx + size * .05, ground - size * .28, size * .22, size * .3);
      ctx.fillStyle = '#111714'; ctx.fillRect(sx - size * .33, ground - size * .035, size * .28, size * .08); ctx.fillRect(sx + size * .02, ground - size * .035, size * .3, size * .08);
      // Armored body, plate carrier and shoulder pads.
      ctx.fillStyle = e.hurt > 0 ? '#985d4f' : '#454c40'; ctx.beginPath(); ctx.moveTo(sx - size * .3, ground - size * .77); ctx.lineTo(sx + size * .27, ground - size * .77); ctx.lineTo(sx + size * .34, ground - size * .31); ctx.lineTo(sx + size * .24, ground - size * .24); ctx.lineTo(sx - size * .27, ground - size * .24); ctx.lineTo(sx - size * .36, ground - size * .34); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#303630'; ctx.fillRect(sx - size * .18, ground - size * .7, size * .36, size * .28); ctx.fillStyle = '#b97852'; ctx.fillRect(sx - size * .06, ground - size * .65, size * .12, size * .12);
      ctx.fillStyle = '#7b624c'; ctx.fillRect(sx - size * .4, ground - size * .72, size * .13, size * .29); ctx.fillRect(sx + size * .27, ground - size * .72, size * .13, size * .29);
      // Helmet and face slit.
      ctx.fillStyle = '#363d35'; ctx.beginPath(); ctx.arc(sx, ground - size * .88, size * .19, Math.PI, 0); ctx.lineTo(sx + size * .18, ground - size * .77); ctx.lineTo(sx - size * .18, ground - size * .77); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a87958'; ctx.fillRect(sx - size * .12, ground - size * .84, size * .24, size * .09); ctx.fillStyle = '#d9fb62'; ctx.fillRect(sx - size * .11, ground - size * .82, size * .22, Math.max(1, size * .025));
      // Rifle and muzzle flash.
      ctx.fillStyle = '#171b18'; ctx.fillRect(sx + size * .17, ground - size * .59, size * .55, size * .055); ctx.fillRect(sx + size * .32, ground - size * .57, size * .08, size * .13);
      if (e.fire > 0) { ctx.fillStyle = '#ffbd63'; ctx.beginPath(); ctx.moveTo(sx - size * .8, ground - size * .69); ctx.lineTo(sx - size * 1.2, ground - size * .83); ctx.lineTo(sx - size * 1.08, ground - size * .67); ctx.lineTo(sx - size * 1.27, ground - size * .56); ctx.lineTo(sx - size * .76, ground - size * .59); ctx.fill(); }
      // Tiny red health tick above the silhouette.
      ctx.fillStyle = 'rgba(5,8,7,.7)'; ctx.fillRect(sx - size * .27, ground - size * 1.16, size * .54, Math.max(2, 2 * dpr)); ctx.fillStyle = '#d9fb62'; ctx.fillRect(sx - size * .27, ground - size * 1.16, size * .54 * (e.hp / 100), Math.max(2, 2 * dpr)); ctx.restore();
    }
  }
  function drawWeapon() {
    const moving = moveBlend; const sway = Math.sin(bob * 8) * moving * 8 * dpr; const x = viewW * .67 + sway, y = viewH * .93 + Math.abs(Math.cos(bob * 8)) * moving * 5 * dpr + (jump ? -jump * 22 * dpr : 0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.08 + Math.sin(bob * 4) * moving * .015);
    // forearm and glove
    ctx.fillStyle = '#343b35'; ctx.beginPath(); ctx.moveTo(-30 * dpr, 16 * dpr); ctx.lineTo(80 * dpr, -58 * dpr); ctx.lineTo(118 * dpr, -18 * dpr); ctx.lineTo(35 * dpr, 38 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#565447'; ctx.beginPath(); ctx.moveTo(10 * dpr, 20 * dpr); ctx.lineTo(132 * dpr, -93 * dpr); ctx.lineTo(223 * dpr, -70 * dpr); ctx.lineTo(246 * dpr, -39 * dpr); ctx.lineTo(91 * dpr, 44 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#252b26'; ctx.beginPath(); ctx.moveTo(92 * dpr, 7 * dpr); ctx.lineTo(184 * dpr, -71 * dpr); ctx.lineTo(304 * dpr, -67 * dpr); ctx.lineTo(313 * dpr, -45 * dpr); ctx.lineTo(205 * dpr, -32 * dpr); ctx.lineTo(116 * dpr, 35 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#121714'; ctx.fillRect(265 * dpr, -68 * dpr, 166 * dpr, 13 * dpr); ctx.fillRect(397 * dpr, -73 * dpr, 38 * dpr, 4 * dpr);
    ctx.fillStyle = '#70735d'; ctx.fillRect(190 * dpr, -79 * dpr, 28 * dpr, 10 * dpr); ctx.fillStyle = '#151b16'; ctx.fillRect(197 * dpr, -82 * dpr, 14 * dpr, 7 * dpr);
    ctx.fillStyle = '#41483b'; ctx.beginPath(); ctx.moveTo(197 * dpr, -29 * dpr); ctx.lineTo(244 * dpr, -43 * dpr); ctx.lineTo(267 * dpr, 28 * dpr); ctx.lineTo(226 * dpr, 42 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#31352b'; ctx.fillRect(120 * dpr, 21 * dpr, 66 * dpr, 12 * dpr);
    if (performance.now() < muzzleUntil) { ctx.fillStyle = '#fff5c0'; ctx.beginPath(); ctx.moveTo(430 * dpr, -61 * dpr); ctx.lineTo(472 * dpr, -83 * dpr); ctx.lineTo(458 * dpr, -58 * dpr); ctx.lineTo(486 * dpr, -49 * dpr); ctx.lineTo(444 * dpr, -41 * dpr); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  function movePlayer(dt) {
    let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0); let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0); const len = Math.hypot(f, s) || 1; f /= len; s /= len;
    const sprint = keys.ShiftLeft || keys.ShiftRight; const speed = (sprint ? 4.25 : 2.8) * dt; const vx = (Math.cos(player.angle) * f - Math.sin(player.angle) * s) * speed; const vy = (Math.sin(player.angle) * f + Math.cos(player.angle) * s) * speed;
    const radius = .2; if (!solid(player.x + vx + Math.sign(vx) * radius, player.y)) player.x += vx; if (!solid(player.x, player.y + vy + Math.sign(vy) * radius)) player.y += vy;
    const moving = Math.hypot(vx, vy) > 0; moveBlend += ((moving ? 1 : 0) - moveBlend) * Math.min(1, dt * 8); if (moving) bob += dt * (sprint ? 12 : 8); jump = Math.max(0, jump - dt * 1.8);
  }
  function updateEnemies(dt) {
    for (const e of enemies) {
      if (!e.alive) continue; e.hurt = Math.max(0, e.hurt - dt); e.fire = Math.max(0, e.fire - dt);
      const dx = player.x - e.x, dy = player.y - e.y, dist = Math.hypot(dx, dy); e.angle = Math.atan2(dy, dx);
      if (dist > 3.8) { const step = Math.min(dt * (e.speed || 1.0), dist - 3.1); const nx = e.x + dx / dist * step, ny = e.y + dy / dist * step; if (!solid(nx + Math.sign(dx) * .22, e.y)) e.x = nx; if (!solid(e.x, ny + Math.sign(dy) * .22)) e.y = ny; }
      e.cooldown -= dt; if (dist < 10 && Math.abs(normalizeAngle(e.angle - player.angle)) < 1.55 && e.cooldown <= 0 && lineClear(e.x, e.y, player.x, player.y)) { e.cooldown = 1.3 + Math.random() * 1.6; e.fire = .13; const damage = Math.round(5 + Math.random() * 6); const absorbed = Math.min(player.armor, Math.ceil(damage * .6)); player.armor -= absorbed; player.health = Math.max(0, player.health - (damage - absorbed)); damageUntil = performance.now() + 180; updateVitals(); if (!player.health) finish(false); }
    }
  }
  function lineClear(x1, y1, x2, y2) { const d = Math.hypot(x2 - x1, y2 - y1); const n = Math.ceil(d * 8); for (let i = 1; i < n; i++) { const t = i / n; if (solid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false; } return true; }
  function fire() {
    if (!playing || paused || reloading || !player.ammo) { if (playing && !player.ammo) reload(); return; }
    const now = performance.now(); if (now - lastShot < 105) return; lastShot = now; player.ammo--; shots++; muzzleUntil = now + 75; $('ammoValue').textContent = player.ammo;
    let target = null, best = .075;
    for (const e of enemies) { if (!e.alive) continue; const a = Math.atan2(e.y - player.y, e.x - player.x), delta = Math.abs(normalizeAngle(a - player.angle)); const dist = Math.hypot(e.x - player.x, e.y - player.y); const tolerance = Math.min(.12, .045 + .15 / dist); if (delta < tolerance && lineClear(player.x, player.y, e.x, e.y) && delta < best) { best = delta; target = e; } }
    if (target) { hits++; target.hp -= 34; target.hurt = .15; hitUntil = now + 115; if (target.hp <= 0) { target.alive = false; killed++; addKill(); if (killed === enemies.length) { setToast('SITE CLEAR — ALL HOSTILES ELIMINATED'); setTimeout(() => { if (playing) finish(true); }, 1200); } else setToast(`${enemies.length - killed} HOSTILES REMAINING`); updateObjective(); } }
    if (!player.ammo) setTimeout(() => { if (playing && !paused) reload(); }, 260);
  }
  function addKill() { const row = document.createElement('div'); row.className = 'kill-entry'; row.innerHTML = `OPERATOR <span>✕</span> HOSTILE <span>VANDAL</span>`; $('killFeed').prepend(row); while ($('killFeed').children.length > 3) $('killFeed').lastChild.remove(); }
  function reload() { if (reloading || player.ammo >= 30 || player.reserve <= 0 || !playing) return; reloading = true; reloadTimer = 1.55; $('reloadIndicator').classList.add('active'); }
  function updateVitals() { $('healthValue').textContent = player.health; $('armorValue').textContent = player.armor; $('healthBar').style.width = player.health + '%'; document.querySelector('.armor-bar i').style.width = (player.armor / 75 * 100) + '%'; }
  function updateObjective() { $('objectiveSub').textContent = `SITE A · ${enemies.length - killed} ENEM${enemies.length - killed === 1 ? 'Y' : 'IES'} REMAINING`; const bars = document.querySelectorAll('.round-progress i'); bars.forEach((b, i) => b.style.background = i < killed ? 'var(--lime)' : 'rgba(225,235,213,.18)'); }
  function setToast(text) { toastText = text; toastUntil = performance.now() + 1700; }
  function setupMatch() { player.x = 3.3; player.y = 2.5; player.angle = .02; player.health = 100; player.armor = 75; player.ammo = 30; player.reserve = 90; enemies = spawns.map((p, i) => ({ x: p[0], y: p[1], hp: 100, alive: true, cooldown: 1.1 + Math.random() * 1.7, hurt: 0, fire: 0, speed: .52 + Math.random() * .17, angle: 0, id: i })); killed = shots = hits = elapsed = 0; reloading = false; $('ammoValue').textContent = '30'; $('reserveValue').textContent = '90'; $('killFeed').innerHTML = ''; $('roundNum').textContent = '01'; updateVitals(); updateObjective(); }
  function startMatch() { setupMatch(); playing = true; paused = false; menu.classList.add('hidden'); result.classList.add('hidden'); pause.classList.add('hidden'); hud.classList.remove('hidden'); requestPointer(); setToast('ELIMINATE ALL HOSTILES'); lastTime = performance.now(); }
  function requestPointer() { if (canvas.requestPointerLock && innerWidth > 720) { try { const lock = canvas.requestPointerLock(); if (lock && lock.catch) lock.catch(() => {}); } catch (_) {} } }
  function finish(won) { if (!playing) return; playing = false; paused = false; document.exitPointerLock?.(); hud.classList.add('hidden'); pause.classList.add('hidden'); result.classList.remove('hidden'); $('resultTag').textContent = won ? 'MISSION COMPLETE' : 'OPERATOR DOWN'; $('resultTitle').innerHTML = won ? 'SITE<br>SECURED.' : 'MISSION<br>FAILED.'; $('resultText').textContent = won ? 'All hostiles neutralized. Clean work, operator.' : 'You were outnumbered. Regroup and run it back.'; $('accuracyResult').textContent = (shots ? Math.round(hits / shots * 100) : 0) + '%'; $('killsResult').textContent = String(killed).padStart(2, '0') + ' / 05'; $('timeResult').textContent = formatTime(elapsed); }
  function formatTime(n) { const m = Math.floor(n / 60), s = Math.floor(n % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
  $('playButton').addEventListener('click', startMatch); $('againButton').addEventListener('click', startMatch); $('resumeButton').addEventListener('click', () => { paused = false; pause.classList.add('hidden'); hud.classList.remove('hidden'); requestPointer(); lastTime = performance.now(); });
  document.addEventListener('pointerlockchange', () => { if (playing && !document.pointerLockElement && innerWidth > 720 && !paused) togglePause(); });
  document.addEventListener('mousemove', e => { if (playing && !paused) { if (document.pointerLockElement === canvas) player.angle += e.movementX * .0025; else player.angle += e.movementX * .004; } });
  canvas.addEventListener('mousedown', e => { if (!playing || paused) return; if (e.button === 0) { mouseHeld = true; fire(); } }); window.addEventListener('mouseup', () => mouseHeld = false); canvas.addEventListener('contextmenu', e => e.preventDefault());
  function togglePause() { paused = !paused; pause.classList.toggle('hidden', !paused); hud.classList.toggle('hidden', paused); if (paused) document.exitPointerLock?.(); else { requestPointer(); lastTime = performance.now(); } }
  document.addEventListener('keydown', e => { keys[e.code] = true; if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault(); if (e.code === 'Escape' && playing) { if (document.pointerLockElement) document.exitPointerLock(); else togglePause(); } if (e.code === 'KeyR') reload(); if (e.code === 'Space' && playing && !paused && jump === 0) jump = 1; }); document.addEventListener('keyup', e => keys[e.code] = false); window.addEventListener('blur', () => { keys = {}; if (playing && !paused) togglePause(); });
  function frame(now) { const dt = Math.min(.04, (now - (lastTime || now)) / 1000); lastTime = now;
    if (playing && !paused) { elapsed += dt; movePlayer(dt); if (mouseHeld) fire(); updateEnemies(dt); if (reloading) { reloadTimer -= dt; if (reloadTimer <= 0) { const amount = Math.min(30 - player.ammo, player.reserve); player.ammo += amount; player.reserve -= amount; reloading = false; $('reloadIndicator').classList.remove('active'); $('ammoValue').textContent = player.ammo; $('reserveValue').textContent = player.reserve; } } $('clock').textContent = formatTime(elapsed); if (performance.now() < damageUntil) $('damageFlash').style.opacity = '.8'; else $('damageFlash').style.opacity = '0'; if (performance.now() < hitUntil) $('hitMarker').classList.add('active'); else $('hitMarker').classList.remove('active'); $('toast').textContent = performance.now() < toastUntil ? toastText : ''; }
    drawWorld(dt); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();