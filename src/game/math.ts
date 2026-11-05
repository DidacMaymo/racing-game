export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normaliza un ángulo a (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** PRNG determinista (mulberry32). Estado = un uint32, serializable. */
export interface Rng {
  state: number;
}

export function makeRng(seed: number): Rng {
  return { state: seed >>> 0 || 0x9e3779b9 };
}

export function nextRandom(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(rng: Rng, n: number): number {
  return Math.floor(nextRandom(rng) * n);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)];
}

/** Elige una clave según pesos. Pesos <= 0 se ignoran. */
export function weightedPick<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K {
  const entries = Object.entries(weights) as [K, number][];
  const valid = entries.filter(([, w]) => w > 0);
  if (valid.length === 0) throw new Error('weightedPick: sin pesos válidos');
  const total = valid.reduce((s, [, w]) => s + w, 0);
  let r = nextRandom(rng) * total;
  for (const [k, w] of valid) {
    r -= w;
    if (r < 0) return k;
  }
  return valid[valid.length - 1][0];
}
