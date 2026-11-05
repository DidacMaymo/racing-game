import { clamp, makeRng, nextRandom, Rng, wrapAngle } from './math';
import { pointAt } from './track';
import { speedOf } from './kart';
import type { Input, Kart, World } from './types';

export interface BotBrain {
  lane: number;
  stuck: number;
  reverse: number;
  itemHold: number;
  itemDelay: number;
  startAt: number;
  skill: number;
  rng: Rng;
}

export function createBrain(seed: number, id: number): BotBrain {
  const rng = makeRng((seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0);
  return {
    lane: nextRandom(rng) * 1.2 - 0.6,
    stuck: 0,
    reverse: 0,
    itemHold: 0,
    itemDelay: 1 + nextRandom(rng) * 2.5,
    startAt: 0.3 + nextRandom(rng) * 1.1,
    skill: 0.85 + nextRandom(rng) * 0.15,
    rng,
  };
}

export function botInput(w: World, k: Kart, brain: BotBrain, dt: number): Input {
  if (w.phase === 'countdown') {
    return { steer: 0, throttle: w.countdown <= brain.startAt, brake: false, drift: false, item: false, honk: false };
  }
  const track = w.track;
  const speed = speedOf(k);
  const look = 130 + speed * 0.45;
  const p = pointAt(track, k.s + look);
  const tx = p.x + p.nx * brain.lane * track.halfWidth * 0.5;
  const ty = p.y + p.ny * brain.lane * track.halfWidth * 0.5;
  const desired = Math.atan2(ty - k.y, tx - k.x);
  const diff = wrapAngle(desired - k.angle);

  let steer = clamp(diff * 2.4, -1, 1);
  let throttle = speed < 430 * brain.skill + 1 || k.boost > 0;
  let brake = Math.abs(diff) > 1.2 && speed > 220;
  const drift = Math.abs(diff) > 0.3 && speed > 280 && k.spin <= 0;

  if (k.spin <= 0 && speed < 40) brain.stuck += dt;
  else brain.stuck = 0;
  if (brain.stuck > 1.2) {
    brain.reverse = 0.9;
    brain.stuck = 0;
  }
  if (brain.reverse > 0) {
    brain.reverse -= dt;
    throttle = false;
    brake = true;
    steer = -steer;
  }

  let item = false;
  if (k.item && k.itemRoll <= 0 && !k.finishTime) {
    brain.itemHold += dt;
    if (brain.itemHold >= brain.itemDelay) {
      item = true;
      brain.itemHold = 0;
      brain.itemDelay = 1 + nextRandom(brain.rng) * 2.5;
    }
  }
  const honk = nextRandom(brain.rng) < 0.0015;
  return { steer, throttle, brake, drift, item, honk };
}
