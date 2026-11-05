import { describe, expect, it } from 'vitest';
import { itemWeights, rollItem } from '../src/game/items';
import { makeRng } from '../src/game/math';
import { COUNTDOWN, createWorld, END_GRACE, findKart, ranking, stepWorld, useItem } from '../src/game/race';
import { pointAt, projectOnTrack } from '../src/game/track';
import { TRACK_DEFS } from '../src/game/tracks';
import { ITEM_KINDS, type Input } from '../src/game/types';
import { DT, input, players, run, skipCountdown, world } from './helpers';

describe('salida', () => {
  it('la parrilla está detrás de la meta, dentro de la pista y sin solaparse', () => {
    const w = world({ players: players(6) });
    for (const k of w.karts) {
      expect(k.lap).toBe(-1);
      expect(k.s).toBeGreaterThan(w.track.length / 2);
      expect(Math.abs(projectOnTrack(w.track, k.x, k.y).lateral)).toBeLessThan(w.track.halfWidth);
    }
    for (const a of w.karts)
      for (const b of w.karts) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
  });

  it('nadie se mueve durante la cuenta atrás', () => {
    const w = world({ players: players(2, false) });
    const pos = w.karts.map((k) => [k.x, k.y]);
    const inputs = new Map([[0, input({ throttle: true })], [1, input({ throttle: true })]]);
    run(w, COUNTDOWN - 0.1, inputs);
    expect(w.phase).toBe('countdown');
    w.karts.forEach((k, i) => expect([k.x, k.y]).toEqual(pos[i]));
  });

  it('acelerar en el último segundo da turbo de salida', () => {
    const w = world({ players: players(1, false) });
    run(w, COUNTDOWN - 0.5);
    run(w, 0.6, new Map([[0, input({ throttle: true })]]));
    expect(w.phase).toBe('racing');
    expect(w.karts[0].boost).toBeGreaterThan(0);
  });

  it('pisar el gas toda la cuenta atrás cala el kart', () => {
    const w = world({ players: players(1, false) });
    run(w, COUNTDOWN + 0.05, new Map([[0, input({ throttle: true })]]));
    expect(w.karts[0].spin).toBeGreaterThan(0);
    expect(w.events.some((e) => e.type === 'stall')).toBe(true);
  });
});

describe.each(TRACK_DEFS.map((d) => d.id))('bots en %s', (trackId) => {
  it('4 bots terminan 2 vueltas en un tiempo razonable', () => {
    const w = world({ trackId, laps: 2, players: players(4) });
    let t = 0;
    while (w.phase !== 'finished' && t < 150) {
      stepWorld(w, new Map(), DT);
      t += DT;
      w.events.length = 0;
    }
    expect(w.phase).toBe('finished');
    // al menos uno debería terminar en un tiempo decente (sin atascos crónicos)
    expect(w.finishOrder.length).toBeGreaterThanOrEqual(1);
    const first = findKart(w, w.finishOrder[0])!;
    expect(first.finishTime!).toBeLessThan((w.track.length / 430) * 2 * 2.2);
  });
});

