import { botInput, BotBrain, createBrain } from './bot';
import { CUNADO_PHRASES, rollItem } from './items';
import { createKart, PHYS, progressOf, stepKart } from './kart';
import { makeRng, randInt } from './math';
import { pointAt, projectOnTrack } from './track';
import { getTrack } from './tracks';
import type { GameEvent, Input, ItemKind, Kart, RaceConfig, World } from './types';
import { NO_INPUT } from './types';

export const COUNTDOWN = 3;
export const END_GRACE = 20;
export const MAX_HAZARDS = 12;
export const SPIN_TIME = 1.1;
export const ITEM_ROLL_TIME = 1.0;
export const BOX_RESPAWN = 2.5;

export interface WorldExt extends World {
  brains: Record<number, BotBrain>;
}

export function createWorld(config: RaceConfig): WorldExt {
  const track = getTrack(config.trackId);
  const rng = makeRng(config.seed);
  // Parrilla aleatoria pero determinista
  const order = config.players.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const karts: Kart[] = order.map((p, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const g = pointAt(track, track.length - 70 - row * 70 - col * 20);
    const lat = (col === 0 ? 0.42 : -0.42) * track.halfWidth;
    const x = g.x + g.nx * lat;
    const y = g.y + g.ny * lat;
    const proj = projectOnTrack(track, x, y, g.index);
    return createKart(p.id, p.name, p.char, p.bot, x, y, Math.atan2(g.ty, g.tx), proj.s, proj.index);
  });
  return {
    config,
    track,
    tick: 0,
    time: 0,
    phase: 'countdown',
    countdown: COUNTDOWN,
    endTimer: -1,
    karts,
    projectiles: [],
    hazards: [],
    boxes: track.boxes.map((b) => ({ x: b.x, y: b.y, respawn: 0 })),
    events: [],
    rng,
    nextId: 1,
    finishOrder: [],
    brains: {},
  };
}

/** Clasificación actual: ids ordenados del primero al último. */
export function ranking(w: World): number[] {
  const finishedRank = new Map(w.finishOrder.map((id, i) => [id, i]));
  return w.karts
    .slice()
    .sort((a, b) => {
      const fa = finishedRank.get(a.id);
      const fb = finishedRank.get(b.id);
      if (fa !== undefined && fb !== undefined) return fa - fb;
      if (fa !== undefined) return -1;
      if (fb !== undefined) return 1;
      return progressOf(b, w.track) - progressOf(a, w.track) || a.id - b.id;
    })
    .map((k) => k.id);
}

export function findKart(w: World, id: number): Kart | undefined {
  return w.karts.find((k) => k.id === id);
}

function brainFor(w: WorldExt, k: Kart): BotBrain {
  let b = w.brains[k.id];
  if (!b) {
    b = createBrain(w.config.seed, k.id);
    w.brains[k.id] = b;
  }
  return b;
}

function emit(w: World, e: GameEvent) {
  w.events.push(e);
  // Evita que crezca sin límite si nadie consume los eventos.
  if (w.events.length > 200) w.events.splice(0, w.events.length - 200);
}

export function hitKart(w: World, victim: Kart, byId: number, item: ItemKind): boolean {
  if (victim.spin > 0 || victim.finishTime !== null) return false;
  victim.spin = SPIN_TIME;
  victim.boost = 0;
  victim.driftDir = 0;
  victim.driftCharge = 0;
  victim.stats.hitsTaken++;
  const by = findKart(w, byId);
  if (by && by.id !== victim.id) by.stats.hitsGiven++;
  emit(w, { type: 'hit', victim: victim.id, by: byId, item });
  return true;
}

