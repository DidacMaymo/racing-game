import { describe, expect, it } from 'vitest';
import { PHYS } from '../src/game/kart';
import { ClientSession, EMPTY_FRAME, HostSession, InputFrame, TICK } from '../src/net/session';
import { memoryPair, Transport } from '../src/net/transport';

interface Net {
  host: HostSession;
  clients: ClientSession[];
  flushes: (() => number)[];
  links: { a: Transport; b: Transport }[];
}

function setup(nClients: number, bots = 0): Net {
  const host = new HostSession('Anfitrión', 'rana', { bots, laps: 1 });
  const net: Net = { host, clients: [], flushes: [], links: [] };
  for (let i = 0; i < nClients; i++) addClient(net, `C${i}`);
  return net;
}

function addClient(net: Net, name: string) {
  const { a, b, flush } = memoryPair();
  net.host.addConnection(a);
  const c = new ClientSession(b, name, 'pollo');
  net.clients.push(c);
  net.flushes.push(flush);
  net.links.push({ a, b });
  flushAll(net);
  return c;
}

function flushAll(net: Net) {
  for (let i = 0; i < 5; i++) for (const f of net.flushes) f();
}

/** Simula `seconds` con una latencia de `lagTicks` ticks entre envío y entrega. */
function simulate(net: Net, seconds: number, frames: Map<number, InputFrame> = new Map(), lagTicks = 0) {
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) {
    net.host.update(TICK, frames.get(0) ?? EMPTY_FRAME);
    for (const c of net.clients) c.update(TICK, frames.get(c.myId) ?? EMPTY_FRAME);
    if (lagTicks === 0 || i % lagTicks === 0) flushAll(net);
  }
  flushAll(net);
}

const GAS: InputFrame = { ...EMPTY_FRAME, throttle: true };

describe('sala', () => {
  it('los clientes reciben id y la lista de jugadores', () => {
    const net = setup(2);
    expect(net.clients.map((c) => c.myId)).toEqual([1, 2]);
    expect(net.host.players).toHaveLength(3);
    for (const c of net.clients) {
      expect(c.status).toBe('lobby');
      expect(c.lobby?.players.map((p) => p.name)).toEqual(['Anfitrión', 'C0', 'C1']);
    }
  });

  it('el quinto humano es rechazado', () => {
    const net = setup(3);
    let reason = '';
    const c = addClient(net, 'Sobra');
    c.listeners.onClose = (r) => (reason = r);
    flushAll(net);
    expect(net.host.players).toHaveLength(4);
    expect(c.status).toBe('closed');
    expect(c.rejectReason).toMatch(/llena/);
    expect(reason === '' || /llena/.test(reason)).toBe(true);
  });

  it('versión distinta es rechazada', () => {
    const host = new HostSession('H', 'rana');
    const { a, b, flush } = memoryPair();
    host.addConnection(a);
    const got: unknown[] = [];
    b.onMessage((m) => got.push(m));
    b.send({ t: 'hello', v: 999, name: 'Viejo', char: 'rana' });
    flush();
    expect(host.players).toHaveLength(1);
    expect(got[0]).toMatchObject({ t: 'reject' });
  });

  it('los ajustes llegan a los clientes y se acotan', () => {
    const net = setup(1);
    net.host.updateSettings({ trackId: 'ocho', laps: 9, bots: 10 });
    flushAll(net);
    expect(net.clients[0].lobby?.settings).toEqual({ trackId: 'ocho', laps: 5, bots: 4 });
  });

  it('cambiar de nombre en la sala se propaga', () => {
    const net = setup(1);
    net.clients[0].setProfile('Nuevo', 'dino');
    flushAll(net);
    expect(net.host.players[1]).toMatchObject({ name: 'Nuevo', char: 'dino' });
  });

  it('los mensajes basura no rompen al anfitrión', () => {
    const host = new HostSession('H', 'rana');
    const { a, b, flush } = memoryPair();
    host.addConnection(a);
    for (const junk of [null, 1, 'x', { t: 'in', q: 1 }, { t: 'hello' }, [1, 2]]) b.send(junk);
    expect(() => flush()).not.toThrow();
    expect(host.players).toHaveLength(1);
  });
});

