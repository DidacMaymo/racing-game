import { describe, expect, it } from 'vitest';
import { clamp, makeRng, nextRandom, randInt, weightedPick, wrapAngle } from '../src/game/math';

describe('math', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('wrapAngle deja el ángulo en (-PI, PI]', () => {
    for (const a of [0, 1, -1, 7, -7, 100, -100, Math.PI, -Math.PI, 3 * Math.PI]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
    }
  });

  it('el RNG es determinista y está en [0,1)', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 1000; i++) {
      const x = nextRandom(a);
      expect(x).toBe(nextRandom(b));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('semillas distintas dan secuencias distintas', () => {
    expect(nextRandom(makeRng(1))).not.toBe(nextRandom(makeRng(2)));
  });

  it('semilla 0 no rompe el RNG', () => {
    const r = makeRng(0);
    const vals = new Set(Array.from({ length: 10 }, () => nextRandom(r)));
    expect(vals.size).toBe(10);
  });

  it('randInt dentro de rango', () => {
    const r = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const v = randInt(r, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
    }
  });

  it('weightedPick respeta pesos cero y aproximadamente las proporciones', () => {
    const r = makeRng(3);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10000; i++) counts[weightedPick(r, { a: 1, b: 3, c: 0 })]++;
    expect(counts.c).toBe(0);
    expect(counts.b / counts.a).toBeGreaterThan(2.5);
    expect(counts.b / counts.a).toBeLessThan(3.5);
  });

  it('weightedPick sin pesos válidos lanza', () => {
    expect(() => weightedPick(makeRng(1), { a: 0 })).toThrow();
  });
});
