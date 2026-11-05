import { clamp } from './math';
import { deltaS, projectOnTrack, Track } from './track';
import type { GameEvent, Input, Kart } from './types';

export const PHYS = {
  maxSpeed: 430,
  reverseMax: 150,
  accel: 520,
  brake: 900,
  coastDrag: 180,
  offroadFactor: 0.5,
  boostFactor: 1.45,
  slowFactor: 0.55,
  turnRate: 2.7,
  grip: 10,
  offroadGrip: 6,
  driftGrip: 2.6,
  driftMinSpeed: 200,
  miniTurbo1: 0.75,
  miniTurbo2: 1.6,
  radius: 15,
  spinRate: 13,
} as const;

export function createKart(
  id: number,
  name: string,
  char: string,
  bot: boolean,
  x: number,
  y: number,
  angle: number,
  s: number,
  trackIdx: number,
): Kart {
  return {
    id,
    name,
    char,
    bot,
    x,
    y,
    angle,
    vx: 0,
    vy: 0,
    spin: 0,
    boost: 0,
    slow: 0,
    slowPhrase: 0,
    invert: 0,
    driftDir: 0,
    driftCharge: 0,
    item: null,
    itemRoll: 0,
    lap: -1,
    s,
    trackIdx,
    finishTime: null,
    honkCd: 0,
    wallCd: 0,
    startHold: 0,
    stats: { hitsGiven: 0, hitsTaken: 0, walls: 0, honks: 0 },
  };
}

export function forwardSpeed(k: Kart): number {
  return k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
}

export function speedOf(k: Kart): number {
  return Math.hypot(k.vx, k.vy);
}

/**
 * Física de un kart para un paso fijo. Pura respecto a la pista: no mira otros karts ni objetos,
 * así el cliente puede usarla para predecir su propio kart.
 * Devuelve eventos locales (muro, miniturbo, vuelta).
 */
