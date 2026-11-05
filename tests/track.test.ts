import { describe, expect, it } from 'vitest';
import { deltaS, pointAt, projectOnTrack, wrapS } from '../src/game/track';
import { getTrack, TRACK_DEFS } from '../src/game/tracks';

describe.each(TRACK_DEFS.map((d) => d.id))('pista %s', (id) => {
  const track = getTrack(id);

  it('tiene una longitud razonable (vueltas de ~12-25 s)', () => {
    expect(track.length).toBeGreaterThan(4500);
    expect(track.length).toBeLessThan(11000);
  });

  it('proyectar un punto de la línea central devuelve su s y lateral ~0', () => {
    for (let s = 0; s < track.length; s += 137) {
      const p = pointAt(track, s);
      const proj = projectOnTrack(track, p.x, p.y, p.index);
      expect(Math.abs(proj.lateral)).toBeLessThan(0.5);
      expect(Math.abs(deltaS(track, s, proj.s))).toBeLessThan(0.5);
    }
  });

  it('el lateral tiene signo de la normal izquierda', () => {
    const p = pointAt(track, track.length * 0.3);
    const proj = projectOnTrack(track, p.x + p.nx * 40, p.y + p.ny * 40, p.index);
    expect(proj.lateral).toBeCloseTo(40, 0);
    const proj2 = projectOnTrack(track, p.x - p.nx * 40, p.y - p.ny * 40, p.index);
    expect(proj2.lateral).toBeCloseTo(-40, 0);
  });

  it('las cajas de objetos están dentro de la carretera', () => {
    expect(track.boxes.length).toBeGreaterThan(0);
    for (const b of track.boxes) {
      expect(Math.abs(projectOnTrack(track, b.x, b.y).lateral)).toBeLessThan(track.halfWidth);
    }
  });

  it('la decoración está fuera de la pista', () => {
    expect(track.decorations.length).toBeGreaterThan(20);
    for (const d of track.decorations) {
      expect(Math.abs(projectOnTrack(track, d.x, d.y).lateral)).toBeGreaterThan(track.halfWidth + track.wallMargin);
    }
  });

  it('la pista no se pisa a sí misma salvo en cruces intencionados', () => {
    // Para cada punto, cualquier otro tramo lejano (en s) debe estar a más de un ancho de carretera,
    // salvo en el ocho, donde se permite un único cruce.
    const step = 40;
    let closeCalls = 0;
    for (let s1 = 0; s1 < track.length; s1 += step) {
      const a = pointAt(track, s1);
      for (let s2 = s1 + 600; s2 < track.length; s2 += step) {
        if (Math.abs(deltaS(track, s1, s2)) < 600) continue;
        const b = pointAt(track, s2);
        if (Math.hypot(a.x - b.x, a.y - b.y) < (track.halfWidth + track.wallMargin) * 2) closeCalls++;
      }
    }
    if (id === 'ocho') expect(closeCalls).toBeGreaterThan(0);
    else expect(closeCalls).toBe(0);
  });
});

describe('utilidades de pista', () => {
  const track = getTrack('rotonda');
  it('wrapS', () => {
    expect(wrapS(track, -10)).toBeCloseTo(track.length - 10);
    expect(wrapS(track, track.length + 5)).toBeCloseTo(5);
  });
  it('deltaS coge el camino corto alrededor de la meta', () => {
    expect(deltaS(track, track.length - 10, 10)).toBeCloseTo(20);
    expect(deltaS(track, 10, track.length - 10)).toBeCloseTo(-20);
  });
  it('pista desconocida lanza', () => {
    expect(() => getTrack('nope')).toThrow();
  });
});
