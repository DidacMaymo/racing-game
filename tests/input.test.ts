import { describe, expect, it } from 'vitest';
import { Controls } from '../src/client/input';

class FakeWindow extends EventTarget {}

function key(t: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) {
  const e = new Event(type) as Event & { code: string; repeat: boolean; preventDefault(): void };
  Object.assign(e, { code, repeat });
  t.dispatchEvent(e);
}

describe('controles', () => {
  // navigator.getGamepads no existe en node: el código debe tolerarlo
  const mk = () => {
    const w = new FakeWindow();
    const c = new Controls(w as unknown as Window);
    c.enabled = true;
    return { w, c };
  };

  it('teclado: gas y giro', () => {
    const { w, c } = mk();
    key(w, 'keydown', 'ArrowUp');
    key(w, 'keydown', 'KeyA');
    expect(c.read()).toMatchObject({ throttle: true, steer: -1 });
    key(w, 'keyup', 'KeyA');
    expect(c.read().steer).toBe(0);
  });

  it('izquierda + derecha a la vez se anulan', () => {
    const { w, c } = mk();
    key(w, 'keydown', 'ArrowLeft');
    key(w, 'keydown', 'ArrowRight');
    expect(c.read().steer).toBe(0);
  });

  it('objeto cuenta pulsaciones, no repeticiones del teclado', () => {
    const { w, c } = mk();
    key(w, 'keydown', 'KeyE');
    key(w, 'keydown', 'KeyE', true);
    key(w, 'keydown', 'KeyE', true);
    expect(c.read().itemCount).toBe(1);
  });

  it('deshabilitado no lee nada (estamos en un menú)', () => {
    const { w, c } = mk();
    c.enabled = false;
    key(w, 'keydown', 'ArrowUp');
    expect(c.read().throttle).toBe(false);
  });

  it('táctil acelera solo, salvo en la cuenta atrás o frenando', () => {
    const { c } = mk();
    c.touchMode = true;
    expect(c.read().throttle).toBe(true);
    c.autoThrottle = false;
    expect(c.read().throttle).toBe(false);
    c.autoThrottle = true;
    c.setTouch('brake', true);
    expect(c.read()).toMatchObject({ throttle: false, brake: true });
  });

  it('perder el foco suelta todas las teclas', () => {
    const { w, c } = mk();
    key(w, 'keydown', 'ArrowUp');
    w.dispatchEvent(new Event('blur'));
    expect(c.read().throttle).toBe(false);
  });
});
