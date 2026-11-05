import { getCharacter } from '../game/characters';
import { CUNADO_PHRASES, ITEMS } from '../game/items';
import { speedOf } from '../game/kart';
import { ranking } from '../game/race';
import { pointAt, projectOnTrack, Track } from '../game/track';
import { ITEM_KINDS, type GameEvent, type Kart, type World } from '../game/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color?: string;
  size: number;
  text?: string;
}

interface Bubble {
  kart: number;
  text: string;
  ttl: number;
}

export interface RenderView {
  world: World;
  myId: number;
  offsets: ReadonlyMap<number, { x: number; y: number }>;
  touch: boolean;
}

const ORDINAL = (n: number) => `${n}º`;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam = { x: 0, y: 0, zoom: 1, init: false };
  private trackPaths = new Map<string, Path2D>();
  private grass: CanvasPattern | null = null;
  private grassFor = '';
  private particles: Particle[] = [];
  private skids: { x: number; y: number; life: number }[] = [];
  private feed: { text: string; ttl: number }[] = [];
  private bubbles: Bubble[] = [];
  private shake = 0;
  private wrongWay = 0;
  private time = 0;
  private dt = 1 / 60;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  reset() {
    this.particles = [];
    this.skids = [];
    this.feed = [];
    this.bubbles = [];
    this.cam.init = false;
    this.wrongWay = 0;
  }

  addFeed(text: string) {
    this.feed.unshift({ text, ttl: 4 });
    if (this.feed.length > 5) this.feed.length = 5;
  }

  /** Efectos visuales de los eventos de juego. */
  onEvents(events: GameEvent[], world: World, myId: number) {
    for (const e of events) {
      const kartId = 'kart' in e ? e.kart : e.type === 'hit' ? e.victim : -1;
      const k = world.karts.find((kk) => kk.id === kartId);
      switch (e.type) {
        case 'honk':
          if (k) this.bubbles.push({ kart: k.id, text: pickHonk(k.id + world.tick), ttl: 0.8 });
          break;
        case 'hit':
          if (k) {
            this.burst(k.x, k.y, e.item === 'pato' ? '🦆' : e.item === 'chancla' ? '🩴' : '🍌', 6);
            this.burst(k.x, k.y, '💥', 1, 0);
            if (k.id === myId) this.shake = 0.4;
          }
          break;
        case 'wall':
          if (k?.id === myId) this.shake = Math.max(this.shake, 0.15);
          if (k) this.burst(k.x, k.y, '💢', 1, 30);
          break;
        case 'use':
          if (e.item === 'resaca' && k) this.burst(k.x, k.y, '🍺', 6);
          if (e.item === 'croqueta' && k) this.burst(k.x, k.y, '🥘', 3);
          break;
        case 'miniturbo':
          if (k) this.burst(k.x, k.y, e.level === 2 ? '🔥' : '✨', 3);
          break;
        case 'stall':
          if (k) this.bubbles.push({ kart: k.id, text: '¡Se me ha calao! 🤬', ttl: 1.8 });
          break;
        case 'finish':
          if (k) this.burst(k.x, k.y, e.place === 1 ? '🏆' : '🏁', 8);
          break;
        case 'bump':
          {
            const a = world.karts.find((kk) => kk.id === e.a);
            if (a) this.burst(a.x, a.y, '💫', 1, 20);
          }
          break;
      }
    }
  }

  private burst(x: number, y: number, text: string, n: number, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 1, max: 1, size: 22 + Math.random() * 10, text });
    }
  }

  private pathFor(track: Track): Path2D {
    let p = this.trackPaths.get(track.def.id);
    if (!p) {
      p = new Path2D();
      p.moveTo(track.xs[0], track.ys[0]);
      for (let i = 1; i < track.xs.length; i++) p.lineTo(track.xs[i], track.ys[i]);
      p.closePath();
      this.trackPaths.set(track.def.id, p);
    }
    return p;
  }

  private grassPattern(track: Track): CanvasPattern | null {
    if (this.grassFor === track.def.id) return this.grass;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = track.def.grass;
    g.fillRect(0, 0, 128, 128);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)';
      g.fillRect(rnd() * 128, rnd() * 128, 3 + rnd() * 5, 2 + rnd() * 3);
    }
    this.grass = this.ctx.createPattern(c, 'repeat');
    this.grassFor = track.def.id;
    return this.grass;
  }

  draw(view: RenderView, dt: number) {
    const { world, myId, offsets } = view;
    const ctx = this.ctx;
    const track = world.track;
    this.time += dt;
    this.dt = dt;

    const me = world.karts.find((k) => k.id === myId);
    const rank = ranking(world);
    const focus = me ?? world.karts.find((k) => k.id === rank[0]) ?? world.karts[0];
    const pos = (k: Kart) => {
      const o = offsets.get(k.id);
      return { x: k.x + (o?.x ?? 0), y: k.y + (o?.y ?? 0) };
    };

    // --- cámara ---
    const fp = focus ? pos(focus) : { x: 0, y: 0 };
    const sp = focus ? speedOf(focus) : 0;
    const baseZoom = Math.max(0.45, Math.min(1.3, Math.min(this.w, this.h) / 620));
    const targetZoom = baseZoom * (1.05 - Math.min(sp / 430, 1.4) * 0.18);
    // mirar un poco hacia delante
    const lookX = focus ? focus.vx * 0.35 : 0;
    const lookY = focus ? focus.vy * 0.35 : 0;
    if (!this.cam.init) {
      this.cam = { x: fp.x, y: fp.y, zoom: targetZoom, init: true };
    }
    const k = 1 - Math.exp(-8 * dt);
    this.cam.x += (fp.x + lookX - this.cam.x) * k;
    this.cam.y += (fp.y + lookY - this.cam.y) * k;
    this.cam.zoom += (targetZoom - this.cam.zoom) * (1 - Math.exp(-2 * dt));
    this.shake = Math.max(0, this.shake - dt);
    const shx = this.shake > 0 ? (Math.random() - 0.5) * 16 * this.shake : 0;
    const shy = this.shake > 0 ? (Math.random() - 0.5) * 16 * this.shake : 0;

    const z = this.cam.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = track.def.grass;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.w / 2 - this.cam.x * z + shx), this.dpr * (this.h / 2 - this.cam.y * z + shy));

    const vx0 = this.cam.x - this.w / 2 / z - 100;
    const vy0 = this.cam.y - this.h / 2 / z - 100;
    const vx1 = this.cam.x + this.w / 2 / z + 100;
    const vy1 = this.cam.y + this.h / 2 / z + 100;
    const visible = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    const pat = this.grassPattern(track);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    }

    // --- pista ---
    const path = this.pathFor(track);
    const hw = track.halfWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3b2f2f';
    ctx.lineWidth = 2 * (hw + track.wallMargin) + 16;
    ctx.stroke(path);
    ctx.strokeStyle = '#eeeeee';
    ctx.setLineDash([24, 24]);
    ctx.lineWidth = 2 * (hw + track.wallMargin) + 8;
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.strokeStyle = track.def.verge;
    ctx.lineWidth = 2 * (hw + track.wallMargin);
    ctx.stroke(path);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * hw + 16;
    ctx.stroke(path);
    ctx.strokeStyle = '#e03131';
    ctx.setLineDash([28, 28]);
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#5a5a63';
    ctx.lineWidth = 2 * hw;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 4;
    ctx.setLineDash([40, 40]);
    ctx.stroke(path);
    ctx.setLineDash([]);

    // flechas de dirección pintadas en el suelo
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let s = 300; s < track.length; s += 700) {
      const p = pointAt(track, s);
      if (!visible(p.x, p.y)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.ty, p.tx));
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.lineTo(-10, -26);
      ctx.lineTo(-10, 26);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // meta
    {
      const p = pointAt(track, 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.ty, p.tx));
      const sq = 12;
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < Math.ceil((2 * hw) / sq); i++) {
          ctx.fillStyle = (i + row) % 2 === 0 ? '#111' : '#fff';
          ctx.fillRect(-sq + row * sq, -hw + i * sq, sq, Math.min(sq, 2 * hw - i * sq));
        }
      }
      ctx.restore();
    }

    // decoración
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; // los emojis heredan el alfa del fillStyle
    for (const d of track.decorations) {
      if (!visible(d.x, d.y)) continue;
      ctx.font = `${d.size}px sans-serif`;
      ctx.fillText(d.emoji, d.x, d.y);
    }

    // marcas de derrape
    ctx.fillStyle = 'rgba(20,20,20,0.35)';
    for (const s of this.skids) {
      s.life -= dt;
      if (!visible(s.x, s.y)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, s.life / 2));
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    this.skids = this.skids.filter((s) => s.life > 0);

    // cajas
    world.boxes.forEach((b, i) => {
      if (b.respawn > 0 || !visible(b.x, b.y)) return;
      ctx.save();
      ctx.translate(b.x, b.y + Math.sin(this.time * 3 + i) * 3);
      ctx.rotate(this.time * 1.5 + i);
      const hue = (this.time * 120 + i * 40) % 360;
      ctx.fillStyle = `hsla(${hue},90%,60%,0.85)`;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      roundRect(ctx, -15, -15, 30, 30, 6);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-(this.time * 1.5 + i));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('?', 0, 1);
      ctx.restore();
    });

    // plátanos
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#000';
    for (const hz of world.hazards) if (visible(hz.x, hz.y)) ctx.fillText('🍌', hz.x, hz.y);

    // karts
    const sorted = world.karts.slice().sort((a, b) => a.y - b.y);
    for (const kart of sorted) {
      const p = pos(kart);
      if (!visible(p.x, p.y)) continue;
      this.kartFx(kart, p.x, p.y);
      this.drawKart(kart, p.x, p.y, kart.id === myId);
    }

    // proyectiles
    for (const pr of world.projectiles) {
      if (!visible(pr.x, pr.y)) continue;
      ctx.save();
      ctx.translate(pr.x, pr.y);
      if (pr.kind === 'chancla') ctx.rotate(this.time * 20);
      else ctx.scale(pr.vx < 0 ? 1 : -1, 1);
      ctx.font = '30px sans-serif';
      ctx.fillStyle = '#000';
      ctx.fillText(pr.kind === 'chancla' ? '🩴' : '🦆', 0, 0);
      ctx.restore();
    }

    // partículas
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      if (p.text) {
        ctx.fillStyle = '#000';
        ctx.font = `${p.size}px sans-serif`;
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color ?? '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + p.life / p.max / 2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);

    // etiquetas y bocadillos
    for (const kart of world.karts) {
      const p = pos(kart);
      if (!visible(p.x, p.y)) continue;
      if (kart.id !== myId) {
        ctx.font = 'bold 13px system-ui, sans-serif';
        const label = `${ORDINAL(rank.indexOf(kart.id) + 1)} ${kart.name}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRect(ctx, p.x - tw / 2 - 6, p.y - 46, tw + 12, 18, 9);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, p.x, p.y - 37);
      }
      if (kart.slow > 0) this.bubble(p.x, p.y - 62, `🧔 ${CUNADO_PHRASES[kart.slowPhrase] ?? 'Bla bla bla'}`);
    }
    for (const b of this.bubbles) {
      b.ttl -= dt;
      const kart = world.karts.find((kk) => kk.id === b.kart);
      if (!kart) continue;
      const p = pos(kart);
      this.bubble(p.x, p.y - (kart.slow > 0 ? 95 : 62), b.text);
    }
    this.bubbles = this.bubbles.filter((b) => b.ttl > 0);

    // --- HUD ---
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(view, rank, me);
  }

  private bubble(x: number, y: number, text: string) {
    const ctx = this.ctx;
    ctx.font = 'bold 14px system-ui, sans-serif';
    const tw = Math.min(ctx.measureText(text).width, 260);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    roundRect(ctx, x - tw / 2 - 10, y - 14, tw + 20, 28, 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 13);
    ctx.lineTo(x, y + 22);
    ctx.lineTo(x + 6, y + 13);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillText(text, x, y, 260);
  }

  private kartFx(k: Kart, x: number, y: number) {
    const back = { x: x - Math.cos(k.angle) * 16, y: y - Math.sin(k.angle) * 16 };
    if (k.driftDir !== 0 || k.spin > 0) {
      const rx = -Math.sin(k.angle) * 10;
      const ry = Math.cos(k.angle) * 10;
      this.skids.push({ x: back.x + rx, y: back.y + ry, life: 3 }, { x: back.x - rx, y: back.y - ry, life: 3 });
      if (this.skids.length > 1200) this.skids.splice(0, this.skids.length - 1200);
    }
    if (k.driftDir !== 0 && Math.random() < 0.7) {
      const color = k.driftCharge >= 1.6 ? '#ff9f1c' : k.driftCharge >= 0.75 ? '#4dabf7' : 'rgba(220,220,220,0.8)';
      this.particles.push({ x: back.x, y: back.y, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, life: 0.35, max: 0.35, color, size: 4 });
    }
    if (k.boost > 0 && Math.random() < 0.9) {
      this.particles.push({
        x: back.x,
        y: back.y,
        vx: -Math.cos(k.angle) * 120 + (Math.random() - 0.5) * 40,
        vy: -Math.sin(k.angle) * 120 + (Math.random() - 0.5) * 40,
        life: 0.3,
        max: 0.3,
        color: Math.random() < 0.5 ? '#ffd43b' : '#ff6b00',
        size: 6,
      });
    }
  }

  private drawKart(k: Kart, x: number, y: number, mine: boolean) {
    const ctx = this.ctx;
    const ch = getCharacter(k.char);
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 5, 22, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mine) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 26 + Math.sin(this.time * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.2, 1.2);
    ctx.rotate(k.angle);
    // ruedas
    ctx.fillStyle = '#111';
    for (const [wx, wy] of [
      [-12, -13],
      [-12, 9],
      [8, -13],
      [8, 9],
    ])
      ctx.fillRect(wx, wy, 10, 4);
    // carrocería
    ctx.fillStyle = ch.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, -18, -10, 36, 20, 7);
    ctx.fill();
    ctx.stroke();
    // morro y alerón
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    roundRect(ctx, 10, -6, 8, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(-21, -11, 4, 22);
    ctx.restore();
    // piloto (emoji siempre derecho)
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#000';
    ctx.fillText(ch.emoji, x, y - 2);
    if (k.spin > 0) {
      ctx.font = '18px sans-serif';
      ctx.fillText('💫', x + Math.cos(this.time * 10) * 14, y - 22);
    }
    if (k.invert > 0) {
      ctx.font = '16px sans-serif';
      for (let i = 0; i < 3; i++) {
        const a = this.time * 4 + (i * Math.PI * 2) / 3;
        ctx.fillText('⭐', x + Math.cos(a) * 20, y - 20 + Math.sin(a) * 6);
      }
    }
  }

  private drawHud(view: RenderView, rank: number[], me: Kart | undefined) {
    const ctx = this.ctx;
    const { world } = view;
    const W = this.w;
    const H = this.h;
    const small = W < 600;
    ctx.textBaseline = 'middle';

    if (me) {
      // posición
      const place = rank.indexOf(me.id) + 1;
      ctx.textAlign = 'left';
      ctx.font = `900 ${small ? 44 : 64}px system-ui, sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000';
      const placeColor = place === 1 ? '#ffd43b' : place === 2 ? '#dee2e6' : place === 3 ? '#e8a87c' : '#ffffff';
      ctx.strokeText(ORDINAL(place), 16, small ? 36 : 48);
      ctx.fillStyle = placeColor;
      ctx.fillText(ORDINAL(place), 16, small ? 36 : 48);
      ctx.font = `bold ${small ? 15 : 18}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      const lapTxt = `Vuelta ${Math.min(world.config.laps, Math.max(1, me.lap + 1))}/${world.config.laps}`;
      const timeTxt = formatTime(me.finishTime ?? world.time);
      ctx.strokeText(lapTxt, 18, small ? 74 : 96);
      ctx.fillStyle = '#fff';
      ctx.fillText(lapTxt, 18, small ? 74 : 96);
      ctx.strokeText(timeTxt, 18, small ? 96 : 122);
      ctx.fillText(timeTxt, 18, small ? 96 : 122);

      // objeto
      const box = small ? 64 : 84;
      const bx = W - box - 14;
      const by = 14;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      roundRect(ctx, bx, by, box, box, 14);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      let emoji = '';
      if (me.item) {
        emoji = me.itemRoll > 0 ? ITEMS[ITEM_KINDS[Math.floor(this.time * 14) % ITEM_KINDS.length]].emoji : ITEMS[me.item].emoji;
      }
      if (emoji) {
        ctx.font = `${box * 0.6}px sans-serif`;
        ctx.fillStyle = '#000';
        ctx.fillText(emoji, bx + box / 2, by + box / 2 + 2);
      }
      if (me.item && me.itemRoll <= 0) {
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(ITEMS[me.item].name, bx + box / 2, by + box + 12);
        if (!view.touch) {
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillText('[E]', bx + box / 2, by + box + 26);
        }
      }

      // sentido contrario
      const proj = projectOnTrack(world.track, me.x, me.y, me.trackIdx);
      const dot = Math.cos(me.angle) * proj.tx + Math.sin(me.angle) * proj.ty;
      if (dot < -0.4 && speedOf(me) > 60 && world.phase === 'racing') this.wrongWay += this.dt;
      else this.wrongWay = 0;
      if (this.wrongWay > 0.8 && Math.floor(this.time * 3) % 2 === 0) {
        this.bigText('⛔ ¡QUE VAS AL REVÉS, CRACK! ⛔', H * 0.3, small ? 20 : 32, '#ff6b6b');
      }

      if (me.invert > 0) this.bigText('🥴 RESACA: controles al revés', H * 0.22, small ? 16 : 22, '#ffd8a8');

      if (me.finishTime !== null) {
        const place2 = world.finishOrder.indexOf(me.id) + 1;
        const msg = place2 === 1 ? '🏆 ¡HAS GANADO! 🏆' : place2 === world.karts.length ? `🐌 ${ORDINAL(place2)}... dignidad ante todo` : `🏁 ¡META! ${ORDINAL(place2)}`;
        this.bigText(msg, H * 0.35, small ? 28 : 44, '#ffd43b');
      } else if (world.endTimer > 0 && world.phase === 'racing') {
        this.bigText(`Cierre de meta en ${Math.ceil(world.endTimer)}s ⏱️`, H * 0.16, small ? 16 : 22, '#fff');
      }
    } else {
      ctx.textAlign = 'left';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('🍿 Modo grada — entras en la próxima carrera', 16, 30);
    }

    // cuenta atrás
    if (world.phase === 'countdown') {
      const n = Math.ceil(world.countdown);
      const f = world.countdown - Math.floor(world.countdown);
      this.bigText(n > 0 ? String(n) : '', H * 0.4, (small ? 90 : 140) * (0.8 + f * 0.4), n === 1 ? '#ffd43b' : '#fff');
      this.bigText('Acelera justo en el "1" para salir con turbo… pero no antes', H * 0.4 + (small ? 70 : 100), small ? 13 : 18, '#fff');
    } else if (world.phase === 'racing' && world.time < 1) {
      ctx.globalAlpha = 1 - world.time;
      this.bigText('¡DALE!', H * 0.4, small ? 90 : 140, '#69db7c');
      ctx.globalAlpha = 1;
    }

    // comentarios
    ctx.textAlign = 'center';
    let fy = small ? (view.touch ? 250 : 130) : 30;
    for (const f of this.feed) {
      f.ttl -= this.dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, f.ttl));
      ctx.font = `bold ${small ? 13 : 16}px system-ui, sans-serif`;
      const tw = ctx.measureText(f.text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, W / 2 - tw / 2 - 10, fy - 13, tw + 20, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(f.text, W / 2, fy);
      fy += 30;
    }
    ctx.globalAlpha = 1;
    this.feed = this.feed.filter((f) => f.ttl > 0);

    this.drawMinimap(view, small);
  }

  private bigText(text: string, y: number, size: number, color: string) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    ctx.lineWidth = Math.max(3, size / 10);
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, this.w / 2, y, this.w - 20);
    ctx.fillStyle = color;
    ctx.fillText(text, this.w / 2, y, this.w - 20);
  }

  private drawMinimap(view: RenderView, small: boolean) {
    const ctx = this.ctx;
    const { world, myId } = view;
    const t = world.track;
    const size = small ? 110 : 170;
    const b = t.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const s = size / Math.max(bw, bh);
    const mw = bw * s;
    const mh = bh * s;
    const x0 = view.touch ? 16 : this.w - mw - 16;
    const y0 = view.touch ? (small ? 112 : 140) : this.h - mh - 16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, x0 - 6, y0 - 6, mw + 12, mh + 12, 10);
    ctx.fill();
    ctx.save();
    ctx.translate(x0 - b.minX * s, y0 - b.minY * s);
    ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = t.halfWidth * 0.9;
    ctx.lineJoin = 'round';
    ctx.stroke(this.pathFor(t));
    for (const k of world.karts) {
      ctx.fillStyle = getCharacter(k.char).color;
      ctx.strokeStyle = k.id === myId ? '#fff' : '#000';
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.arc(k.x, k.y, (k.id === myId ? 7 : 5) / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const HONKS = ['¡PIIIII!', '¡MEC MEC!', '¡APARTA!', '¡LA CUCARACHA! 🎺', '¡PI-PI!', '¡OYEEE!', '¡QUE TE PITO!'];
function pickHonk(n: number) {
  return HONKS[Math.abs(n) % HONKS.length];
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
