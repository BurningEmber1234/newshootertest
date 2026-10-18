#!/usr/bin/env node
/**
 * Zero-dependency static server and lightweight authoritative room server for
 * RIFT//STRIKE. Online rooms use same-origin JSON polling, so no WebSocket
 * package or third-party runtime is needed.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const level = require('./map-data.js');
const weapons = require('./weapon-data.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const SCORE_LIMIT = 15;
const STARTING_CASH = 2000;
const KILL_REWARD = 300;
const ARMOR_PRICE = 650;
const ARMOR_CAP = 50;
const ROOM_TTL = 30 * 60 * 1000;
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, data) {
  const payload = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendError(res, status, message) { sendJson(res, status, { error: message }); }

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function normalizeTeam(team) { return String(team || '').toUpperCase() === 'T' ? 'T' : 'CT'; }

function sanitizeName(value) {
  const cleaned = String(value || 'OPERATOR').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 16);
  return cleaned || 'OPERATOR';
}

function nextRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function spawnAt(team, slot) {
  const spawns = level.spawns[team];
  const point = spawns[Math.max(0, Math.min(spawns.length - 1, slot))];
  return { x: point[0], y: point[1], angle: level.spawnFacing[team] ?? 0 };
}

function createWeaponStock(isHuman) {
  return weapons.map((weapon, index) => ({
    owned: isHuman ? index < 2 : index === 1,
    ammo: weapon.mag,
    reserve: weapon.reserve,
  }));
}

function actorBase(id, name, team, spawn, isHuman) {
  const weaponStock = createWeaponStock(isHuman);
  const weaponIndex = 1;
  return {
    id, name, team, x: spawn.x, y: spawn.y, angle: spawn.angle,
    hp: 100, armor: isHuman ? 25 : 50, ammo: weaponStock[weaponIndex].ammo,
    reserve: weaponStock[weaponIndex].reserve, money: isHuman ? STARTING_CASH : 0,
    weaponIndex, weaponStock, alive: true,
    kills: 0, deaths: 0, isHuman, hurt: 0, fire: 0,
    respawnAt: 0, cooldown: 1 + Math.random() * 1.2,
    orbitSign: Math.random() < 0.5 ? -1 : 1,
    lastShotAt: 0, shots: 0, hits: 0,
    lastSeen: Date.now(), reloadingUntil: 0,
  };
}

function roomActors(room) { return [...room.players.values(), ...room.bots]; }

function humanCount(room, team) {
  let count = 0;
  for (const player of room.players.values()) if (player.team === team) count++;
  return count;
}

function saveActiveWeapon(actor) {
  const stock = actor.weaponStock && actor.weaponStock[actor.weaponIndex];
  if (stock) { stock.ammo = actor.ammo; stock.reserve = actor.reserve; }
}

function selectActorWeapon(actor, rawIndex) {
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index >= weapons.length) return false;
  const stock = actor.weaponStock && actor.weaponStock[index];
  if (!stock || !stock.owned) return false;
  if (index !== actor.weaponIndex) {
    saveActiveWeapon(actor);
    actor.weaponIndex = index;
    actor.ammo = stock.ammo;
    actor.reserve = stock.reserve;
    actor.reloadingUntil = 0;
  }
  return true;
}

function createHuman(room, name, team) {
  const humanSlots = new Set([...room.players.values()].filter((player) => player.team === team).map((player) => player.spawnSlot));
  const replacementBot = room.bots.find((bot) => bot.team === team && !humanSlots.has(bot.spawnSlot));
  let slot = replacementBot ? replacementBot.spawnSlot : -1;
  if (slot < 0) {
    const used = new Set(roomActors(room).filter((actor) => actor.team === team).map((actor) => actor.spawnSlot));
    slot = Array.from({ length: 5 }, (_, index) => index).find((index) => !used.has(index)) ?? 0;
  }
  const player = actorBase(crypto.randomUUID(), sanitizeName(name), team, spawnAt(team, slot), true);
  player.spawnSlot = slot;
  room.players.set(player.id, player);
  return player;
}

function createBot(room, team, slot) {
  const spawn = spawnAt(team, slot);
  const squad = team === 'CT' ? 'SENTINEL' : 'RAIDER';
  const bot = actorBase(`bot-${crypto.randomUUID()}`, `${squad} ${String(slot + 1).padStart(2, '0')}`, team, spawn, false);
  bot.spawnSlot = slot;
  bot.objective = slot % 2 === 0 ? 'A' : 'B';
  bot.patrol = null;
  bot.patrolRound = 0;
  return bot;
}

function patrolPoint(bot) {
  // Split the squad across A and B instead of stacking on one lane.
  const site = level.sites[bot.objective] || level.sites.A;
  const slot = Number.isInteger(bot.spawnSlot) ? bot.spawnSlot : 0;
  const angle = (slot * 2.399 + (bot.patrolRound || 0) * 1.37) % (Math.PI * 2);
  const radius = 1.1 + ((slot + (bot.patrolRound || 0)) % 5) * 0.42;
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = angle + attempt * 1.05;
    const x = site.x + Math.cos(a) * radius;
    const y = site.y + Math.sin(a) * radius;
    if (!level.isSolid(x, y)) return [x, y];
  }
  return [site.x, site.y];
}

function reconcileBots(room) {
  for (const team of ['CT', 'T']) {
    const humans = [...room.players.values()].filter((player) => player.team === team);
    const humanSlots = new Set(humans.map((player) => player.spawnSlot));
    // A joining human takes the spawn slot of one of the bots they replace.
    room.bots = room.bots.filter((bot) => bot.team !== team || !humanSlots.has(bot.spawnSlot));
    let teamBots = room.bots.filter((bot) => bot.team === team);
    const required = Math.max(0, 5 - humans.length);
    if (teamBots.length > required) {
      const remove = new Set(teamBots.sort((a, b) => b.spawnSlot - a.spawnSlot).slice(0, teamBots.length - required));
      room.bots = room.bots.filter((bot) => !remove.has(bot));
      teamBots = room.bots.filter((bot) => bot.team === team);
    }
    const occupiedSlots = new Set([...humanSlots, ...teamBots.map((bot) => bot.spawnSlot)]);
    while (teamBots.length < required) {
      let slot = 0;
      while (occupiedSlots.has(slot) && slot < 5) slot++;
      const bot = createBot(room, team, Math.min(slot, 4));
      room.bots.push(bot);
      teamBots.push(bot);
      occupiedSlots.add(bot.spawnSlot);
    }
  }
}

function createRoom(owner) {
  const room = {
    code: nextRoomCode(), players: new Map(), bots: [],
    scores: { CT: 0, T: 0 }, winner: null,
    events: [], nextEventId: 1, createdAt: Date.now(), lastActivity: Date.now(), lastTick: Date.now(),
  };
  const player = createHuman(room, owner.name, normalizeTeam(owner.team));
  reconcileBots(room);
  rooms.set(room.code, room);
  return { room, player };
}

function addEvent(room, type, actor, target, extra = {}) {
  const event = {
    id: room.nextEventId++, type,
    actorId: actor ? actor.id : null, actorName: actor ? actor.name : 'SYSTEM',
    actorTeam: actor ? actor.team : null,
    targetId: target ? target.id : null, targetName: target ? target.name : null,
    targetTeam: target ? target.team : null,
    at: Date.now(), ...extra,
  };
  room.events.push(event);
  if (room.events.length > 100) room.events.splice(0, room.events.length - 100);
  return event;
}

function publicActor(actor) {
  return {
    id: actor.id, name: actor.name, team: actor.team,
    x: actor.x, y: actor.y, angle: actor.angle,
    hp: actor.hp, armor: actor.armor, ammo: actor.ammo, reserve: actor.reserve,
    money: actor.money || 0, weaponIndex: actor.weaponIndex,
    weaponName: weapons[actor.weaponIndex] ? weapons[actor.weaponIndex].name : 'VANDAL',
    weaponStock: actor.isHuman ? actor.weaponStock.map((item) => ({ ...item })) : undefined,
    alive: actor.alive, kills: actor.kills, deaths: actor.deaths,
    shots: actor.shots, hits: actor.hits,
    isHuman: actor.isHuman, hurt: actor.hurt > 0, fire: actor.fire > 0,
  };
}

function snapshot(room, playerId, lastEventId = 0) {
  const you = room.players.get(playerId);
  return {
    code: room.code, status: room.winner ? 'complete' : 'in-progress', map: 'ASCENT',
    scoreLimit: SCORE_LIMIT, scores: room.scores, winner: room.winner,
    actors: roomActors(room).map(publicActor), you: you ? publicActor(you) : null,
    events: room.events.filter((event) => event.id > Number(lastEventId || 0)).slice(-40),
    serverTime: Date.now(),
  };
}

function setPlayerPosition(player, state) {
  if (!state || !player.alive) return;
  const x = Number(state.x), y = Number(state.y), angle = Number(state.angle);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(angle)) return;
  if (x < 0.25 || y < 0.25 || x > level.width - 1.25 || y > level.height - 1.25 || level.isSolid(x, y)) return;
  if (Math.hypot(x - player.x, y - player.y) > 1.35) return;
  player.x = x; player.y = y;
  player.angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (state.weaponIndex !== undefined) selectActorWeapon(player, state.weaponIndex);
  player.lastSeen = Date.now();
}

function moveActor(actor, targetX, targetY, dt, speed) {
  const dx = targetX - actor.x, dy = targetY - actor.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.06) return;
  const step = Math.min(speed * dt, distance);
  const vx = dx / distance * step, vy = dy / distance * step;
  if (!level.isSolid(actor.x + vx + Math.sign(vx) * 0.18, actor.y)) actor.x += vx;
  if (!level.isSolid(actor.x, actor.y + vy + Math.sign(vy) * 0.18)) actor.y += vy;
}

function respawn(room, actor) {
  const sameTeam = roomActors(room).filter((candidate) => candidate.team === actor.team && candidate.id !== actor.id);
  const slot = Number.isInteger(actor.spawnSlot) ? actor.spawnSlot : sameTeam.length % 5;
  const spawn = spawnAt(actor.team, slot);
  actor.x = spawn.x; actor.y = spawn.y; actor.angle = spawn.angle;
  actor.hp = 100; actor.armor = actor.isHuman ? 25 : 50;
  const activeWeapon = weapons[actor.weaponIndex] || weapons[1];
  actor.ammo = activeWeapon.mag; actor.reserve = activeWeapon.reserve;
  if (actor.weaponStock && actor.weaponStock[actor.weaponIndex]) {
    actor.weaponStock[actor.weaponIndex].ammo = actor.ammo;
    actor.weaponStock[actor.weaponIndex].reserve = actor.reserve;
  }
  actor.alive = true; actor.respawnAt = 0; actor.reloadingUntil = 0;
  if (actor.isHuman) addEvent(room, 'respawn', actor, null);
}

function eliminate(room, attacker, target, weaponName = 'VANDAL') {
  if (!target.alive) return;
  target.alive = false; target.hp = 0; target.deaths++;
  target.respawnAt = Date.now() + 2400; target.reloadingUntil = 0;
  if (attacker) {
    attacker.kills++;
    if (attacker.isHuman) attacker.money = Math.min(16_000, attacker.money + KILL_REWARD);
    room.scores[attacker.team]++;
    addEvent(room, 'kill', attacker, target, { weapon: weaponName, score: { ...room.scores } });
    if (room.scores[attacker.team] >= SCORE_LIMIT && !room.winner) {
      room.winner = attacker.team;
      addEvent(room, 'match', attacker, null, { winner: room.winner, score: { ...room.scores } });
    }
  } else addEvent(room, 'elimination', null, target);
}

function damage(room, attacker, target, amount, weaponName = 'VANDAL') {
  const absorbed = Math.min(target.armor, Math.ceil(amount * 0.58));
  target.armor -= absorbed;
  target.hp = Math.max(0, target.hp - (amount - absorbed));
  target.hurt = 0.16;
  if (target.hp <= 0) eliminate(room, attacker, target, weaponName);
}

function chooseTarget(room, actor) {
  const candidates = roomActors(room).filter((other) => other.alive && other.team !== actor.team && other.id !== actor.id);
  let visible = null, visibleDistance = Infinity;
  let nearest = null, nearestDistance = Infinity;
  for (const other of candidates) {
    const distance = Math.hypot(other.x - actor.x, other.y - actor.y);
    if (distance < nearestDistance) { nearest = other; nearestDistance = distance; }
    if (distance < visibleDistance && level.lineClear(actor.x, actor.y, other.x, other.y)) {
      visible = other; visibleDistance = distance;
    }
  }
  return { target: visible || nearest, distance: visible ? visibleDistance : nearestDistance, visible: Boolean(visible) };
}

function tickRoom(room, now = Date.now()) {
  const dt = Math.max(0.025, Math.min(0.16, (now - room.lastTick) / 1000));
  room.lastTick = now;
  if (room.winner) return;
  for (const actor of roomActors(room)) {
    actor.hurt = Math.max(0, actor.hurt - dt);
    actor.fire = Math.max(0, actor.fire - dt);
    if (!actor.alive) {
      if (actor.respawnAt && actor.respawnAt <= now) respawn(room, actor);
      continue;
    }
    if (actor.reloadingUntil && actor.reloadingUntil <= now) {
      const magazine = (weapons[actor.weaponIndex] || weapons[1]).mag;
      const amount = Math.min(magazine - actor.ammo, actor.reserve);
      actor.ammo += amount; actor.reserve -= amount; actor.reloadingUntil = 0;
      saveActiveWeapon(actor);
    }
  }
  for (const bot of room.bots) {
    if (!bot.alive || room.winner) continue;
    const { target, distance, visible } = chooseTarget(room, bot);
    if (!target) continue;
    const dx = target.x - bot.x, dy = target.y - bot.y;
    let goalX = target.x, goalY = target.y;
    if (!visible || distance > 9) {
      if (!bot.patrol || Math.hypot(bot.patrol[0] - bot.x, bot.patrol[1] - bot.y) < 1.1) {
        bot.patrolRound = (bot.patrolRound || 0) + 1;
        bot.patrol = patrolPoint(bot);
        if (Math.random() < 0.12) bot.objective = bot.objective === 'A' ? 'B' : 'A';
      }
      if (!visible) { goalX = bot.patrol[0]; goalY = bot.patrol[1]; }
    }
    bot.angle = Math.atan2(visible ? dy : goalY - bot.y, visible ? dx : goalX - bot.x);
    if (distance > 4.1 || !visible) {
      const waypoint = level.nextWaypoint(bot.x, bot.y, goalX, goalY);
      moveActor(bot, waypoint[0], waypoint[1], dt, 1.45);
    } else {
      const side = bot.orbitSign || 1;
      const lateralX = -Math.sin(bot.angle) * side * 0.46;
      const lateralY = Math.cos(bot.angle) * side * 0.46;
      const beforeX = bot.x, beforeY = bot.y;
      moveActor(bot, bot.x + lateralX * dt, bot.y + lateralY * dt, dt, 1);
      if (Math.hypot(bot.x - beforeX, bot.y - beforeY) < 0.001) bot.orbitSign = -side;
    }
    bot.cooldown -= dt;
    if (visible && distance < 14 && bot.cooldown <= 0) {
      bot.cooldown = 1.45 + Math.random() * 1.05;
      bot.fire = 0.18;
      damage(room, bot, target, 7 + Math.floor(Math.random() * 5));
    }
  }
}

function handleCreate(body) {
  const { room, player } = createRoom({ name: body.name, team: body.team });
  return { status: 201, data: { session: { code: room.code, playerId: player.id }, snapshot: snapshot(room, player.id) } };
}

function handleJoin(code, body) {
  const room = rooms.get(code);
  if (!room) return { status: 404, error: 'Room not found. Check the code and try again.' };
  if (room.winner) return { status: 409, error: 'That match is already complete. Create a new room.' };
  const ctCount = humanCount(room, 'CT'), tCount = humanCount(room, 'T');
  let team = normalizeTeam(body.team);
  if ((team === 'CT' ? ctCount : tCount) >= 5) team = team === 'CT' ? 'T' : 'CT';
  if (ctCount >= 5 && tCount >= 5) return { status: 409, error: 'Both teams are full.' };
  if ((team === 'CT' ? ctCount : tCount) >= 5) team = ctCount < tCount ? 'CT' : 'T';
  const player = createHuman(room, body.name, team);
  reconcileBots(room);
  room.lastActivity = Date.now();
  addEvent(room, 'join', player, null);
  return { status: 201, data: { session: { code: room.code, playerId: player.id }, snapshot: snapshot(room, player.id) } };
}

function getSession(room, playerId) {
  if (!room) return { error: 'Room not found. It may have expired.' };
  const player = room.players.get(String(playerId || ''));
  if (!player) return { error: 'Player session not found. Rejoin the room.' };
  return { room, player };
}

function handleUpdate(code, body) {
  const found = getSession(rooms.get(code), body.playerId);
  if (found.error) return { status: 404, error: found.error };
  const { room, player } = found;
  room.lastActivity = Date.now();
  setPlayerPosition(player, body.state);
  tickRoom(room);
  return { status: 200, data: { snapshot: snapshot(room, player.id, body.lastEventId) } };
}

function handleFire(code, body) {
  const found = getSession(rooms.get(code), body.playerId);
  if (found.error) return { status: 404, error: found.error };
  const { room, player } = found;
  room.lastActivity = Date.now();
  setPlayerPosition(player, body.state);
  const now = Date.now();
  const weapon = weapons[player.weaponIndex] || weapons[1];
  if (room.winner || !player.alive || player.reloadingUntil > now || now - player.lastShotAt < weapon.interval || player.ammo <= 0) {
    return { status: 200, data: { snapshot: snapshot(room, player.id, body.lastEventId) } };
  }
  player.lastShotAt = now; player.ammo--; player.shots++; saveActiveWeapon(player);
  let target = null, closestAim = Infinity;
  for (const candidate of roomActors(room)) {
    if (!candidate.alive || candidate.team === player.team || candidate.id === player.id) continue;
    const dx = candidate.x - player.x, dy = candidate.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 22 || !level.lineClear(player.x, player.y, candidate.x, candidate.y)) continue;
    const angle = Math.atan2(dy, dx);
    const delta = Math.abs(Math.atan2(Math.sin(angle - player.angle), Math.cos(angle - player.angle)));
    const tolerance = Math.min(0.115, 0.045 + 0.15 / Math.max(1, distance));
    if (delta < tolerance && delta < closestAim) { closestAim = delta; target = candidate; }
  }
  if (target) {
    player.hits++;
    damage(room, player, target, weapon.damage, weapon.name);
    if (target.alive) addEvent(room, 'hit', player, target, { weapon: weapon.name });
  }
  tickRoom(room, now);
  return { status: 200, data: { snapshot: snapshot(room, player.id, body.lastEventId) } };
}

function handleWeapon(code, body) {
  const found = getSession(rooms.get(code), body.playerId);
  if (found.error) return { status: 404, error: found.error };
  const { room, player } = found;
  room.lastActivity = Date.now();
  if (!player.alive) return { status: 409, error: 'You can switch weapons after respawning.' };
  if (!selectActorWeapon(player, body.weaponIndex)) return { status: 403, error: 'That weapon is not in your loadout. Buy it first.' };
  player.reloadingUntil = 0;
  addEvent(room, 'equip', player, null, { weapon: weapons[player.weaponIndex].name });
  return { status: 200, data: { snapshot: snapshot(room, player.id, body.lastEventId) } };
}

function handleBuy(code, body) {
  const found = getSession(rooms.get(code), body.playerId);
  if (found.error) return { status: 404, error: found.error };
  const { room, player } = found;
  room.lastActivity = Date.now();
  if (!player.alive) return { status: 409, error: 'You can buy gear after respawning.' };
  const purchase = body.purchase || {};
  if (purchase.kind === 'armor') {
    if (player.armor >= ARMOR_CAP) return { status: 409, error: 'Armor is already at maximum.' };
    if (player.money < ARMOR_PRICE) return { status: 409, error: `Not enough credits. Armor costs $${ARMOR_PRICE}.` };
    player.money -= ARMOR_PRICE;
    player.armor = Math.min(ARMOR_CAP, player.armor + (ARMOR_CAP - player.armor));
    addEvent(room, 'buy', player, null, { item: 'ARMOR', money: player.money });
  } else if (purchase.kind === 'weapon') {
    const index = Number(purchase.weaponIndex);
    const weapon = weapons[index];
    if (!weapon || !player.weaponStock[index]) return { status: 400, error: 'Unknown weapon.' };
    const stock = player.weaponStock[index];
    if (!stock.owned) {
      if (player.money < weapon.price) return { status: 409, error: `Not enough credits. ${weapon.name} costs $${weapon.price}.` };
      player.money -= weapon.price;
      stock.owned = true;
      stock.ammo = weapon.mag;
      stock.reserve = weapon.reserve;
    }
    selectActorWeapon(player, index);
    addEvent(room, 'buy', player, null, { item: weapon.name, money: player.money });
  } else return { status: 400, error: 'Unknown purchase.' };
  return { status: 200, data: { snapshot: snapshot(room, player.id, body.lastEventId) } };
}

function handleReload(code, body) {
  const found = getSession(rooms.get(code), body.playerId);
  if (found.error) return { status: 404, error: found.error };
  const { room, player } = found;
  room.lastActivity = Date.now();
  const weapon = weapons[player.weaponIndex] || weapons[1];
  if (player.alive && !player.reloadingUntil && player.ammo < weapon.mag && player.reserve > 0) player.reloadingUntil = Date.now() + weapon.reloadMs;
  return { status: 200, data: { snapshot: snapshot(room, player.id, body.lastEventId) } };
}

function handleLeave(code, body) {
  const room = rooms.get(code);
  if (!room) return { status: 200, data: { left: true } };
  const player = room.players.get(String(body.playerId || ''));
  if (player) {
    room.players.delete(player.id);
    addEvent(room, 'leave', player, null);
    reconcileBots(room);
  }
  if (room.players.size === 0) rooms.delete(code);
  return { status: 200, data: { left: true } };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, rooms: rooms.size, multiplayer: 'http-polling' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'Method not allowed.');
  }
  let body;
  try { body = await readJson(req); }
  catch (error) { return sendError(res, error.status || 400, error.message || 'Invalid request.'); }
  let result;
  if (url.pathname === '/api/rooms') result = handleCreate(body);
  else {
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/(join|update|fire|weapon|buy|reload|leave)$/i);
    if (!match) return sendError(res, 404, 'API route not found.');
    const code = match[1].toUpperCase(), action = match[2].toLowerCase();
    if (action === 'join') result = handleJoin(code, body);
    else if (action === 'update') result = handleUpdate(code, body);
    else if (action === 'fire') result = handleFire(code, body);
    else if (action === 'weapon') result = handleWeapon(code, body);
    else if (action === 'buy') result = handleBuy(code, body);
    else if (action === 'reload') result = handleReload(code, body);
    else result = handleLeave(code, body);
  }
  if (result.error) return sendError(res, result.status || 400, result.error);
  return sendJson(res, result.status || 200, result.data);
}

function resolvePath(requestUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname); }
  catch { return null; }
  const segments = pathname.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.') || segment === 'node_modules')) return null;
  const resolved = path.resolve(ROOT, '.' + path.posix.normalize(pathname));
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return { filePath: resolved, pathname: path.posix.normalize(pathname) };
}

async function sendFile(res, filePath, urlPath) {
  let stat;
  try { stat = await fsp.stat(filePath); }
  catch { return sendNotFound(res); }
  if (stat.isDirectory()) {
    if (!urlPath.endsWith('/')) {
      res.writeHead(301, { Location: urlPath + '/' });
      return res.end();
    }
    return sendFile(res, path.join(filePath, 'index.html'), urlPath + 'index.html');
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': stat.size,
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  });
  if (res.req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — Not found');
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); }
  catch { return sendError(res, 400, 'Invalid URL.'); }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  const target = resolvePath(req.url || '/');
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 — Forbidden');
  }
  if (target.filePath === ROOT) return sendFile(res, path.join(ROOT, 'index.html'), '/index.html');
  return sendFile(res, target.filePath, target.pathname);
});

const gameTicker = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL) { rooms.delete(code); continue; }
    tickRoom(room, now);
  }
}, 100);
gameTicker.unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} npm run dev`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`RIFT//STRIKE running at http://${shown}:${PORT}`);
  console.log('Online rooms use same-origin HTTP polling. Press Ctrl+C to stop.');
});
