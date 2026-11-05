import type { Rng } from './math';
import type { Track } from './track';

export type ItemKind = 'chancla' | 'platano' | 'croqueta' | 'cunado' | 'pato' | 'resaca';

export const ITEM_KINDS: readonly ItemKind[] = ['chancla', 'platano', 'croqueta', 'cunado', 'pato', 'resaca'];

export interface Input {
  /** -1 (izquierda) .. 1 (derecha) */
  steer: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  /** true sólo en el tick en que se pulsa. */
  item: boolean;
  honk: boolean;
}

export const NO_INPUT: Input = Object.freeze({
  steer: 0,
  throttle: false,
  brake: false,
  drift: false,
  item: false,
  honk: false,
});

export interface KartStats {
  hitsGiven: number;
  hitsTaken: number;
  walls: number;
  honks: number;
}

export interface Kart {
  id: number;
  name: string;
  char: string;
  bot: boolean;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /** Segundos restantes de trompo. */
  spin: number;
  /** Segundos restantes de turbo. */
  boost: number;
  /** Segundos restantes con el cuñado dando la chapa (más lento). */
  slow: number;
  slowPhrase: number;
  /** Segundos restantes con controles invertidos. */
  invert: number;
  /** Dirección del derrape (-1, 0, 1) y carga acumulada. */
  driftDir: number;
  driftCharge: number;
  item: ItemKind | null;
  /** Segundos de ruleta antes de poder usar el objeto. */
  itemRoll: number;
  /** Vuelta actual (empieza en -1 porque la parrilla está detrás de la meta). */
  lap: number;
  s: number;
  trackIdx: number;
  finishTime: number | null;
  honkCd: number;
  wallCd: number;
  /** Tiempo con el acelerador pisado durante la cuenta atrás. */
  startHold: number;
  stats: KartStats;
}

export type GameEvent =
  | { type: 'hit'; victim: number; by: number; item: ItemKind }
  | { type: 'use'; kart: number; item: ItemKind; target?: number }
  | { type: 'pickup'; kart: number }
  | { type: 'lap'; kart: number; lap: number }
  | { type: 'finish'; kart: number; place: number }
  | { type: 'honk'; kart: number }
  | { type: 'wall'; kart: number }
  | { type: 'bump'; a: number; b: number }
  | { type: 'miniturbo'; kart: number; level: number }
  | { type: 'startboost'; kart: number }
  | { type: 'stall'; kart: number }
  | { type: 'go' };

export interface Projectile {
  id: number;
  kind: 'chancla' | 'pato';
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  target: number;
  age: number;
  bounces: number;
  trackIdx: number;
}

export interface Hazard {
  id: number;
  kind: 'platano';
  x: number;
  y: number;
  owner: number;
  age: number;
}

export interface ItemBox {
  x: number;
  y: number;
  /** Segundos hasta reaparecer (0 = activa). */
  respawn: number;
}

export type Phase = 'countdown' | 'racing' | 'finished';

export interface RacePlayer {
  id: number;
  name: string;
  char: string;
  bot: boolean;
}

export interface RaceConfig {
  trackId: string;
  laps: number;
  seed: number;
  players: RacePlayer[];
}

export interface World {
  config: RaceConfig;
  track: Track;
  tick: number;
  /** Tiempo de carrera desde el "¡YA!". */
  time: number;
  phase: Phase;
  countdown: number;
  /** Tiempo restante desde que gana el primero hasta cerrar la carrera. */
  endTimer: number;
  karts: Kart[];
  projectiles: Projectile[];
  hazards: Hazard[];
  boxes: ItemBox[];
  events: GameEvent[];
  rng: Rng;
  nextId: number;
  finishOrder: number[];
}
