/** Sonidos sintetizados con WebAudio: cero ficheros que descargar. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('ck-muted') === '1';
    } catch {
      /* sin storage */
    }
  }

  /** Hay que llamarlo tras un gesto del usuario (política de autoplay). */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    try {
      localStorage.setItem('ck-muted', this.muted ? '1' : '0');
    } catch {
      /* sin storage */
    }
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.3, slideTo?: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, filterFreq = 1200) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  honk(freq: number) {
    this.tone(freq, 0.22, 'square', 0.18);
    this.tone(freq * 1.26, 0.22, 'square', 0.12);
  }
  beep(high = false) {
    this.tone(high ? 880 : 440, high ? 0.5 : 0.18, 'sine', 0.3);
  }
  pickup() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.08, 'triangle', 0.15, undefined, i * 0.05));
  }
  boing() {
    this.tone(180, 0.35, 'sine', 0.35, 600);
  }
  splat() {
    this.noise(0.25, 0.4, 900);
    this.tone(300, 0.3, 'sawtooth', 0.15, 60);
  }
  cuac() {
    this.tone(700, 0.12, 'sawtooth', 0.2, 400);
    this.tone(650, 0.14, 'sawtooth', 0.2, 350, 0.13);
  }
  whoosh() {
    this.noise(0.5, 0.25, 3000);
    this.tone(200, 0.5, 'sawtooth', 0.08, 800);
  }
  thud() {
    this.noise(0.12, 0.35, 400);
  }
  bla() {
    // "bla bla bla" de cuñado
    for (let i = 0; i < 5; i++) this.tone(140 + Math.random() * 60, 0.09, 'sawtooth', 0.15, undefined, i * 0.11);
  }
  hic() {
    this.tone(500, 0.08, 'sine', 0.3, 900);
  }
  fanfare() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.12, undefined, i * 0.14));
  }
  sad() {
    [392, 370, 349, 330].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.15, undefined, i * 0.3));
  }

  /** Motor continuo: la frecuencia sube con la velocidad. */
  setEngine(speed01: number | null) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (speed01 === null) {
      if (this.engine) {
        this.engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      }
      return;
    }
    if (!this.engine) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'square';
      gain.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      osc.connect(f);
      osc2.connect(f);
      f.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, gain };
    }
    const base = 55 + speed01 * 110;
    this.engine.osc.frequency.setTargetAtTime(base, ctx.currentTime, 0.05);
    this.engine.osc2.frequency.setTargetAtTime(base * 0.5 + 3, ctx.currentTime, 0.05);
    this.engine.gain.gain.setTargetAtTime(0.05 + speed01 * 0.05, ctx.currentTime, 0.1);
  }
}
