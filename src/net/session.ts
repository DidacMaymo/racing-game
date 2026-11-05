import { BOT_NAMES, CHARACTERS } from '../game/characters';
import { stepKart } from '../game/kart';
import { createWorld, drainEvents, randomSeed, stepWorld, WorldExt } from '../game/race';
import type { GameEvent, Input, RaceConfig, RacePlayer } from '../game/types';
import {
  applyKart,
  applySnapshot,
  clampSettings,
  encodeInput,
  encodeSnapshot,
  LobbyMsg,
  LobbyPlayer,
  LobbySettings,
  MAX_HUMANS,
  parseClientMsg,
  parseHostMsg,
  PROTOCOL_VERSION,
  SnapMsg,
} from './protocol';
import type { Transport } from './transport';

export const TICK = 1 / 60;
export const SNAP_EVERY = 3;

/** Estado de los mandos tal como lo produce la interfaz. */
export interface InputFrame {
  steer: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  itemCount: number;
  honkCount: number;
}

export const EMPTY_FRAME: InputFrame = { steer: 0, throttle: false, brake: false, drift: false, itemCount: 0, honkCount: 0 };

export interface SessionListeners {
  onEvents?: (events: GameEvent[]) => void;
  onChange?: () => void;
  onMessage?: (text: string) => void;
  onClose?: (reason: string) => void;
}

/** Interfaz común que consume la UI, sea anfitrión o cliente. */
export interface Session {
  readonly isHost: boolean;
  readonly myId: number;
  readonly world: WorldExt | null;
  readonly lobby: { players: LobbyPlayer[]; settings: LobbySettings } | null;
  /** Desfase visual por kart para suavizar correcciones de red. */
  readonly offsets: ReadonlyMap<number, { x: number; y: number }>;
  listeners: SessionListeners;
  update(dt: number, frame: InputFrame): void;
  setProfile(name: string, char: string): void;
  close(): void;
}

function frameToInput(f: InputFrame, prevItem: number, prevHonk: number): Input {
  return {
    steer: Math.max(-1, Math.min(1, f.steer)),
    throttle: f.throttle,
    brake: f.brake,
    drift: f.drift,
    item: f.itemCount !== prevItem,
    honk: f.honkCount !== prevHonk,
  };
}

interface HostPlayer {
  id: number;
  name: string;
  char: string;
  conn: Transport | null;
  frame: InputFrame;
  seq: number;
  lastItem: number;
  lastHonk: number;
}

// =====================================================================
// ANFITRIÓN: simula la carrera de verdad y manda snapshots.
// =====================================================================
export class HostSession implements Session {
  readonly isHost = true;
  readonly myId = 0;
  players: HostPlayer[] = [];
  settings: LobbySettings;
  world: WorldExt | null = null;
  listeners: SessionListeners = {};
  readonly offsets = new Map<number, { x: number; y: number }>();
  private acc = 0;
  private nextId = 1;
  private ticksSinceSnap = 0;
  private pendingEvents: GameEvent[] = [];

  constructor(name: string, char: string, settings: Partial<LobbySettings> = {}) {
    this.players.push(this.makePlayer(0, name, char, null));
    this.settings = clampSettings({ laps: 3, bots: 2, ...settings }, 1);
  }

  get lobby() {
    return { players: this.lobbyPlayers(), settings: this.settings };
  }

  private makePlayer(id: number, name: string, char: string, conn: Transport | null): HostPlayer {
    return { id, name, char, conn, frame: { ...EMPTY_FRAME }, seq: 0, lastItem: 0, lastHonk: 0 };
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.players.map((p) => ({ id: p.id, name: p.name, char: p.char }));
  }

  private lobbyMsg(): LobbyMsg {
    return { t: 'lobby', players: this.lobbyPlayers(), settings: this.settings, racing: this.world !== null };
  }

  private broadcast(msg: unknown) {
    for (const p of this.players) p.conn?.send(msg);
  }

  private announce(text: string) {
    this.broadcast({ t: 'msg', text });
    this.listeners.onMessage?.(text);
  }

  private changed() {
    this.listeners.onChange?.();
  }

