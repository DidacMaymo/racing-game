import { Rng, weightedPick } from './math';
import type { ItemKind } from './types';

export interface ItemInfo {
  emoji: string;
  name: string;
  desc: string;
}

export const ITEMS: Record<ItemKind, ItemInfo> = {
  chancla: { emoji: '🩴', name: 'Chancla', desc: 'Se lanza hacia delante y rebota. Puntería de madre.' },
  platano: { emoji: '🍌', name: 'Plátano', desc: 'Lo sueltas detrás. Clásico eterno.' },
  croqueta: { emoji: '🥘', name: 'Croqueta Turbo', desc: 'Turbo inmediato. De la abuela.' },
  cunado: { emoji: '🧔', name: 'Cuñado', desc: 'Le manda un cuñado al primero. Le da la chapa y le frena.' },
  pato: { emoji: '🦆', name: 'Pato Teledirigido', desc: 'Persigue al de delante. CUAC.' },
  resaca: { emoji: '🥴', name: 'Resaca', desc: 'Todos los demás con los controles al revés.' },
};

/**
 * Pesos por posición: el primero recibe objetos defensivos; los últimos, los gordos.
 * `frac` = 0 para el primero, 1 para el último.
 */
export function itemWeights(frac: number): Record<ItemKind, number> {
  if (frac <= 0.001) {
    return { platano: 45, chancla: 40, croqueta: 15, pato: 0, cunado: 0, resaca: 0 };
  }
  if (frac >= 0.999) {
    return { platano: 5, chancla: 10, croqueta: 30, pato: 20, cunado: 20, resaca: 15 };
  }
  return { platano: 20, chancla: 30, croqueta: 20, pato: 18, cunado: 5, resaca: 7 };
}

export function rollItem(rng: Rng, rank: number, total: number): ItemKind {
  const frac = total <= 1 ? 0 : rank / (total - 1);
  return weightedPick(rng, itemWeights(frac));
}

export const CUNADO_PHRASES = [
  'Esto con un Seat Panda lo hacía yo en la mitad',
  '¿Has probado a frenar ANTES de la curva?',
  'Yo de ti iría por la izquierda',
  'Esto en mis tiempos era todo campo',
  'Échale aceite de oliva al motor, mano de santo',
  'Te lo dije. Te lo dije. TE LO DIJE.',
  'Yo conozco a uno que corre en Fórmula 1',
  'Eso es la junta de la trócola, fijo',
  '¿Sabes lo que pagaba yo por la gasolina?',
  'Lo que tienes que hacer es invertir en cripto',
];
