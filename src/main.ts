import { Sfx } from './client/audio';
import { Controls } from './client/input';
import { formatTime, Renderer } from './client/render';
import { computeAwards } from './game/awards';
import { CHARACTERS, getCharacter } from './game/characters';
import { commentFor } from './game/commentary';
import { ITEMS } from './game/items';
import { makeRng } from './game/math';
import { ranking } from './game/race';
import { TRACK_DEFS, getTrack } from './game/tracks';
import { ITEM_KINDS, type GameEvent, type World } from './game/types';
import { hostRoom, joinRoom, type HostedRoom } from './net/peer';
import { MAX_KARTS, normalizeRoomCode, sanitizeName } from './net/protocol';
import { ClientSession, HostSession, type Session } from './net/session';

// ---------- utilidades DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} no encontrado`);
  return el as T;
};
const show = (id: string, v: boolean) => {
  $(id).hidden = !v;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* modo privado */
  }
  return null;
}

let toastTimer = 0;
function toast(text: string, ms = 2500) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

// ---------- estado global ----------
const canvas = $<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const controls = new Controls();
const sfx = new Sfx();
const commentRng = makeRng(Date.now() >>> 0);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
controls.touchMode = isTouch;

let session: Session | null = null;
let room: HostedRoom | null = null;
let clientPeer: { destroy(): void } | null = null;
let profile = {
  name: sanitizeName(store('ck-name') ?? ''),
  char: store('ck-char') ?? CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id,
};
if (profile.name === 'Anónimo') profile.name = '';
let lastWorld: World | null = null;
let lastCountdownBeep = -1;
let resultsShownFor: World | null = null;

// ---------- menú ----------
const nameInput = $<HTMLInputElement>('name');
nameInput.value = profile.name;
nameInput.addEventListener('input', () => {
  profile.name = nameInput.value;
  store('ck-name', nameInput.value);
});

function renderChars() {
  const box = $('chars');
  box.innerHTML = '';
  for (const c of CHARACTERS) {
    const b = document.createElement('button');
    b.className = `char${c.id === profile.char ? ' sel' : ''}`;
    b.innerHTML = `<b>${c.emoji}</b>${esc(c.name)}`;
    b.style.background = c.id === profile.char ? `${c.color}44` : '';
    b.onclick = () => {
      profile.char = c.id;
      store('ck-char', c.id);
      sfx.unlock();
      sfx.honk(c.honk);
      renderChars();
      session?.setProfile(playerName(), profile.char);
    };
    box.appendChild(b);
  }
}
renderChars();

$('items-help').innerHTML = ITEM_KINDS.map((k) => `<li>${ITEMS[k].emoji} <b>${ITEMS[k].name}</b>: ${esc(ITEMS[k].desc)}</li>`).join('');

const codeInput = $<HTMLInputElement>('code');
const urlCode = new URLSearchParams(location.search).get('sala');
if (urlCode) codeInput.value = normalizeRoomCode(urlCode) ?? '';
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});

