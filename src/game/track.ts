import { makeRng, nextRandom } from './math';

export interface TrackDef {
  id: string;
  name: string;
  subtitle: string;
  /** Puntos de control del circuito cerrado (sentido de carrera). */
  points: [number, number][];
  halfWidth: number;
  /** Colores de ambiente. */
  grass: string;
  verge: string;
  decorations: string[];
}

export interface Track {
  def: TrackDef;
  /** Línea central muestreada (cerrada: el último punto conecta con el primero). */
  xs: Float64Array;
  ys: Float64Array;
  /** Distancia acumulada hasta el punto i. */
  cum: Float64Array;
  segLen: Float64Array;
  length: number;
  halfWidth: number;
  /** Margen fuera de pista (arcén/hierba) antes del muro. */
  wallMargin: number;
  boxes: { x: number; y: number }[];
  decorations: { x: number; y: number; emoji: string; size: number }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface Projection {
  index: number;
  /** Distancia recorrida a lo largo de la línea central [0, length). */
  s: number;
  /** Desplazamiento lateral con signo (positivo = izquierda según la dirección). */
  lateral: number;
  /** Tangente unitaria. */
  tx: number;
  ty: number;
  /** Normal izquierda unitaria. */
  nx: number;
  ny: number;
}

const SAMPLE_SPACING = 8;
const PROJECT_WINDOW = 60;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function buildTrack(def: TrackDef): Track {
  const pts = def.points;
  const n = pts.length;
  if (n < 4) throw new Error(`Pista ${def.id}: necesita al menos 4 puntos`);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(chord / SAMPLE_SPACING));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      xs.push(catmull(p0[0], p1[0], p2[0], p3[0], t));
      ys.push(catmull(p0[1], p1[1], p2[1], p3[1], t));
    }
  }
  const m = xs.length;
  const segLen = new Float64Array(m);
  const cum = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const len = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]) || 1e-6;
    segLen[i] = len;
    cum[i] = total;
    total += len;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < m; i++) {
    minX = Math.min(minX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxX = Math.max(maxX, xs[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const pad = def.halfWidth + 400;

  const track: Track = {
    def,
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    cum,
    segLen,
    length: total,
    halfWidth: def.halfWidth,
    wallMargin: 36,
    boxes: [],
    decorations: [],
    bounds: { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad },
  };

  // Filas de cajas de objetos.
  for (const frac of [0.22, 0.52, 0.8]) {
    const p = pointAt(track, frac * total);
    for (const lat of [-0.6, -0.2, 0.2, 0.6]) {
      track.boxes.push({ x: p.x + p.nx * lat * def.halfWidth, y: p.y + p.ny * lat * def.halfWidth });
    }
  }

  // Decoración determinista alrededor de la pista.
  const rng = makeRng(hashString(def.id));
  const b = track.bounds;
  let attempts = 0;
  while (track.decorations.length < 90 && attempts < 3000) {
    attempts++;
    const x = b.minX + nextRandom(rng) * (b.maxX - b.minX);
    const y = b.minY + nextRandom(rng) * (b.maxY - b.minY);
    const proj = projectOnTrack(track, x, y);
    if (Math.abs(proj.lateral) < def.halfWidth + track.wallMargin + 50) continue;
    const emoji = def.decorations[Math.floor(nextRandom(rng) * def.decorations.length)];
    track.decorations.push({ x, y, emoji, size: 26 + nextRandom(rng) * 30 });
  }
  return track;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Normaliza s a [0, length). */
export function wrapS(track: Track, s: number): number {
  const L = track.length;
  return ((s % L) + L) % L;
}

/** Punto de la línea central a distancia s, con tangente y normal. */
export function pointAt(track: Track, s: number) {
  s = wrapS(track, s);
  // búsqueda binaria en cum
  let lo = 0;
  let hi = track.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = (i + 1) % track.xs.length;
  const t = (s - track.cum[i]) / track.segLen[i];
  const tx = (track.xs[j] - track.xs[i]) / track.segLen[i];
  const ty = (track.ys[j] - track.ys[i]) / track.segLen[i];
  return {
    index: i,
    x: track.xs[i] + (track.xs[j] - track.xs[i]) * t,
    y: track.ys[i] + (track.ys[j] - track.ys[i]) * t,
    tx,
    ty,
    nx: -ty,
    ny: tx,
  };
}

/**
 * Proyecta un punto sobre la línea central. Con `hint` busca sólo en una ventana
 * alrededor del índice previo (necesario en pistas que se cruzan, p.ej. el ocho).
 */
export function projectOnTrack(track: Track, x: number, y: number, hint?: number): Projection {
  const m = track.xs.length;
  let from = 0;
  let count = m;
  if (hint !== undefined && hint >= 0 && hint < m) {
    from = hint - PROJECT_WINDOW;
    count = PROJECT_WINDOW * 2 + 1;
  }
  let best = -1;
  let bestD = Infinity;
  let bestT = 0;
  for (let k = 0; k < count; k++) {
    const i = (((from + k) % m) + m) % m;
    const j = i + 1 === m ? 0 : i + 1;
    const ax = track.xs[i];
    const ay = track.ys[i];
    const dx = track.xs[j] - ax;
    const dy = track.ys[j] - ay;
    const l2 = dx * dx + dy * dy;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    const d = px * px + py * py;
    if (d < bestD) {
      bestD = d;
      best = i;
      bestT = t;
    }
  }
  const i = best;
  const j = i + 1 === m ? 0 : i + 1;
  const len = track.segLen[i];
  const tx = (track.xs[j] - track.xs[i]) / len;
  const ty = (track.ys[j] - track.ys[i]) / len;
  const lateral = tx * (y - track.ys[i]) - ty * (x - track.xs[i]);
  let sOut = track.cum[i] + bestT * len;
  if (sOut >= track.length) sOut -= track.length;
  return {
    index: i,
    s: sOut,
    lateral,
    tx,
    ty,
    nx: -ty,
    ny: tx,
  };
}

/** Diferencia de s más corta (con signo) entre dos posiciones de la pista. */
export function deltaS(track: Track, from: number, to: number): number {
  const L = track.length;
  let d = to - from;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}
