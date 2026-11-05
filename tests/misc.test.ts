import { describe, expect, it } from 'vitest';
import { computeAwards } from '../src/game/awards';
import { CHARACTERS, getCharacter, isCharacterId } from '../src/game/characters';
import { commentFor } from '../src/game/commentary';
import { makeRng } from '../src/game/math';
import type { GameEvent } from '../src/game/types';
import { players, world } from './helpers';

describe('premios', () => {
  it('sin estadísticas no hay premios', () => {
    expect(computeAwards(world())).toEqual([]);
  });
  it('da el premio al que más tiene', () => {
    const w = world({ players: players(3) });
    w.karts[1].stats.hitsGiven = 3;
    w.karts[2].stats.hitsGiven = 1;
    w.karts[0].stats.honks = 9;
    const a = computeAwards(w);
    expect(a.find((x) => x.emoji === '🩴')).toMatchObject({ kart: w.karts[1].id, value: 3 });
    expect(a.find((x) => x.emoji === '📯')).toMatchObject({ kart: w.karts[0].id, value: 9 });
    expect(a.find((x) => x.emoji === '🧱')).toBeUndefined();
  });
});

describe('personajes', () => {
  it('ids únicos y fallback', () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    expect(getCharacter('???').id).toBe(CHARACTERS[0].id);
    expect(isCharacterId('rana')).toBe(true);
    expect(isCharacterId('__proto__')).toBe(false);
  });
});

describe('comentarista', () => {
  const name = (id: number) => `J${id}`;
  const all: GameEvent[] = [
    { type: 'hit', victim: 1, by: 2, item: 'chancla' },
    { type: 'hit', victim: 1, by: 1, item: 'platano' },
    { type: 'hit', victim: 1, by: 2, item: 'pato' },
    { type: 'use', kart: 1, item: 'cunado', target: 2 },
    { type: 'use', kart: 1, item: 'resaca' },
    { type: 'lap', kart: 1, lap: 2 },
    { type: 'finish', kart: 1, place: 1 },
    { type: 'finish', kart: 1, place: 3 },
    { type: 'stall', kart: 1 },
  ];
  it('genera textos con los nombres y sin huecos sin rellenar', () => {
    const rng = makeRng(1);
    for (const e of all) {
      const t = commentFor(e, name, rng, 1, 3);
      expect(t).toBeTruthy();
      expect(t).not.toMatch(/\{|\}|undefined/);
    }
  });
  it('autogol tiene su propio texto', () => {
    const t = commentFor({ type: 'hit', victim: 4, by: 4, item: 'platano' }, name, makeRng(2), 0, 3)!;
    expect(t).toContain('J4');
  });
  it('eventos aburridos no se comentan', () => {
    expect(commentFor({ type: 'honk', kart: 1 }, name, makeRng(1), 0, 3)).toBeNull();
    expect(commentFor({ type: 'lap', kart: 1, lap: 0 }, name, makeRng(1), 0, 3)).toBeNull();
  });
  it('avisa de la última vuelta', () => {
    expect(commentFor({ type: 'lap', kart: 0, lap: 2 }, name, makeRng(1), 0, 3)).toMatch(/ÚLTIMA/);
  });
});
