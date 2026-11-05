import type { InputFrame } from '../net/session';

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyX', 'Enter', 'KeyK'],
  honk: ['KeyH', 'KeyQ', 'KeyC'],
};

export class Controls {
  private down = new Set<string>();
  private itemCount = 0;
  private honkCount = 0;
  private touch = { left: false, right: false, brake: false, drift: false };
  private padPrev = { item: false, honk: false };
  touchMode = false;
  /** En táctil se acelera solo, pero no durante la cuenta atrás (si no, se cala siempre). */
  autoThrottle = true;
  /** El juego sólo captura teclas mientras corre (para no romper inputs de texto). */
  enabled = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e)) return;
      if (Object.values(KEYS).some((ks) => ks.includes(e.code))) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (KEYS.item.includes(e.code)) this.itemCount++;
      if (KEYS.honk.includes(e.code)) this.honkCount++;
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(keys: string[]) {
    return keys.some((k) => this.down.has(k));
  }

  pressItem() {
    this.itemCount++;
  }

  pressHonk() {
    this.honkCount++;
  }

  setTouch(key: keyof Controls['touch'], v: boolean) {
    this.touch[key] = v;
  }

  read(): InputFrame {
    let steer = 0;
    let throttle = false;
    let brake = false;
    let drift = false;
    if (this.enabled) {
      if (this.any(KEYS.left) || this.touch.left) steer -= 1;
      if (this.any(KEYS.right) || this.touch.right) steer += 1;
      throttle = this.any(KEYS.up) || (this.touchMode && this.autoThrottle && !this.touch.brake);
      brake = this.any(KEYS.down) || this.touch.brake;
      drift = this.any(KEYS.drift) || this.touch.drift;

      const pad = navigator.getGamepads?.().find((g) => g && g.connected);
      if (pad) {
        const ax = pad.axes[0] ?? 0;
        if (Math.abs(ax) > 0.2) steer = ax;
        if (pad.buttons[14]?.pressed) steer = -1;
        if (pad.buttons[15]?.pressed) steer = 1;
        throttle ||= !!pad.buttons[0]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.3;
        brake ||= !!pad.buttons[1]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.3;
        drift ||= !!pad.buttons[5]?.pressed;
        const item = !!(pad.buttons[4]?.pressed || pad.buttons[2]?.pressed);
        const honk = !!pad.buttons[3]?.pressed;
        if (item && !this.padPrev.item) this.itemCount++;
        if (honk && !this.padPrev.honk) this.honkCount++;
        this.padPrev = { item, honk };
      }
    }
    return {
      steer: Math.max(-1, Math.min(1, steer)),
      throttle,
      brake,
      drift,
      itemCount: this.itemCount,
      honkCount: this.honkCount,
    };
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
