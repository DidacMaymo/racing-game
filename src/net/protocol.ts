import { isCharacterId } from '../game/characters';
import { round } from '../game/math';
import { isTrackId } from '../game/tracks';
import { ITEM_KINDS, type GameEvent, type Hazard, type ItemKind, type Kart, type Phase, type Projectile, type RaceConfig, type World } from '../game/types';

export const PROTOCOL_VERSION = 1;
export const MAX_HUMANS = 4;
export const MAX_KARTS = 6;
export const MAX_NAME = 14;

// ---------- Mensajes cliente -> anfitrión ----------

export interface HelloMsg {
  t: 'hello';
  v: number;
  name: string;
  char: string;
}

/** Entrada de un tick. Los botones de un solo uso van como contadores para que no se pierdan pulsaciones. */
export interface InputMsg {
  t: 'in';
  q: number; // seq
  s: number; // steer
  b: number; // bits: 1 gas, 2 freno, 4 derrape
  i: number; // contador de pulsaciones de objeto
  h: number; // contador de pulsaciones de claxon
}

export type ClientMsg = HelloMsg | InputMsg;

// ---------- Mensajes anfitrión -> cliente ----------

export interface LobbyPlayer {
  id: number;
  name: string;
  char: string;
}

export interface LobbySettings {
  trackId: string;
  laps: number;
  bots: number;
}

export interface WelcomeMsg {
  t: 'welcome';
  id: number;
}
export interface RejectMsg {
  t: 'reject';
  reason: string;
}
export interface LobbyMsg {
  t: 'lobby';
  players: LobbyPlayer[];
  settings: LobbySettings;
  racing: boolean;
}
export interface StartMsg {
  t: 'start';
  config: RaceConfig;
}
export interface ChatMsg {
  t: 'msg';
  text: string;
}

export type KartSnap = number[];
export type ProjSnap = [id: number, kind: number, x: number, y: number, vx: number, vy: number, owner: number, target: number, trackIdx: number];
export type HazSnap = [id: number, x: number, y: number, owner: number];

export interface SnapMsg {
  t: 'snap';
  k: number;
  ph: Phase;
  cd: number;
  tm: number;
  et: number;
  fo: number[];
  ks: KartSnap[];
  pr: ProjSnap[];
  hz: HazSnap[];
  bx: number;
  ev: GameEvent[];
}

export type HostMsg = WelcomeMsg | RejectMsg | LobbyMsg | StartMsg | SnapMsg | ChatMsg;

// ---------- Validación ----------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return 'Anónimo';
  // fuera caracteres de control y espacios repetidos
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean).slice(0, MAX_NAME).join('');
  return chars || 'Anónimo';
}

/** Valida un mensaje que llega de un cliente (no nos fiamos de nadie). */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'hello') {
    if (!isFiniteNum(raw.v)) return null;
    return { t: 'hello', v: raw.v, name: sanitizeName(raw.name), char: isCharacterId(raw.char) ? raw.char : 'rana' };
  }
  if (raw.t === 'in') {
    if (!isFiniteNum(raw.q) || !isFiniteNum(raw.s) || !isFiniteNum(raw.b) || !isFiniteNum(raw.i) || !isFiniteNum(raw.h))
      return null;
    return {
      t: 'in',
      q: Math.floor(raw.q),
      s: Math.max(-1, Math.min(1, raw.s)),
      b: Math.floor(raw.b) & 7,
      i: Math.floor(raw.i),
      h: Math.floor(raw.h),
    };
  }
  return null;
}

/** Validación ligera de lo que manda el anfitrión. */
export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'welcome':
      return isFiniteNum(raw.id) ? (raw as unknown as WelcomeMsg) : null;
    case 'reject':
      return typeof raw.reason === 'string' ? (raw as unknown as RejectMsg) : null;
    case 'lobby':
      return Array.isArray(raw.players) && isObj(raw.settings) && isTrackId(raw.settings.trackId)
        ? (raw as unknown as LobbyMsg)
        : null;
    case 'start': {
      const c = raw.config;
      return isObj(c) && isTrackId(c.trackId) && isFiniteNum(c.laps) && isFiniteNum(c.seed) && Array.isArray(c.players)
        ? (raw as unknown as StartMsg)
        : null;
    }
    case 'snap':
      return isFiniteNum(raw.k) && Array.isArray(raw.ks) && Array.isArray(raw.pr) && Array.isArray(raw.hz) && Array.isArray(raw.ev)
        ? (raw as unknown as SnapMsg)
        : null;
    case 'msg':
      return typeof raw.text === 'string' ? (raw as unknown as ChatMsg) : null;
    default:
      return null;
  }
}

// ---------- Snapshots ----------

const KART_FIELDS = 24;

export function encodeKart(k: Kart, ack: number): KartSnap {
  return [
    k.id,
    round(k.x, 2),
    round(k.y, 2),
    round(k.angle, 4),
    round(k.vx, 2),
    round(k.vy, 2),
    round(k.spin, 3),
    round(k.boost, 3),
    round(k.slow, 3),
    k.slowPhrase,
    round(k.invert, 3),
    k.driftDir,
    round(k.driftCharge, 3),
    k.item === null ? -1 : ITEM_KINDS.indexOf(k.item),
    round(k.itemRoll, 3),
    k.lap,
    round(k.s, 2),
    k.trackIdx,
    k.finishTime === null ? -1 : round(k.finishTime, 3),
    ack,
    k.stats.hitsGiven,
    k.stats.hitsTaken,
    k.stats.walls,
    k.stats.honks,
  ];
}

