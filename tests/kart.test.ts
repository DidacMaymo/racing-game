import { describe, expect, it } from 'vitest';
import { createKart, forwardSpeed, PHYS, speedOf, stepKart, updateProgress } from '../src/game/kart';
import { pointAt, projectOnTrack } from '../src/game/track';
import { getTrack } from '../src/game/tracks';
import type { Input, Kart } from '../src/game/types';
import { DT, input } from './helpers';

const track = getTrack('rotonda');

function kartAt(s: number, lateral = 0): Kart {
  const p = pointAt(track, s);
  const x = p.x + p.nx * lateral;
  const y = p.y + p.ny * lateral;
  const proj = projectOnTrack(track, x, y, p.index);
  return createKart(1, 'T', 'rana', false, x, y, Math.atan2(p.ty, p.tx), proj.s, proj.index);
}

function drive(k: Kart, inp: Input, seconds: number) {
  const events = [];
  for (let i = 0; i < seconds / DT; i++) events.push(...stepKart(k, inp, DT, track));
  return events;
}

describe('física del kart', () => {
  it('acelera hasta la velocidad máxima y no la supera', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 1.5);
    expect(speedOf(k)).toBeGreaterThan(PHYS.maxSpeed * 0.95);
    expect(speedOf(k)).toBeLessThanOrEqual(PHYS.maxSpeed + 1);
  });

  it('frena y luego va marcha atrás limitada', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 1);
    drive(k, input({ brake: true }), 3);
    expect(forwardSpeed(k)).toBeLessThan(0);
    expect(forwardSpeed(k)).toBeGreaterThanOrEqual(-PHYS.reverseMax - 1);
  });

  it('sin gas se para por rozamiento', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 1);
    drive(k, input(), 4);
    expect(speedOf(k)).toBeLessThan(1);
  });

  it('girar a la derecha aumenta el ángulo', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 0.5);
    const a0 = k.angle;
    drive(k, input({ throttle: true, steer: 1 }), 0.2);
    expect(k.angle).toBeGreaterThan(a0);
  });

  it('parado no gira', () => {
    const k = kartAt(100);
    const a0 = k.angle;
    drive(k, input({ steer: 1 }), 1);
    expect(k.angle).toBeCloseTo(a0, 5);
  });

  it('fuera de pista va más lento', () => {
    const on = kartAt(300, 0);
    const off = kartAt(300, track.halfWidth + 20);
    // fijamos la orientación paralela y sólo 0.3s para que no se salga del arcén
    const inp = input({ throttle: true });
    for (let i = 0; i < 60; i++) {
      stepKart(on, inp, DT, track);
      stepKart(off, inp, DT, track);
    }
    off.vx = on.vx * 1; // misma velocidad de entrada
    off.vy = on.vy * 1;
    drive(on, inp, 0.5);
    drive(off, inp, 0.5);
    expect(speedOf(off)).toBeLessThan(speedOf(on) * 0.8);
  });

  it('el turbo permite superar la velocidad máxima', () => {
    const k = kartAt(100);
    k.boost = 1;
    drive(k, input({ throttle: true }), 0.5);
    expect(speedOf(k)).toBeGreaterThan(PHYS.maxSpeed * 1.2);
  });

  it('el cuñado frena', () => {
    const k = kartAt(100);
    k.slow = 5;
    drive(k, input({ throttle: true }), 2);
    expect(speedOf(k)).toBeLessThan(PHYS.maxSpeed * PHYS.slowFactor + 1);
  });

  it('la resaca invierte la dirección', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 0.5);
    k.invert = 2;
    const a0 = k.angle;
    drive(k, input({ throttle: true, steer: 1 }), 0.2);
    expect(k.angle).toBeLessThan(a0);
  });

  it('el trompo hace girar y frena, y no hace caso a los controles', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 1);
    const v0 = speedOf(k);
    k.spin = 1;
    drive(k, input({ throttle: true }), 0.8);
    expect(speedOf(k)).toBeLessThan(v0 * 0.5);
    drive(k, input({ throttle: true }), 0.3);
    expect(k.spin).toBe(0);
  });

  it('los muros contienen al kart aunque vaya directo contra ellos', () => {
    const k = kartAt(500);
    k.angle += Math.PI / 2; // perpendicular a la pista
    drive(k, input({ throttle: true }), 3);
    const proj = projectOnTrack(track, k.x, k.y, k.trackIdx);
    expect(Math.abs(proj.lateral)).toBeLessThanOrEqual(track.halfWidth + track.wallMargin + 1);
    expect(k.stats.walls).toBeGreaterThan(0);
  });

  it('el derrape largo da miniturbo al soltarlo', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 1.2);
    drive(k, input({ throttle: true, drift: true, steer: 1 }), 0.3);
    expect(k.driftDir).toBe(1);
    expect(k.driftCharge).toBeGreaterThan(0.3);
    k.driftCharge = 1.0; // como si llevara un rato derrapando
    const ev = drive(k, input({ throttle: true }), 1 / 60);
    expect(ev.some((e) => e.type === 'miniturbo')).toBe(true);
    expect(k.boost).toBeGreaterThan(0);
    expect(k.driftDir).toBe(0);
  });

  it('un derrape corto no da turbo', () => {
    const k = kartAt(100);
    drive(k, input({ throttle: true }), 1.2);
    drive(k, input({ throttle: true, drift: true, steer: 1 }), 0.2);
    const ev = drive(k, input({ throttle: true }), 1 / 60);
    expect(ev.some((e) => e.type === 'miniturbo')).toBe(false);
  });

  it('congelado no se mueve (cuenta atrás)', () => {
    const k = kartAt(100);
    const x = k.x;
    for (let i = 0; i < 60; i++) stepKart(k, input({ throttle: true }), DT, track, true);
    expect(k.x).toBe(x);
  });

  it('es determinista', () => {
    const a = kartAt(100);
    const b = kartAt(100);
    const seq = [input({ throttle: true }), input({ throttle: true, steer: 0.7 }), input({ drift: true, steer: -1, throttle: true })];
    for (let i = 0; i < 300; i++) {
      stepKart(a, seq[i % 3], DT, track);
      stepKart(b, seq[i % 3], DT, track);
    }
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });
});

describe('vueltas', () => {
  it('cruzar la meta hacia delante suma vuelta y hacia atrás la resta', () => {
    const k = kartAt(track.length - 20);
    expect(k.lap).toBe(-1);
    const p = pointAt(track, 20);
    k.x = p.x;
    k.y = p.y;
    const events: never[] = [];
    updateProgress(k, track, events);
    expect(k.lap).toBe(0);
    const back = pointAt(track, track.length - 20);
    k.x = back.x;
    k.y = back.y;
    updateProgress(k, track);
    expect(k.lap).toBe(-1);
  });

  it('dar una vuelta completa conduciendo por la línea central suma exactamente una por cruce', () => {
    const k = kartAt(track.length - 30);
    k.lap = 0;
    for (let s = track.length - 30; s < track.length * 2 + 30; s += 5) {
      const p = pointAt(track, s);
      k.x = p.x;
      k.y = p.y;
      updateProgress(k, track);
    }
    expect(k.lap).toBe(2);
  });
});