  addConnection(conn: Transport): void {
    let player: HostPlayer | null = null;
    conn.onMessage((raw) => {
      const msg = parseClientMsg(raw);
      if (!msg) return;
      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL_VERSION) {
          conn.send({ t: 'reject', reason: 'Versión distinta del juego. Recargad la página (Ctrl+F5).' });
          conn.close();
          return;
        }
        if (!player) {
          if (this.players.length >= MAX_HUMANS) {
            conn.send({ t: 'reject', reason: `Sala llena (máximo ${MAX_HUMANS}).` });
            conn.close();
            return;
          }
          player = this.makePlayer(this.nextId++, msg.name, msg.char, conn);
          this.players.push(player);
          this.settings = clampSettings(this.settings, this.players.length);
          conn.send({ t: 'welcome', id: player.id });
          if (this.world) conn.send({ t: 'start', config: this.world.config });
          this.broadcast(this.lobbyMsg());
          this.announce(this.world ? `${player.name} mira la carrera desde la grada 🍿` : `${player.name} se ha unido 👋`);
        } else if (!this.world) {
          player.name = msg.name;
          player.char = msg.char;
          this.broadcast(this.lobbyMsg());
        }
        this.changed();
      } else if (msg.t === 'in' && player) {
        if (msg.q > player.seq) {
          player.seq = msg.q;
          player.frame = {
            steer: msg.s,
            throttle: (msg.b & 1) !== 0,
            brake: (msg.b & 2) !== 0,
            drift: (msg.b & 4) !== 0,
            itemCount: msg.i,
            honkCount: msg.h,
          };
        }
      }
    });
    conn.onClose(() => {
      if (!player) return;
      const p = player;
      player = null;
      this.players = this.players.filter((pp) => pp !== p);
      const kart = this.world?.karts.find((k) => k.id === p.id);
      if (kart && kart.finishTime === null) {
        kart.bot = true;
        this.announce(`${p.name} se ha pirado. Conduce un bot en su lugar 🤖`);
      } else {
        this.announce(`${p.name} se ha ido`);
      }
      this.broadcast(this.lobbyMsg());
      this.changed();
    });
  }

  setProfile(name: string, char: string): void {
    this.players[0].name = name;
    this.players[0].char = char;
    if (!this.world) this.broadcast(this.lobbyMsg());
    this.changed();
  }

  updateSettings(s: Partial<LobbySettings>): void {
    this.settings = clampSettings({ ...this.settings, ...s }, this.players.length);
    this.broadcast(this.lobbyMsg());
    this.changed();
  }

  buildConfig(seed = randomSeed()): RaceConfig {
    const racers: RacePlayer[] = this.players.map((p) => ({ id: p.id, name: p.name, char: p.char, bot: false }));
    const used = new Set(racers.map((r) => r.char));
    const freeChars = CHARACTERS.filter((c) => !used.has(c.id));
    for (let i = 0; i < this.settings.bots; i++) {
      const ch = freeChars[(i + seed) % Math.max(1, freeChars.length)] ?? CHARACTERS[i % CHARACTERS.length];
      racers.push({ id: 100 + i, name: BOT_NAMES[(i + seed) % BOT_NAMES.length], char: ch.id, bot: true });
    }
    return { trackId: this.settings.trackId, laps: this.settings.laps, seed, players: racers };
  }

  startRace(seed?: number): void {
    const config = this.buildConfig(seed);
    this.world = createWorld(config);
    this.acc = 0;
    this.ticksSinceSnap = 0;
    this.pendingEvents = [];
    for (const p of this.players) {
      p.lastItem = p.frame.itemCount;
      p.lastHonk = p.frame.honkCount;
    }
    this.broadcast({ t: 'start', config });
    this.broadcast(this.lobbyMsg());
    this.changed();
  }

  backToLobby(): void {
    this.world = null;
    this.broadcast(this.lobbyMsg());
    this.changed();
  }

  update(dt: number, frame: InputFrame): void {
    this.players[0].frame = frame;
    if (!this.world) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick();
    }
  }

  private tick() {
    const w = this.world!;
    const inputs = new Map<number, Input>();
    for (const p of this.players) {
      inputs.set(p.id, frameToInput(p.frame, p.lastItem, p.lastHonk));
      p.lastItem = p.frame.itemCount;
      p.lastHonk = p.frame.honkCount;
    }
    const prevPhase = w.phase;
    stepWorld(w, inputs, TICK);
    const events = drainEvents(w);
    if (events.length) {
      this.pendingEvents.push(...events);
      this.listeners.onEvents?.(events);
    }
    this.ticksSinceSnap++;
    if (this.ticksSinceSnap >= SNAP_EVERY || w.phase !== prevPhase) {
      this.ticksSinceSnap = 0;
      const acks = new Map(this.players.map((p) => [p.id, p.seq]));
      this.broadcast(encodeSnapshot(w, acks, this.pendingEvents));
      this.pendingEvents = [];
    }
    if (w.phase !== prevPhase) this.changed();
  }

  close(): void {
    for (const p of this.players) p.conn?.close();
  }
}

