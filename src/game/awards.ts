import type { World } from './types';

export interface Award {
  emoji: string;
  title: string;
  kart: number;
  value: number;
}

const DEFS: { key: 'hitsGiven' | 'hitsTaken' | 'walls' | 'honks'; emoji: string; title: string }[] = [
  { key: 'hitsGiven', emoji: '🩴', title: 'Chancla de Oro (más golpes dados)' },
  { key: 'hitsTaken', emoji: '🍌', title: 'Imán de Desgracias (más golpes recibidos)' },
  { key: 'walls', emoji: '🧱', title: 'Amigo de los Muros' },
  { key: 'honks', emoji: '📯', title: 'Claxon Más Pesado' },
];

/** Premios de fin de carrera. Sólo se dan si alguien hizo algo (valor > 0); empate => gana el primero en la lista. */
export function computeAwards(w: World): Award[] {
  const out: Award[] = [];
  for (const d of DEFS) {
    let best: { kart: number; value: number } | null = null;
    for (const k of w.karts) {
      const v = k.stats[d.key];
      if (v > 0 && (!best || v > best.value)) best = { kart: k.id, value: v };
    }
    if (best) out.push({ emoji: d.emoji, title: d.title, ...best });
  }
  return out;
}
