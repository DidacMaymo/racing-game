import { buildTrack, Track, TrackDef } from './track';

function scale(points: [number, number][], k: number): [number, number][] {
  return points.map(([x, y]) => [x * k, y * k]);
}

function figureEight(): [number, number][] {
  const pts: [number, number][] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    // Empezamos en el extremo derecho para que la salida no esté en el cruce.
    const t = Math.PI / 2 + (i / steps) * Math.PI * 2;
    pts.push([1300 + 1150 * Math.sin(t), 900 + 950 * Math.sin(t) * Math.cos(t)]);
  }
  return pts;
}

export const TRACK_DEFS: TrackDef[] = [
  {
    id: 'rotonda',
    name: 'La Rotonda Infinita',
    subtitle: 'Nadie sabe salir. Nadie.',
    halfWidth: 92,
    grass: '#6fbf4a',
    verge: '#d9c27a',
    decorations: ['🌵', '🌳', '🏠', '🐄', '🚜', '🌻', '🐓'],
    points: scale(
      [
        [400, 300],
        [1400, 250],
        [2200, 350],
        [2600, 800],
        [2400, 1300],
        [1900, 1400],
        [1600, 1100],
        [1200, 1050],
        [900, 1400],
        [400, 1500],
        [150, 1000],
        [150, 600],
      ],
      1.25,
    ),
  },
  {
    id: 'poligono',
    name: 'Polígono Industrial Sur',
    subtitle: 'Cuidado con las carretillas.',
    halfWidth: 90,
    grass: '#8a9a7b',
    verge: '#b5b0a1',
    decorations: ['🏭', '🛢️', '🚧', '📦', '🏢', '🚛', '🐀'],
    points: scale(
      [
        [300, 300],
        [1200, 300],
        [1600, 350],
        [1700, 700],
        [2300, 750],
        [2500, 1100],
        [2300, 1500],
        [1600, 1550],
        [1300, 1200],
        [900, 1250],
        [700, 1600],
        [300, 1550],
        [150, 1000],
        [200, 550],
      ],
      1.25,
    ),
  },
  {
    id: 'ocho',
    name: 'El Ocho del Cuñado',
    subtitle: 'Hay un cruce. Sin semáforo. Suerte.',
    halfWidth: 92,
    grass: '#7cc46a',
    verge: '#e0b98a',
    decorations: ['🍷', '🧀', '🥖', '🌳', '🐑', '⛪', '🍇'],
    points: figureEight(),
  },
];

const cache = new Map<string, Track>();

export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = TRACK_DEFS.find((d) => d.id === id);
    if (!def) throw new Error(`Pista desconocida: ${id}`);
    t = buildTrack(def);
    cache.set(id, t);
  }
  return t;
}

export function isTrackId(id: unknown): id is string {
  return typeof id === 'string' && TRACK_DEFS.some((d) => d.id === id);
}