export function useItem(w: World, k: Kart): void {
  const item = k.item;
  if (!item || k.itemRoll > 0) return;
  k.item = null;
  const fx = Math.cos(k.angle);
  const fy = Math.sin(k.angle);
  const rank = ranking(w);
  const myRank = rank.indexOf(k.id);
  let target: number | undefined;
  switch (item) {
    case 'chancla': {
      const fwd = k.vx * fx + k.vy * fy;
      const sp = Math.max(720, fwd + 420);
      w.projectiles.push({
        id: w.nextId++,
        kind: 'chancla',
        x: k.x + fx * 26,
        y: k.y + fy * 26,
        vx: fx * sp,
        vy: fy * sp,
        owner: k.id,
        target: -1,
        age: 0,
        bounces: 0,
        trackIdx: k.trackIdx,
      });
      break;
    }
    case 'platano': {
      w.hazards.push({ id: w.nextId++, kind: 'platano', x: k.x - fx * 32, y: k.y - fy * 32, owner: k.id, age: 0 });
      if (w.hazards.length > MAX_HAZARDS) w.hazards.splice(0, w.hazards.length - MAX_HAZARDS);
      break;
    }
    case 'croqueta':
      k.boost = Math.max(k.boost, 1.6);
      break;
    case 'cunado': {
      const candidates = rank.filter((id) => id !== k.id && findKart(w, id)?.finishTime === null);
      if (candidates.length > 0) {
        const t = findKart(w, candidates[0])!;
        t.slow = 3.5;
        t.slowPhrase = randInt(w.rng, CUNADO_PHRASES.length);
        target = t.id;
        k.stats.hitsGiven++;
        t.stats.hitsTaken++;
      }
      break;
    }
    case 'pato': {
      const ahead = myRank > 0 ? rank[myRank - 1] : rank[myRank + 1];
      target = ahead ?? -1;
      w.projectiles.push({
        id: w.nextId++,
        kind: 'pato',
        x: k.x + fx * 26,
        y: k.y + fy * 26,
        vx: fx * 500,
        vy: fy * 500,
        owner: k.id,
        target,
        age: 0,
        bounces: 0,
        trackIdx: k.trackIdx,
      });
      break;
    }
    case 'resaca':
      for (const o of w.karts) {
        if (o.id !== k.id && o.finishTime === null) o.invert = 3;
      }
      break;
  }
  emit(w, target === undefined ? { type: 'use', kart: k.id, item } : { type: 'use', kart: k.id, item, target });
}

function collideKarts(w: World) {
  const r2 = PHYS.radius * 2;
  for (let i = 0; i < w.karts.length; i++) {
    for (let j = i + 1; j < w.karts.length; j++) {
      const a = w.karts[i];
      const b = w.karts[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= r2) continue;
      if (d < 0.001) {
        dx = 1;
        dy = 0;
        d = 0.001;
      }
      const nx = dx / d;
      const ny = dy / d;
      const overlap = (r2 - d) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const j2 = (1.3 * rv) / 2;
        a.vx += nx * j2;
        a.vy += ny * j2;
        b.vx -= nx * j2;
        b.vy -= ny * j2;
        if (rv < -160) emit(w, { type: 'bump', a: a.id, b: b.id });
      }
    }
  }
}