describe('clasificación y final', () => {
  it('ranking ordena por progreso', () => {
    const w = world({ players: players(3, false) });
    skipCountdown(w);
    w.karts[0].lap = 0;
    w.karts[0].s = 100;
    w.karts[1].lap = 0;
    w.karts[1].s = 500;
    w.karts[2].lap = 1;
    w.karts[2].s = 10;
    expect(ranking(w)).toEqual([w.karts[2].id, w.karts[1].id, w.karts[0].id]);
  });

  it('los que han terminado van primero en orden de llegada', () => {
    const w = world({ players: players(3, false) });
    w.finishOrder = [w.karts[1].id];
    w.karts[0].lap = 5;
    expect(ranking(w)[0]).toBe(w.karts[1].id);
  });

  it('cuando terminan todos los humanos se acaba la carrera', () => {
    const ps = [
      { id: 0, name: 'Humano', char: 'rana', bot: false },
      { id: 1, name: 'Bot', char: 'pollo', bot: true },
    ];
    const w = createWorld({ trackId: 'rotonda', laps: 1, seed: 5, players: ps });
    skipCountdown(w);
    const h = findKart(w, 0)!;
    // teletransportamos al humano justo antes de la meta en la última vuelta
    const p = pointAt(w.track, w.track.length - 5);
    h.x = p.x;
    h.y = p.y;
    h.s = w.track.length - 5;
    h.trackIdx = p.index;
    h.lap = 0;
    h.angle = Math.atan2(p.ty, p.tx);
    run(w, 0.5, new Map([[0, input({ throttle: true })]]));
    expect(h.finishTime).not.toBeNull();
    expect(w.finishOrder[0]).toBe(0);
    expect(w.phase).toBe('finished');
    expect(w.events.some((e) => e.type === 'finish' && e.kart === 0 && e.place === 1)).toBe(true);
  });

  it('si un humano no termina, la carrera se cierra a los END_GRACE segundos', () => {
    const ps = [
      { id: 0, name: 'A', char: 'rana', bot: false },
      { id: 1, name: 'B', char: 'pollo', bot: false },
    ];
    const w = createWorld({ trackId: 'rotonda', laps: 1, seed: 5, players: ps });
    skipCountdown(w);
    const a = findKart(w, 0)!;
    const p = pointAt(w.track, w.track.length - 5);
    Object.assign(a, { x: p.x, y: p.y, s: w.track.length - 5, trackIdx: p.index, lap: 0, angle: Math.atan2(p.ty, p.tx) });
    run(w, 0.5, new Map([[0, input({ throttle: true })]]));
    expect(a.finishTime).not.toBeNull();
    expect(w.phase).toBe('racing');
    run(w, END_GRACE + 0.5);
    expect(w.phase).toBe('finished');
  });
});