/** Reescribe ?sala= conservando otros parámetros (p.ej. ?peer= para pruebas). */
function setRoomInUrl(code: string | null) {
  const params = new URLSearchParams(location.search);
  if (code) params.set('sala', code);
  else params.delete('sala');
  const q = params.toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

function playerName() {
  const n = sanitizeName(profile.name);
  return n === 'Anónimo' ? `${getCharacter(profile.char).name}` : n;
}

function menuError(msg: string | null) {
  const el = $('menu-error');
  el.textContent = msg ?? '';
  el.hidden = !msg;
}

function setBusy(busy: boolean) {
  for (const id of ['btn-host', 'btn-join', 'btn-solo']) $<HTMLButtonElement>(id).disabled = busy;
}

$('btn-host').onclick = async () => {
  sfx.unlock();
  menuError(null);
  setBusy(true);
  try {
    const host = new HostSession(playerName(), profile.char, { bots: 0, laps: 3 });
    room = await hostRoom((t) => host.addConnection(t));
    setRoomInUrl(room.code);
    attachSession(host);
  } catch (e) {
    menuError(`${(e as Error).message} Mientras tanto puedes practicar contra bots.`);
  } finally {
    setBusy(false);
  }
};

$('btn-join').onclick = async () => {
  sfx.unlock();
  menuError(null);
  const code = normalizeRoomCode(codeInput.value);
  if (!code) {
    menuError('El código son 4 letras, máquina.');
    return;
  }
  setBusy(true);
  try {
    const { transport, peer } = await joinRoom(code);
    clientPeer = peer;
    setRoomInUrl(code);
    attachSession(new ClientSession(transport, playerName(), profile.char));
  } catch (e) {
    menuError((e as Error).message);
  } finally {
    setBusy(false);
  }
};

$('btn-solo').onclick = () => {
  sfx.unlock();
  menuError(null);
  attachSession(new HostSession(playerName(), profile.char, { bots: 3, laps: 3 }));
};

// ---------- sala ----------
function trackThumb(id: string): HTMLCanvasElement {
  const t = getTrack(id);
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 110;
  const g = c.getContext('2d')!;
  const b = t.bounds;
  const s = Math.min(150 / (b.maxX - b.minX), 100 / (b.maxY - b.minY));
  g.fillStyle = t.def.grass;
  g.fillRect(0, 0, 160, 110);
  g.translate(80 - ((b.minX + b.maxX) / 2) * s, 55 - ((b.minY + b.maxY) / 2) * s);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(t.xs[0], t.ys[0]);
  for (let i = 1; i < t.xs.length; i++) g.lineTo(t.xs[i], t.ys[i]);
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = '#fff';
  g.lineWidth = t.halfWidth * 2 + 30;
  g.stroke();
  g.strokeStyle = '#555';
  g.lineWidth = t.halfWidth * 2;
  g.stroke();
  return c;
}
const thumbs = new Map(TRACK_DEFS.map((d) => [d.id, trackThumb(d.id)]));

function renderLobby() {
  const s = session;
  if (!s || !s.lobby) return;
  const { players, settings } = s.lobby;
  const host = s instanceof HostSession ? s : null;
  const solo = !!host && !room;

  show('room-box', !solo);
  show('room-solo', solo);
  if (room) $('room-code').textContent = room.code;
  else if (!host && s instanceof ClientSession) $('room-code').textContent = normalizeRoomCode(new URLSearchParams(location.search).get('sala') ?? '') ?? '????';

  const list = $('players');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    const ch = getCharacter(p.char);
    li.innerHTML = `<b>${ch.emoji}</b>${esc(p.name)}${p.id === s.myId ? ' (tú)' : ''}<span class="tag">${i === 0 ? '👑 anfitrión' : ''}</span>`;
    li.style.borderLeft = `6px solid ${ch.color}`;
    list.appendChild(li);
  });
  for (let i = 0; i < settings.bots; i++) {
    const li = document.createElement('li');
    li.className = 'bot';
    li.innerHTML = `<b>🤖</b>Bot ${i + 1}`;
    list.appendChild(li);
  }

  const tracks = $('tracks');
  tracks.innerHTML = '';
  for (const d of TRACK_DEFS) {
    const b = document.createElement('button');
    b.className = `track${d.id === settings.trackId ? ' sel' : ''}`;
    b.disabled = !host;
    b.appendChild(thumbs.get(d.id)!);
    b.insertAdjacentHTML('beforeend', `<b>${esc(d.name)}</b><small>${esc(d.subtitle)}</small>`);
    b.onclick = () => host?.updateSettings({ trackId: d.id });
    tracks.appendChild(b);
  }

  const laps = $<HTMLSelectElement>('laps');
  laps.innerHTML = [1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('');
  laps.value = String(settings.laps);
  laps.disabled = !host;
  laps.onchange = () => host?.updateSettings({ laps: Number(laps.value) });

  const bots = $<HTMLSelectElement>('bots');
  const maxBots = Math.max(0, MAX_KARTS - players.length);
  bots.innerHTML = Array.from({ length: maxBots + 1 }, (_, n) => `<option value="${n}">${n}</option>`).join('');
  bots.value = String(Math.min(settings.bots, maxBots));
  bots.disabled = !host;
  bots.onchange = () => host?.updateSettings({ bots: Number(bots.value) });

  show('btn-start', !!host);
  show('wait-host', !host);
}

