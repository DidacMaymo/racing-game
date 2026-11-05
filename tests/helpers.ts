import { createWorld, stepWorld, WorldExt } from '../src/game/race';
import type { Input, RacePlayer } from '../src/game/types';

export const DT = 1 / 60;

export function players(n: number, bots = true): RacePlayer[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, char: 'rana', bot: bots }));
}

export function world(opts: { trackId?: string; laps?: number; seed?: number; players?: RacePlayer[] } = {}): WorldExt {
  return createWorld({
    trackId: opts.trackId ?? 'rotonda',
    laps: opts.laps ?? 1,
    seed: opts.seed ?? 1234,
    players: opts.players ?? players(4),
  });
}

export function input(p: Partial<Input> = {}): Input {
  return { steer: 0, throttle: false, brake: false, drift: false, item: false, honk: false, ...p };
}

export function run(w: WorldExt, seconds: number, inputs: Map<number, Input> = new Map()): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepWorld(w, inputs, DT);
}

export function skipCountdown(w: WorldExt): void {
  while (w.phase === 'countdown') stepWorld(w, new Map(), DT);
}