export function stepKart(k: Kart, input: Input, dt: number, track: Track, frozen = false): GameEvent[] {
  const events: GameEvent[] = [];
  // Temporizadores
  k.boost = Math.max(0, k.boost - dt);
  k.slow = Math.max(0, k.slow - dt);
  k.invert = Math.max(0, k.invert - dt);
  k.honkCd = Math.max(0, k.honkCd - dt);
  k.wallCd = Math.max(0, k.wallCd - dt);
  if (k.itemRoll > 0) k.itemRoll = Math.max(0, k.itemRoll - dt);

  if (frozen) {
    k.vx = 0;
    k.vy = 0;
    return events;
  }

  const fx = Math.cos(k.angle);
  const fy = Math.sin(k.angle);
  // "derecha" en coordenadas de pantalla (y hacia abajo) = rotar +90º
  const rx = -fy;
  const ry = fx;
  let fwd = k.vx * fx + k.vy * fy;
  let lat = k.vx * rx + k.vy * ry;

  const proj = projectOnTrack(track, k.x, k.y, k.trackIdx);
  const offroad = Math.abs(proj.lateral) > track.halfWidth;

  let maxSpd = PHYS.maxSpeed;
  if (offroad && k.boost <= 0) maxSpd *= PHYS.offroadFactor;
  if (k.boost > 0) maxSpd *= PHYS.boostFactor;
  if (k.slow > 0) maxSpd *= PHYS.slowFactor;

  if (k.spin > 0) {
    k.spin = Math.max(0, k.spin - dt);
    k.angle += PHYS.spinRate * dt;
    fwd *= Math.exp(-3 * dt);
    lat *= Math.exp(-4 * dt);
    k.driftDir = 0;
    k.driftCharge = 0;
  } else {
    const steer = clamp(input.steer, -1, 1) * (k.invert > 0 ? -1 : 1);

    // Acelerador / freno
    if (k.boost > 0) {
      fwd = Math.max(fwd, maxSpd * 0.9);
      fwd = Math.min(fwd + PHYS.accel * 2 * dt, maxSpd);
    } else if (input.throttle && !input.brake) {
      if (fwd < maxSpd) fwd = Math.min(maxSpd, fwd + PHYS.accel * dt);
      else fwd = Math.max(maxSpd, fwd - PHYS.brake * dt);
    } else if (input.brake) {
      if (fwd > 0) fwd = Math.max(0, fwd - PHYS.brake * dt);
      else fwd = Math.max(-PHYS.reverseMax, fwd - PHYS.accel * 0.6 * dt);
    } else {
      const drag = (fwd > maxSpd ? PHYS.brake : PHYS.coastDrag) * dt;
      fwd = fwd > 0 ? Math.max(0, fwd - drag) : Math.min(0, fwd + drag);
    }
    if (fwd > maxSpd) fwd = Math.max(maxSpd, fwd - PHYS.brake * dt);

    // Derrape
    if (input.drift && k.driftDir === 0 && steer !== 0 && fwd > PHYS.driftMinSpeed) {
      k.driftDir = Math.sign(steer);
      k.driftCharge = 0;
    }
    if (k.driftDir !== 0 && (!input.drift || fwd < PHYS.driftMinSpeed * 0.6)) {
      if (input.drift === false && k.driftCharge >= PHYS.miniTurbo1) {
        const level = k.driftCharge >= PHYS.miniTurbo2 ? 2 : 1;
        k.boost = Math.max(k.boost, level === 2 ? 1.0 : 0.5);
        events.push({ type: 'miniturbo', kart: k.id, level });
      }
      k.driftDir = 0;
      k.driftCharge = 0;
    }

    // Giro
    const speedFactor = clamp(Math.abs(fwd) / 160, 0, 1) * Math.sign(fwd || 1);
    let turn: number;
    if (k.driftDir !== 0) {
      // El derrape siempre gira hacia su lado; el stick lo abre o lo cierra.
      turn = k.driftDir * (0.55 + 0.45 * steer * k.driftDir) * PHYS.turnRate;
      k.driftCharge += dt * (Math.sign(steer) === k.driftDir ? 1.25 : 0.7);
    } else {
      turn = steer * PHYS.turnRate;
    }
    k.angle += turn * speedFactor * dt;

    const grip = k.driftDir !== 0 ? PHYS.driftGrip : offroad ? PHYS.offroadGrip : PHYS.grip;
    lat *= Math.exp(-grip * dt);
  }

  // Reconstruir la velocidad con la nueva orientación (el kart "arrastra" la velocidad lateral).
  const nfx = Math.cos(k.angle);
  const nfy = Math.sin(k.angle);
  k.vx = nfx * fwd + -nfy * lat;
  k.vy = nfy * fwd + nfx * lat;

  k.x += k.vx * dt;
  k.y += k.vy * dt;

  // Muros
  const p2 = projectOnTrack(track, k.x, k.y, proj.index);
  const limit = track.halfWidth + track.wallMargin;
  if (Math.abs(p2.lateral) > limit) {
    const side = Math.sign(p2.lateral);
    const over = Math.abs(p2.lateral) - limit;
    k.x -= p2.nx * side * over;
    k.y -= p2.ny * side * over;
    const vn = k.vx * p2.nx + k.vy * p2.ny;
    if (vn * side > 0) {
      // rebote + pérdida de velocidad
      k.vx -= p2.nx * vn * 1.6;
      k.vy -= p2.ny * vn * 1.6;
      k.vx *= 0.8;
      k.vy *= 0.8;
      if (Math.abs(vn) > 120 && k.wallCd <= 0) {
        k.wallCd = 0.6;
        k.stats.walls++;
        events.push({ type: 'wall', kart: k.id });
      }
    }
  }

  updateProgress(k, track, events);
  return events;
}

/** Actualiza s / vuelta a partir de la posición. Detecta paso por meta en ambos sentidos. */
export function updateProgress(k: Kart, track: Track, events?: GameEvent[]): void {
  const p = projectOnTrack(track, k.x, k.y, k.trackIdx);
  const d = deltaS(track, k.s, p.s);
  const crossedForward = d > 0 && k.s + d >= track.length;
  const crossedBackward = d < 0 && k.s + d < 0;
  if (crossedForward) {
    k.lap++;
    if (events && k.lap >= 0) events.push({ type: 'lap', kart: k.id, lap: k.lap });
  } else if (crossedBackward) {
    k.lap--;
  }
  k.s = p.s;
  k.trackIdx = p.index;
}

/** Progreso total en distancia (para ordenar posiciones). */
export function progressOf(k: Kart, track: Track): number {
  return k.lap * track.length + k.s;
}