/** Aplica un snapshot a un kart existente. Devuelve el ack (último seq de entrada procesado). */
export function applyKart(k: Kart, s: KartSnap): number {
  if (s.length < KART_FIELDS) return 0;
  k.x = s[1];
  k.y = s[2];
  k.angle = s[3];
  k.vx = s[4];
  k.vy = s[5];
  k.spin = s[6];
  k.boost = s[7];
  k.slow = s[8];
  k.slowPhrase = s[9];
  k.invert = s[10];
  k.driftDir = s[11];
  k.driftCharge = s[12];
  k.item = s[13] >= 0 ? ((ITEM_KINDS[s[13]] as ItemKind | undefined) ?? null) : null;
  k.itemRoll = s[14];
  k.lap = s[15];
  k.s = s[16];
  k.trackIdx = s[17];
  k.finishTime = s[18] < 0 ? null : s[18];
  k.stats.hitsGiven = s[20];
  k.stats.hitsTaken = s[21];
  k.stats.walls = s[22];
  k.stats.honks = s[23];
  return s[19];
}

const PROJ_KINDS = ['chancla', 'pato'] as const;

export function encodeSnapshot(w: World, acks: ReadonlyMap<number, number>, events: GameEvent[]): SnapMsg {
  let bx = 0;
  w.boxes.forEach((b, i) => {
    if (b.respawn <= 0) bx |= 1 << i;
  });
  return {
    t: 'snap',
    k: w.tick,
    ph: w.phase,
    cd: round(w.countdown, 3),
    tm: round(w.time, 3),
    et: round(w.endTimer, 2),
    fo: w.finishOrder.slice(),
    ks: w.karts.map((k) => encodeKart(k, acks.get(k.id) ?? 0)),
    pr: w.projectiles.map(
      (p): ProjSnap => [p.id, PROJ_KINDS.indexOf(p.kind), round(p.x, 1), round(p.y, 1), round(p.vx, 1), round(p.vy, 1), p.owner, p.target, p.trackIdx],
    ),
    hz: w.hazards.map((h): HazSnap => [h.id, round(h.x, 1), round(h.y, 1), h.owner]),
    bx,
    ev: events,
  };
}

/**
 * Aplica todo el snapshot salvo el kart propio (que el cliente reconcilia aparte).
 * Devuelve el snapshot del kart propio si viene.
 */
export function applySnapshot(w: World, snap: SnapMsg, myId: number): { mine: KartSnap | null } {
  w.tick = snap.k;
  w.phase = snap.ph;
  w.countdown = snap.cd;
  w.time = snap.tm;
  w.endTimer = snap.et;
  w.finishOrder = snap.fo.slice();
  let mine: KartSnap | null = null;
  for (const ks of snap.ks) {
    const k = w.karts.find((kk) => kk.id === ks[0]);
    if (!k) continue;
    if (ks[0] === myId) mine = ks;
    else applyKart(k, ks);
  }
  w.projectiles = snap.pr.map(
    (p): Projectile => ({
      id: p[0],
      kind: PROJ_KINDS[p[1]] ?? 'chancla',
      x: p[2],
      y: p[3],
      vx: p[4],
      vy: p[5],
      owner: p[6],
      target: p[7],
      age: 1,
      bounces: 0,
      trackIdx: p[8],
    }),
  );
  w.hazards = snap.hz.map((h): Hazard => ({ id: h[0], kind: 'platano', x: h[1], y: h[2], owner: h[3], age: 10 }));
  w.boxes.forEach((b, i) => {
    b.respawn = snap.bx & (1 << i) ? 0 : 1;
  });
  return { mine };
}

export function encodeInput(seq: number, steer: number, throttle: boolean, brake: boolean, drift: boolean, itemCount: number, honkCount: number): InputMsg {
  return {
    t: 'in',
    q: seq,
    s: round(steer, 2),
    b: (throttle ? 1 : 0) | (brake ? 2 : 0) | (drift ? 4 : 0),
    i: itemCount,
    h: honkCount,
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(code: string): string | null {
  const c = code.toUpperCase().replace(/[^A-Z]/g, '');
  if (c.length !== 4) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export function peerIdForRoom(code: string): string {
  return `chancla-kart-v${PROTOCOL_VERSION}-${code}`;
}

export function clampSettings(s: Partial<LobbySettings>, humans: number): LobbySettings {
  const trackId = isTrackId(s.trackId) ? s.trackId : 'rotonda';
  const laps = Math.max(1, Math.min(5, Math.floor(Number(s.laps) || 3)));
  const maxBots = Math.max(0, MAX_KARTS - humans);
  const bots = Math.max(0, Math.min(maxBots, Math.floor(Number(s.bots) || 0)));
  return { trackId, laps, bots };
}