describe('objetos', () => {
  it('el primero nunca recibe pato, cuñado ni resaca', () => {
    const wts = itemWeights(0);
    expect(wts.pato).toBe(0);
    expect(wts.cunado).toBe(0);
    expect(wts.resaca).toBe(0);
    const r = makeRng(9);
    for (let i = 0; i < 500; i++) expect(['platano', 'chancla', 'croqueta']).toContain(rollItem(r, 0, 4));
  });

  it('todos los objetos pueden salir en alguna posición', () => {
    const r = makeRng(9);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) seen.add(rollItem(r, i % 4, 4));
    for (const k of ITEM_KINDS) expect(seen).toContain(k);
  });

  it('jugando solo, rollItem no explota', () => {
    expect(['platano', 'chancla', 'croqueta']).toContain(rollItem(makeRng(1), 0, 1));
  });

  it('coger una caja da objeto con ruleta y la caja desaparece', () => {
    const w = world({ players: players(1, false) });
    skipCountdown(w);
    const k = w.karts[0];
    const b = w.boxes[0];
    k.x = b.x;
    k.y = b.y;
    k.trackIdx = projectOnTrack(w.track, b.x, b.y).index;
    k.s = projectOnTrack(w.track, b.x, b.y).s;
    run(w, DT);
    expect(k.item).not.toBeNull();
    expect(k.itemRoll).toBeGreaterThan(0);
    expect(b.respawn).toBeGreaterThan(0);
    k.x += 300; // nos apartamos para no volver a cogerla
    run(w, 3);
    expect(b.respawn).toBe(0);
  });

  it('no se puede usar el objeto mientras gira la ruleta', () => {
    const w = world({ players: players(1, false) });
    skipCountdown(w);
    const k = w.karts[0];
    k.item = 'croqueta';
    k.itemRoll = 0.5;
    useItem(w, k);
    expect(k.item).toBe('croqueta');
    k.itemRoll = 0;
    useItem(w, k);
    expect(k.item).toBeNull();
    expect(k.boost).toBeGreaterThan(1);
  });

  function twoKarts() {
    const w = world({ players: players(2, false) });
    skipCountdown(w);
    const [a, b] = w.karts;
    // a detrás, b 250px por delante en la recta
    const pa = pointAt(w.track, 200);
    const pb = pointAt(w.track, 450);
    Object.assign(a, { x: pa.x, y: pa.y, s: 200, trackIdx: pa.index, lap: 0, angle: Math.atan2(pa.ty, pa.tx) });
    Object.assign(b, { x: pb.x, y: pb.y, s: 450, trackIdx: pb.index, lap: 0, angle: Math.atan2(pb.ty, pb.tx) });
    return { w, a, b };
  }

  it('la chancla le da al de delante', () => {
    const { w, a, b } = twoKarts();
    a.item = 'chancla';
    useItem(w, a);
    expect(w.projectiles).toHaveLength(1);
    run(w, 1);
    expect(b.spin).toBeGreaterThan(0);
    expect(w.projectiles).toHaveLength(0);
    expect(a.stats.hitsGiven).toBe(1);
    expect(b.stats.hitsTaken).toBe(1);
  });

  it('el plátano se queda detrás y hace trompear al que lo pisa', () => {
    const { w, a, b } = twoKarts();
    b.item = 'platano';
    useItem(w, b);
    expect(w.hazards).toHaveLength(1);
    const h = w.hazards[0];
    // el plátano está detrás de b
    expect(projectOnTrack(w.track, h.x, h.y).s).toBeLessThan(b.s);
    run(w, 1.5, new Map([[a.id, input({ throttle: true })]]));
    expect(a.spin).toBeGreaterThan(0);
    expect(w.hazards).toHaveLength(0);
  });

  it('el dueño no pisa su plátano recién soltado', () => {
    const { w, b } = twoKarts();
    b.item = 'platano';
    useItem(w, b);
    const h = w.hazards[0];
    b.x = h.x;
    b.y = h.y;
    run(w, DT);
    expect(b.spin).toBe(0);
  });

  it('el pato persigue al de delante', () => {
    const { w, a, b } = twoKarts();
    a.item = 'pato';
    useItem(w, a);
    expect(w.projectiles[0].target).toBe(b.id);
    run(w, 2, new Map([[b.id, input({ throttle: true, steer: 0.3 })]]));
    expect(b.stats.hitsTaken).toBe(1);
    expect(a.stats.hitsTaken).toBe(0);
  });

  it('el cuñado va al primero', () => {
    const { w, a, b } = twoKarts();
    a.item = 'cunado';
    useItem(w, a);
    expect(b.slow).toBeGreaterThan(0);
    expect(a.slow).toBe(0);
    expect(w.events.some((e) => e.type === 'use' && e.item === 'cunado' && e.target === b.id)).toBe(true);
  });

  it('si el primero usa el cuñado, le cae al segundo', () => {
    const { w, a, b } = twoKarts();
    b.item = 'cunado';
    useItem(w, b);
    expect(a.slow).toBeGreaterThan(0);
    expect(b.slow).toBe(0);
  });

  it('la resaca invierte a todos menos al que la usa', () => {
    const w = world({ players: players(4, false) });
    skipCountdown(w);
    w.karts[2].item = 'resaca';
    useItem(w, w.karts[2]);
    w.karts.forEach((k, i) => expect(k.invert > 0).toBe(i !== 2));
  });

  it('un kart en trompo no recibe un segundo golpe', () => {
    const { w, a, b } = twoKarts();
    b.spin = 1;
    a.item = 'chancla';
    useItem(w, a);
    run(w, 1);
    expect(b.stats.hitsTaken).toBe(0);
  });

  it('la chancla se destruye contra un plátano', () => {
    const { w, a } = twoKarts();
    const p = pointAt(w.track, 320);
    w.hazards.push({ id: 99, kind: 'platano', x: p.x, y: p.y, owner: 1, age: 5 });
    a.item = 'chancla';
    useItem(w, a);
    run(w, 0.4);
    expect(w.hazards).toHaveLength(0);
    expect(w.projectiles).toHaveLength(0);
  });

  it('los proyectiles caducan', () => {
    const w = world({ players: players(1, false) });
    skipCountdown(w);
    w.karts[0].item = 'chancla';
    useItem(w, w.karts[0]);
    run(w, 6);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('colisiones entre karts', () => {
  it('dos karts solapados se separan', () => {
    const w = world({ players: players(2, false) });
    skipCountdown(w);
    const [a, b] = w.karts;
    b.x = a.x + 3;
    b.y = a.y;
    run(w, DT);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(29.9);
  });
});

describe('determinismo', () => {
  it('misma semilla + mismas entradas = misma carrera', () => {
    const mk = () => world({ seed: 777, laps: 1, players: players(4) });
    const a = mk();
    const b = mk();
    const inp = new Map<number, Input>();
    for (let i = 0; i < 1500; i++) {
      stepWorld(a, inp, DT);
      stepWorld(b, inp, DT);
    }
    expect(a.karts.map((k) => [k.x, k.y, k.item])).toEqual(b.karts.map((k) => [k.x, k.y, k.item]));
  });
});