// =====================================================================
// CLIENTE: predice su propio kart y reconcilia con el anfitrión.
// =====================================================================
export class ClientSession implements Session {
  readonly isHost = false;
  myId = -1;
  status: 'connecting' | 'lobby' | 'race' | 'closed' = 'connecting';
  lobby: LobbyMsg | null = null;
  world: WorldExt | null = null;
  listeners: SessionListeners = {};
  readonly offsets = new Map<number, { x: number; y: number }>();
  rejectReason: string | null = null;
  private seq = 0;
  private acc = 0;
  private history: { seq: number; input: Input }[] = [];

  constructor(
    private conn: Transport,
    name: string,
    char: string,
  ) {
    conn.onMessage((raw) => this.handle(raw));
    conn.onClose(() => {
      if (this.status === 'closed') return;
      this.status = 'closed';
      this.listeners.onClose?.(this.rejectReason ?? 'Se ha perdido la conexión con el anfitrión 💀');
      this.listeners.onChange?.();
    });
    conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, char });
  }

  setProfile(name: string, char: string): void {
    this.conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, char });
  }

  private handle(raw: unknown) {
    const msg = parseHostMsg(raw);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.id;
        this.listeners.onChange?.();
        break;
      case 'reject':
        this.rejectReason = msg.reason;
        break;
      case 'lobby':
        this.lobby = msg;
        if (!msg.racing) {
          this.world = null;
          this.status = 'lobby';
        } else if (this.status === 'connecting') {
          this.status = 'lobby';
        }
        this.listeners.onChange?.();
        break;
      case 'start':
        this.world = createWorld(msg.config);
        this.history = [];
        this.offsets.clear();
        this.status = 'race';
        this.listeners.onChange?.();
        break;
      case 'snap':
        this.onSnap(msg);
        break;
      case 'msg':
        this.listeners.onMessage?.(msg.text);
        break;
    }
  }

  private onSnap(snap: SnapMsg) {
    const w = this.world;
    if (!w) return;
    const prevPhase = w.phase;
    const before = new Map(w.karts.map((k) => [k.id, displayed(k, this.offsets)]));
    const { mine } = applySnapshot(w, snap, this.myId);
    const me = w.karts.find((k) => k.id === this.myId);
    if (me && mine) {
      const ack = applyKart(me, mine);
      this.history = this.history.filter((h) => h.seq > ack);
      if (me.finishTime === null && w.phase !== 'finished') {
        for (const h of this.history) stepKart(me, h.input, TICK, w.track, w.phase === 'countdown');
      }
    }
    for (const k of w.karts) {
      const b = before.get(k.id)!;
      const ox = b.x - k.x;
      const oy = b.y - k.y;
      // Correcciones pequeñas se suavizan; las grandes (teletransporte) se aplican de golpe.
      this.offsets.set(k.id, ox * ox + oy * oy < 150 * 150 ? { x: ox, y: oy } : { x: 0, y: 0 });
    }
    if (snap.ev.length) this.listeners.onEvents?.(snap.ev);
    if (w.phase !== prevPhase) this.listeners.onChange?.();
  }

  update(dt: number, frame: InputFrame): void {
    if (this.status === 'closed') return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick(frame);
    }
  }

  private tick(frame: InputFrame) {
    this.seq++;
    this.conn.send(encodeInput(this.seq, frame.steer, frame.throttle, frame.brake, frame.drift, frame.itemCount, frame.honkCount));
    const w = this.world;
    if (!w) return;
    const input = frameToInput(frame, frame.itemCount, frame.honkCount); // sin pulsaciones: los objetos los decide el anfitrión
    if (w.phase === 'countdown') w.countdown = Math.max(0, w.countdown - TICK);
    if (w.phase === 'racing') w.time += TICK;
    for (const k of w.karts) {
      const predicted = k.id === this.myId && k.finishTime === null && w.phase !== 'finished';
      if (predicted) {
        stepKart(k, input, TICK, w.track, w.phase === 'countdown');
      } else if (w.phase !== 'countdown') {
        k.x += k.vx * TICK;
        k.y += k.vy * TICK;
        if (k.spin > 0) k.angle += 13 * TICK;
      }
    }
    if (w.karts.some((k) => k.id === this.myId)) {
      this.history.push({ seq: this.seq, input });
      if (this.history.length > 180) this.history.splice(0, this.history.length - 180);
    }
    for (const p of w.projectiles) {
      p.x += p.vx * TICK;
      p.y += p.vy * TICK;
    }
    const decay = Math.exp(-12 * TICK);
    for (const o of this.offsets.values()) {
      o.x *= decay;
      o.y *= decay;
    }
  }

  close(): void {
    this.status = 'closed';
    this.conn.close();
  }
}

function displayed(k: { id: number; x: number; y: number }, offsets: ReadonlyMap<number, { x: number; y: number }>) {
  const o = offsets.get(k.id);
  return { x: k.x + (o?.x ?? 0), y: k.y + (o?.y ?? 0) };
}