function stepProjectiles(w: World, dt: number) {
  const track = w.track;
  const limit = track.halfWidth + track.wallMargin;
  const keep: typeof w.projectiles = [];
  for (const p of w.projectiles) {
    p.age += dt;
    if (p.kind === 'pato') {
      const t = findKart(w, p.target);
      if (t) {
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 600;
        const k = Math.min(1, 3.5 * dt);
        p.vx += ((dx / d) * sp - p.vx) * k;
        p.vy += ((dy / d) * sp - p.vy) * k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.trackIdx = projectOnTrack(track, p.x, p.y, p.trackIdx).index;
      if (p.age > 7) continue;
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const proj = projectOnTrack(track, p.x, p.y, p.trackIdx);
      p.trackIdx = proj.index;
      if (Math.abs(proj.lateral) > limit) {
        const side = Math.sign(proj.lateral);
        const over = Math.abs(proj.lateral) - limit;
        p.x -= proj.nx * side * over;
        p.y -= proj.ny * side * over;
        const vn = p.vx * proj.nx + p.vy * proj.ny;
        if (vn * side > 0) {
          p.vx -= 2 * vn * proj.nx;
          p.vy -= 2 * vn * proj.ny;
          p.bounces++;
        }
      }
      if (p.age > 5 || p.bounces > 6) continue;
    }

    let consumed = false;
    for (const k of w.karts) {
      if (k.finishTime !== null) continue;
      if (k.id === p.owner && p.age < 0.6) continue;
      if (p.kind === 'pato' && p.target >= 0 && k.id !== p.target && k.id === p.owner) continue;
      if ((k.x - p.x) ** 2 + (k.y - p.y) ** 2 < (PHYS.radius + 12) ** 2) {
        hitKart(w, k, p.owner, p.kind);
        consumed = true;
        break;
      }
    }
    if (!consumed) {
      // La chancla se carga los plátanos
      const hi = w.hazards.findIndex((h) => (h.x - p.x) ** 2 + (h.y - p.y) ** 2 < 22 * 22);
      if (hi >= 0) {
        w.hazards.splice(hi, 1);
        consumed = true;
      }
    }
    if (!consumed) keep.push(p);
  }
  w.projectiles = keep;
}

function stepHazards(w: World, dt: number) {
  const keep: typeof w.hazards = [];
  for (const h of w.hazards) {
    h.age += dt;
    let hit = false;
    for (const k of w.karts) {
      if (k.finishTime !== null) continue;
      if (k.id === h.owner && h.age < 1) continue;
      if ((k.x - h.x) ** 2 + (k.y - h.y) ** 2 < (PHYS.radius + 10) ** 2) {
        hitKart(w, k, h.owner, h.kind);
        hit = true;
        break;
      }
    }
    if (!hit) keep.push(h);
  }
  w.hazards = keep;
}

function stepBoxes(w: World, dt: number) {
  const rank = ranking(w);
  for (const b of w.boxes) {
    if (b.respawn > 0) {
      b.respawn = Math.max(0, b.respawn - dt);
      continue;
    }
    for (const k of w.karts) {
      if (k.finishTime !== null) continue;
      if ((k.x - b.x) ** 2 + (k.y - b.y) ** 2 < (PHYS.radius + 18) ** 2) {
        b.respawn = BOX_RESPAWN;
        if (k.item === null) {
          k.item = rollItem(w.rng, rank.indexOf(k.id), w.karts.length);
          k.itemRoll = ITEM_ROLL_TIME;
          emit(w, { type: 'pickup', kart: k.id });
        }
        break;
      }
    }
  }
}

/**
 * Avanza el mundo un paso fijo. `inputs` sólo hace falta para los humanos;
 * los bots (y los que ya han terminado) conducen solos.
 */
export function stepWorld(w: WorldExt, inputs: ReadonlyMap<number, Input>, dt: number): void {
  if (w.phase === 'finished') {
    // Seguimos moviendo los karts para que la pantalla de resultados esté viva.
    for (const k of w.karts) stepKart(k, botInput(w, k, brainFor(w, k), dt), dt, w.track);
    collideKarts(w);
    w.tick++;
    return;
  }
  w.tick++;

  if (w.phase === 'countdown') {
    w.countdown -= dt;
    for (const k of w.karts) {
      const input = k.bot ? botInput(w, k, brainFor(w, k), dt) : (inputs.get(k.id) ?? NO_INPUT);
      if (input.throttle) k.startHold += dt;
      else k.startHold = 0;
      stepKart(k, input, dt, w.track, true);
    }
    if (w.countdown <= 0) {
      w.countdown = 0;
      w.phase = 'racing';
      emit(w, { type: 'go' });
      for (const k of w.karts) {
        if (k.startHold > 2.5) {
          k.spin = 1.0;
          emit(w, { type: 'stall', kart: k.id });
        } else if (k.startHold > 0 && k.startHold <= 1.0) {
          k.boost = 1.0;
          emit(w, { type: 'startboost', kart: k.id });
        }
        k.startHold = 0;
      }
    }
    return;
  }

  w.time += dt;
  for (const k of w.karts) {
    const auto = k.bot || k.finishTime !== null;
    const input = auto ? botInput(w, k, brainFor(w, k), dt) : (inputs.get(k.id) ?? NO_INPUT);
    for (const e of stepKart(k, input, dt, w.track)) emit(w, e);
    if (input.honk && k.honkCd <= 0) {
      k.honkCd = 0.4;
      k.stats.honks++;
      emit(w, { type: 'honk', kart: k.id });
    }
    if (input.item && k.spin <= 0 && k.finishTime === null) useItem(w, k);
  }
  collideKarts(w);
  stepBoxes(w, dt);
  stepProjectiles(w, dt);
  stepHazards(w, dt);

  for (const k of w.karts) {
    if (k.finishTime === null && k.lap >= w.config.laps) {
      k.finishTime = w.time;
      k.item = null;
      k.spin = 0;
      k.slow = 0;
      k.invert = 0;
      w.finishOrder.push(k.id);
      emit(w, { type: 'finish', kart: k.id, place: w.finishOrder.length });
      if (w.endTimer < 0) w.endTimer = END_GRACE;
    }
  }

  if (w.endTimer >= 0) w.endTimer = Math.max(0, w.endTimer - dt);
  const humans = w.karts.filter((k) => !k.bot);
  const pending = (humans.length > 0 ? humans : w.karts).filter((k) => k.finishTime === null);
  if (pending.length === 0 || w.endTimer === 0) {
    w.phase = 'finished';
  }
}

/** Saca y vacía los eventos acumulados. */
export function drainEvents(w: World): GameEvent[] {
  const ev = w.events;
  w.events = [];
  return ev;
}

/** Semilla aleatoria para una carrera nueva. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0 || 1;
}
