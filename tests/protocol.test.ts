import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/game/race';
import {
  applyKart,
  applySnapshot,
  clampSettings,
  encodeInput,
  encodeKart,
  encodeSnapshot,
  normalizeRoomCode,
  parseClientMsg,
  parseHostMsg,
  peerIdForRoom,
  randomRoomCode,
  sanitizeName,
} from '../src/net/protocol';
import { players, run, skipCountdown, world } from './helpers';

describe('validación de mensajes de cliente', () => {
  it('rechaza basura', () => {
    for (const junk of [null, undefined, 3, 'hola', [], {}, { t: 'nope' }, { t: 'in' }, { t: 'in', q: 'a', s: 0, b: 0, i: 0, h: 0 }])
      expect(parseClientMsg(junk)).toBeNull();
    expect(parseClientMsg({ t: 'in', q: 1, s: NaN, b: 0, i: 0, h: 0 })).toBeNull();
    expect(parseClientMsg({ t: 'in', q: 1, s: Infinity, b: 0, i: 0, h: 0 })).toBeNull();
    expect(parseClientMsg({ t: 'hello', name: 'x' })).toBeNull();
  });

  it('acota el volante y los bits', () => {
    const m = parseClientMsg({ t: 'in', q: 5.7, s: 50, b: 255, i: 1, h: 2 });
    expect(m).toEqual({ t: 'in', q: 5, s: 1, b: 7, i: 1, h: 2 });
  });

  it('sanea nombres y personajes', () => {
    const m = parseClientMsg({ t: 'hello', v: 1, name: '  Pepe\n\u0007   el   de la moto que corre mucho', char: 'hacker' });
    expect(m).toMatchObject({ t: 'hello', char: 'rana' });
    if (m?.t === 'hello') {
      expect(m.name).toBe('Pepe el de la ');
      expect(Array.from(m.name).length).toBeLessThanOrEqual(14);
    }
  });

  it('nombre vacío => Anónimo', () => {
    expect(sanitizeName('   ')).toBe('Anónimo');
    expect(sanitizeName(42)).toBe('Anónimo');
  });

  it('no parte emojis por la mitad', () => {
    const n = sanitizeName('🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸🐸');
    expect(Array.from(n).length).toBe(14);
    expect(n).not.toMatch(/�/);
  });
});

describe('validación de mensajes del anfitrión', () => {
  it('rechaza basura y pistas inexistentes', () => {
    expect(parseHostMsg(null)).toBeNull();
    expect(parseHostMsg({ t: 'start', config: { trackId: 'luna', laps: 3, seed: 1, players: [] } })).toBeNull();
    expect(parseHostMsg({ t: 'snap', k: 1 })).toBeNull();
    expect(parseHostMsg({ t: 'welcome', id: 3 })).toEqual({ t: 'welcome', id: 3 });
  });
});

describe('snapshots', () => {
  it('encodeKart/applyKart conservan el estado', () => {
    const w = world({ players: players(2, false) });
    skipCountdown(w);
    const k = w.karts[0];
    Object.assign(k, { item: 'pato', itemRoll: 0.4, spin: 0.3, boost: 1.2, slow: 2, slowPhrase: 3, invert: 1, driftDir: -1, driftCharge: 0.5, finishTime: 12.5 });
    k.stats.hitsGiven = 4;
    const enc = encodeKart(k, 77);
    const other = createWorld(w.config).karts[0];
    const ack = applyKart(other, JSON.parse(JSON.stringify(enc)));
    expect(ack).toBe(77);
    expect(other.item).toBe('pato');
    expect(other.finishTime).toBe(12.5);
    expect(other.driftDir).toBe(-1);
    expect(other.stats.hitsGiven).toBe(4);
    expect(other.x).toBeCloseTo(k.x, 1);
  });

  it('un snapshot completo reproduce el mundo en el cliente', () => {
    const host = world({ players: players(4), seed: 99 });
    run(host, 12);
    const snap = JSON.parse(JSON.stringify(encodeSnapshot(host, new Map(), [{ type: 'go' }])));
    const client = createWorld(host.config);
    const { mine } = applySnapshot(client, snap, 2);
    expect(mine).not.toBeNull();
    expect(client.phase).toBe(host.phase);
    expect(client.projectiles.length).toBe(host.projectiles.length);
    expect(client.hazards.length).toBe(host.hazards.length);
    expect(client.boxes.map((b) => b.respawn > 0)).toEqual(host.boxes.map((b) => b.respawn > 0));
    for (const k of client.karts) {
      if (k.id === 2) continue;
      const h = host.karts.find((hk) => hk.id === k.id)!;
      expect(k.x).toBeCloseTo(h.x, 1);
      expect(k.lap).toBe(h.lap);
      expect(k.item).toBe(h.item);
    }
  });

  it('el snapshot es pequeño (< 3 KB con 6 karts)', () => {
    const host = world({ players: players(6), seed: 3 });
    run(host, 15);
    expect(JSON.stringify(encodeSnapshot(host, new Map(), [])).length).toBeLessThan(3000);
  });
});

describe('utilidades', () => {
  it('códigos de sala', () => {
    for (let i = 0; i < 100; i++) {
      const c = randomRoomCode();
      expect(normalizeRoomCode(c)).toBe(c);
    }
    expect(normalizeRoomCode(' ab-cd ')).toBe('ABCD');
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('ABIO')).toBeNull(); // I y O excluidas por confusas
    expect(peerIdForRoom('ABCD')).toContain('ABCD');
  });

  it('encodeInput empaqueta los bits', () => {
    expect(encodeInput(3, 0.333, true, false, true, 2, 1)).toEqual({ t: 'in', q: 3, s: 0.33, b: 5, i: 2, h: 1 });
  });

  it('clampSettings', () => {
    expect(clampSettings({ trackId: 'x', laps: 99, bots: 99 }, 4)).toEqual({ trackId: 'rotonda', laps: 5, bots: 2 });
    expect(clampSettings({ trackId: 'ocho', laps: 0, bots: -3 }, 1)).toEqual({ trackId: 'ocho', laps: 3, bots: 0 });
  });
});