$('btn-start').onclick = () => {
  sfx.unlock();
  if (session instanceof HostSession) session.startRace();
};

$('btn-copy').onclick = async () => {
  const url = location.href;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: 'Chancla Kart', text: '¡Vente a una carrera!', url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado. Pégalo en el grupo 📲');
    }
  } catch {
    toast(url, 6000);
  }
};

$('btn-leave').onclick = () => leave();
$('btn-exit').onclick = () => {
  if (confirm('¿Seguro que quieres abandonar? Los demás se reirán de ti.')) leave();
};
$('btn-mute').onclick = () => {
  $('btn-mute').textContent = sfx.toggleMute() ? '🔇' : '🔊';
};
$('btn-mute').textContent = sfx.muted ? '🔇' : '🔊';

$('btn-again').onclick = () => {
  if (session instanceof HostSession) session.startRace();
};
$('btn-to-lobby').onclick = () => {
  if (session instanceof HostSession) session.backToLobby();
};

// ---------- controles táctiles ----------
for (const btn of document.querySelectorAll<HTMLButtonElement>('#touch button')) {
  const key = btn.dataset.touch!;
  const down = (e: Event) => {
    e.preventDefault();
    btn.classList.add('on');
    sfx.unlock();
    if (key === 'item') controls.pressItem();
    else if (key === 'honk') controls.pressHonk();
    else controls.setTouch(key as 'left' | 'right' | 'brake' | 'drift', true);
  };
  const up = (e: Event) => {
    e.preventDefault();
    btn.classList.remove('on');
    if (key === 'left' || key === 'right' || key === 'brake' || key === 'drift') controls.setTouch(key, false);
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
}

// ---------- sesión ----------
function attachSession(s: Session) {
  session = s;
  s.listeners = {
    onChange: () => updateScreens(),
    onEvents: (ev) => handleEvents(ev),
    onMessage: (text) => {
      renderer.addFeed(text);
      if (!s.world) toast(text);
    },
    onClose: (reason) => {
      leave();
      menuError(reason);
    },
  };
  updateScreens();
}

function leave() {
  const s = session;
  session = null;
  s?.close();
  room?.destroy();
  room = null;
  clientPeer?.destroy();
  clientPeer = null;
  lastWorld = null;
  setRoomInUrl(null);
  sfx.setEngine(null);
  updateScreens();
}

function updateScreens() {
  const s = session;
  const world = s?.world ?? null;
  const inRace = !!world;
  if (world !== lastWorld) {
    renderer.reset();
    lastWorld = world;
    lastCountdownBeep = -1;
    resultsShownFor = null;
  }
  show('menu', !s);
  show('lobby', !!s && !inRace && !!s.lobby);
  show('hud', inRace);
  $('hud').classList.toggle('top', isTouch);
  show('touch', inRace && isTouch && !!world?.karts.some((k) => k.id === s?.myId));
  controls.enabled = inRace;
  if (s && !inRace) renderLobby();
  if (!inRace) {
    show('results', false);
    sfx.setEngine(null);
  }
  if (s && !inRace && !s.lobby) {
    // conectando…
    show('lobby', false);
  }
}

function nameOf(id: number): string {
  return lastWorld?.karts.find((k) => k.id === id)?.name ?? '¿?';
}

function handleEvents(events: GameEvent[]) {
  const s = session;
  const w = s?.world;
  if (!s || !w) return;
  const me = s.myId;
  renderer.onEvents(events, w, me);
  for (const e of events) {
    const text = commentFor(e, nameOf, commentRng, me, w.config.laps);
    if (text) renderer.addFeed(text);
    switch (e.type) {
      case 'honk': {
        const k = w.karts.find((kk) => kk.id === e.kart);
        if (k) sfx.honk(getCharacter(k.char).honk);
        break;
      }
      case 'hit':
        if (e.victim === me) sfx.splat();
        else if (e.by === me) sfx.boing();
        if (e.item === 'pato') sfx.cuac();
        break;
      case 'use':
        if (e.item === 'pato') sfx.cuac();
        if (e.item === 'cunado') sfx.bla();
        if (e.item === 'resaca') sfx.hic();
        if (e.item === 'croqueta' && e.kart === me) sfx.whoosh();
        break;
      case 'pickup':
        if (e.kart === me) sfx.pickup();
        break;
      case 'miniturbo':
      case 'startboost':
        if (e.kart === me) sfx.whoosh();
        break;
      case 'wall':
        if (e.kart === me) sfx.thud();
        break;
      case 'bump':
        if (e.a === me || e.b === me) sfx.thud();
        break;
      case 'stall':
        if (e.kart === me) sfx.sad();
        break;
      case 'go':
        sfx.beep(true);
        break;
      case 'finish':
        if (e.kart === me) {
          if (e.place === 1) sfx.fanfare();
          else if (e.place === w.karts.length) sfx.sad();
          else sfx.fanfare();
        }
        break;
    }
  }
}

function showResults(w: World) {
  const s = session!;
  const order = ranking(w);
  const ol = $('standings');
  ol.innerHTML = '';
  order.forEach((id, i) => {
    const k = w.karts.find((kk) => kk.id === id)!;
    const ch = getCharacter(k.char);
    const li = document.createElement('li');
    if (id === s.myId) li.className = 'me';
    const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}º`;
    li.innerHTML = `<span class="pos">${medal}</span><span class="who">${ch.emoji}</span>${esc(k.name)}${k.bot ? ' 🤖' : ''}<span class="time">${k.finishTime !== null ? formatTime(k.finishTime) : 'DNF 🐌'}</span>`;
    ol.appendChild(li);
  });
  const awards = computeAwards(w);
  $('awards').innerHTML = awards.map((a) => `<div>${a.emoji} <b>${esc(a.title)}</b>: ${esc(nameOf(a.kart))} (${a.value})</div>`).join('');
  const host = s instanceof HostSession;
  show('btn-again', host);
  show('btn-to-lobby', host);
  show('wait-host-2', !host);
  show('results', true);
}

// ---------- bucle principal ----------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = session;
  if (s) {
    controls.autoThrottle = s.world?.phase !== 'countdown';
    s.update(dt, controls.read());
    const w = s.world;
    if (w) {
      if (w !== lastWorld) updateScreens();
      renderer.draw({ world: w, myId: s.myId, offsets: s.offsets, touch: isTouch }, dt);
      const me = w.karts.find((k) => k.id === s.myId);
      sfx.setEngine(me ? Math.min(1.4, Math.hypot(me.vx, me.vy) / 430) : null);
      if (w.phase === 'countdown') {
        const n = Math.ceil(w.countdown);
        if (n !== lastCountdownBeep && n > 0 && n <= 3) {
          lastCountdownBeep = n;
          sfx.beep(false);
        }
      }
      if (w.phase === 'finished' && resultsShownFor !== w) {
        resultsShownFor = w;
        setTimeout(() => {
          if (session?.world === w) showResults(w);
        }, 1500);
      }
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('beforeunload', () => {
  room?.destroy();
  clientPeer?.destroy();
});
// Evita el zoom por doble toque en iOS durante la partida
document.addEventListener('dblclick', (e) => e.preventDefault());
