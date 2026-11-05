import { ITEMS } from './items';
import { pick, Rng } from './math';
import type { GameEvent } from './types';

export type NameOf = (id: number) => string;

const HIT_LINES: Record<string, string[]> = {
  chancla: [
    '¡CHANCLAZO de {by} a {v}! Su madre estaría orgullosa',
    '{v} ha recibido la chancla de {by}. Eso deja marca',
    '¡{by} lanza la chancla con precisión de abuela!',
  ],
  platano: ['{v} ha pisado un plátano. Clásico', '{v} resbala con un plátano de {by}', '¡Plátano! {v} hace la croqueta'],
  pato: ['¡CUAC! El pato de {by} encuentra a {v}', '{v} atacado por un pato de goma. Humillante', '{by} → 🦆 → {v}'],
};

const SELF_HIT = ['{v} se ha dado con lo suyo. Genio', '{v} se ha comido su propia trampa 🤦'];

/**
 * Convierte un evento en una línea de comentario (o null si no merece la pena).
 * `me` es el id del jugador local, para dar mensajes más personales.
 */
export function commentFor(e: GameEvent, name: NameOf, rng: Rng, me: number, laps: number): string | null {
  const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  switch (e.type) {
    case 'hit': {
      const vars = { v: name(e.victim), by: name(e.by) };
      if (e.victim === e.by) return fill(pick(rng, SELF_HIT), vars);
      return fill(pick(rng, HIT_LINES[e.item] ?? ['{v} ha caído']), vars);
    }
    case 'use':
      if (e.item === 'cunado' && e.target !== undefined)
        return `${name(e.kart)} le manda un CUÑADO a ${name(e.target)} 🧔`;
      if (e.item === 'resaca') return `${name(e.kart)} reparte RESACA para todos 🥴`;
      if (e.item === 'croqueta' && e.kart === me) return '¡Croqueta turbo! 🥘💨';
      return null;
    case 'lap':
      if (e.lap === laps - 1 && laps > 1) return e.kart === me ? '¡ÚLTIMA VUELTA!' : `${name(e.kart)} entra en la última vuelta`;
      return null;
    case 'finish':
      if (e.place === 1) return `🏆 ¡${name(e.kart)} GANA! 🏆`;
      return `${name(e.kart)} llega ${e.place}º`;
    case 'stall':
      return pick(rng, [`A ${name(e.kart)} se le ha calado el kart 🤡`, `${name(e.kart)} pisó a fondo antes de tiempo. Calado.`]);
    case 'startboost':
      return e.kart === me ? '¡Salida perfecta! 🚀' : null;
    case 'miniturbo':
      return e.kart === me && e.level === 2 ? '¡Superturbo! 🔥' : null;
    default:
      return null;
  }
}

export function itemLabel(kind: keyof typeof ITEMS): string {
  return `${ITEMS[kind].emoji} ${ITEMS[kind].name}`;
}