describe('carrera en red', () => {
  it('empezar carrera crea el mundo en todos con los mismos karts', () => {
    const net = setup(2, 2);
    net.host.startRace(42);
    flushAll(net);
    expect(net.host.world!.karts).toHaveLength(5);
    for (const c of net.clients) {
      expect(c.status).toBe('race');
      expect(c.world!.karts.map((k) => k.id).sort()).toEqual(net.host.world!.karts.map((k) => k.id).sort());
    }
  });

  it('el cliente se mueve y el anfitrión lo ve (sin latencia)', () => {
    const net = setup(1);
    net.host.startRace(1);
    flushAll(net);
    const id = net.clients[0].myId;
    simulate(net, 3.2); // cuenta atrás
    const hk0 = net.host.world!.karts.find((k) => k.id === id)!;
    const x0 = hk0.x;
    const y0 = hk0.y;
    simulate(net, 1.5, new Map([[id, GAS]]));
    const hk = net.host.world!.karts.find((k) => k.id === id)!;
    expect(Math.hypot(hk.x - x0, hk.y - y0)).toBeGreaterThan(200);
    // y la predicción del cliente coincide con la autoridad
    const ck = net.clients[0].world!.karts.find((k) => k.id === id)!;
    expect(Math.hypot(ck.x - hk.x, ck.y - hk.y)).toBeLessThan(15);
  });

  it('con latencia la predicción sigue cerca de la autoridad', () => {
    const net = setup(1);
    net.host.startRace(1);
    flushAll(net);
    const id = net.clients[0].myId;
    simulate(net, 3.2, new Map(), 6);
    const frames = new Map([[id, { ...GAS, steer: 0.2 }]]);
    simulate(net, 2, frames, 6); // 100ms de "lag"
    const hk = net.host.world!.karts.find((k) => k.id === id)!;
    const ck = net.clients[0].world!.karts.find((k) => k.id === id)!;
    // El cliente va por delante del anfitrión como mucho lo que da la latencia
    expect(Math.hypot(ck.x - hk.x, ck.y - hk.y)).toBeLessThan(PHYS.maxSpeed * 0.12 + 20);
  });

  it('las pulsaciones de objeto llegan aunque duren un solo tick', () => {
    const net = setup(1);
    net.host.startRace(1);
    flushAll(net);
    const id = net.clients[0].myId;
    simulate(net, 3.2);
    const hk = net.host.world!.karts.find((k) => k.id === id)!;
    hk.item = 'croqueta';
    hk.itemRoll = 0;
    // un único tick con el contador incrementado
    net.clients[0].update(TICK, { ...EMPTY_FRAME, itemCount: 1 });
    simulate(net, 0.2, new Map([[id, { ...EMPTY_FRAME, itemCount: 1 }]]));
    expect(hk.item).toBeNull();
    expect(hk.boost).toBeGreaterThan(0);
  });

  it('los eventos llegan a los clientes', () => {
    const net = setup(1);
    const got: string[] = [];
    net.clients[0].listeners.onEvents = (ev) => got.push(...ev.map((e) => e.type));
    net.host.startRace(1);
    flushAll(net);
    simulate(net, 3.5);
    expect(got).toContain('go');
  });

  it('si un cliente se va a mitad de carrera, un bot coge su kart', () => {
    const net = setup(1);
    const msgs: string[] = [];
    net.host.listeners.onMessage = (m) => msgs.push(m);
    net.host.startRace(1);
    flushAll(net);
    const id = net.clients[0].myId;
    net.links[0].b.close();
    expect(net.host.players).toHaveLength(1);
    expect(net.host.world!.karts.find((k) => k.id === id)!.bot).toBe(true);
    expect(msgs.some((m) => m.includes('bot'))).toBe(true);
  });

  it('quien entra a mitad de carrera la ve como espectador', () => {
    const net = setup(0, 1);
    net.host.startRace(1);
    simulate(net, 1);
    const late = addClient(net, 'Tarde');
    simulate(net, 0.5);
    expect(late.status).toBe('race');
    expect(late.world).not.toBeNull();
    expect(late.world!.karts.some((k) => k.id === late.myId)).toBe(false);
  });

  it('volver a la sala limpia el mundo en los clientes', () => {
    const net = setup(1);
    net.host.startRace(1);
    flushAll(net);
    net.host.backToLobby();
    flushAll(net);
    expect(net.clients[0].world).toBeNull();
    expect(net.clients[0].status).toBe('lobby');
  });

  it('el cliente se entera si el anfitrión se cae', () => {
    const net = setup(1);
    let reason = '';
    net.clients[0].listeners.onClose = (r) => (reason = r);
    net.links[0].a.close();
    expect(net.clients[0].status).toBe('closed');
    expect(reason).toMatch(/conexión/);
  });

  it('carrera completa en red con bots acaba y todos ven el final', () => {
    const net = setup(1, 2);
    net.host.startRace(5);
    flushAll(net);
    // Los humanos no tocan nada: la carrera tiene que cerrarse por el temporizador cuando ganen los bots.
    simulate(net, 90);
    expect(net.host.world!.phase).toBe('finished');
    expect(net.clients[0].world!.phase).toBe('finished');
  });
});
