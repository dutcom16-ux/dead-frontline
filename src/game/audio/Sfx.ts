// Synthesised sound effects (WebAudio; no audio files needed). Gunfire per weapon class,
// explosions, infected groans and screams, radio chirps, helicopters, UI clicks, ambient wind.
// Volume falls off with distance from the camera; per-kind rate limits keep firefights clean.
// private random source so sound never disturbs the simulation's random sequence
let seed = 7;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
export class Sfx {
  ctx: AudioContext | null = null; master: GainNode | null = null; noise: AudioBuffer | null = null; amb: GainNode | null = null;
  volume = 0.7; music = 0.25; last = new Map<string, number>(); listener = { x: 0, y: 0, range: 120 };
  enabled = true;
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      const c = this.ctx!;
      this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
      const n = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
      this.noise = n;
      this.ambient();
    } catch (e) { this.enabled = false; }
  }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setAmbient(v: number) { this.music = v; if (this.amb) this.amb.gain.value = v * 0.35; }
  private ambient() {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 380;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 160; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    this.amb = c.createGain(); this.amb.gain.value = this.music * 0.35;
    src.connect(f); f.connect(this.amb); this.amb.connect(this.master!); src.start();
  }
  private gate(kind: string, ms: number) {
    const now = performance.now(), l = this.last.get(kind) || 0;
    if (now - l < ms) return false;
    this.last.set(kind, now); return true;
  }
  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass", pan = 0, decay = dur) {
    const c = this.ctx!, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const gn = c.createGain(); gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    s.connect(f); f.connect(gn);
    if (p) { p.pan.value = pan; gn.connect(p); p.connect(this.master!); } else gn.connect(this.master!);
    s.start(t, rnd() * 0.5, dur + 0.05);
  }
  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = "sine", pan = 0) {
    const c = this.ctx!, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    o.connect(gn);
    if (p) { p.pan.value = pan; gn.connect(p); p.connect(this.master!); } else gn.connect(this.master!);
    o.start(t); o.stop(t + dur + 0.05);
  }
  play(kind: string, x: number, y: number, vol = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const L = this.listener, d = Math.hypot(x - L.x, y - L.y);
    const ui = kind === "ui" || kind === "select" || kind === "ack" || kind === "radio" || kind === "objective";
    const fall = ui ? 1 : Math.max(0, 1 - d / (L.range * 2.2));
    const v = vol * fall;
    if (v < 0.02) return;
    const pan = ui ? 0 : Math.max(-0.8, Math.min(0.8, (x - L.x) / (L.range * 1.5)));
    switch (kind) {
      case "rifle": if (this.gate("rifle", 45)) { this.burst(0.12, 1400, 0.8, 0.5 * v, "bandpass", pan, 0.12); this.tone(160, 60, 0.08, 0.25 * v, "triangle", pan); } break;
      case "smg": if (this.gate("smg", 40)) this.burst(0.08, 1900, 1, 0.35 * v, "bandpass", pan, 0.08); break;
      case "suppressed": if (this.gate("supp", 60)) this.burst(0.06, 2600, 2, 0.18 * v, "bandpass", pan, 0.06); break;
      case "mg": if (this.gate("mg", 55)) { this.burst(0.1, 1100, 0.7, 0.55 * v, "bandpass", pan, 0.1); this.tone(140, 50, 0.09, 0.3 * v, "triangle", pan); } break;
      case "sniper": if (this.gate("sniper", 80)) { this.burst(0.35, 900, 0.6, 0.8 * v, "bandpass", pan, 0.35); this.tone(120, 40, 0.25, 0.4 * v, "triangle", pan); } break;
      case "shotgun": if (this.gate("shotgun", 80)) { this.burst(0.25, 700, 0.5, 0.85 * v, "lowpass", pan, 0.22); } break;
      case "flame": if (this.gate("flame", 120)) this.burst(0.25, 500, 0.3, 0.3 * v, "lowpass", pan, 0.25); break;
      case "rocket": if (this.gate("rocket", 100)) { this.burst(0.5, 600, 0.5, 0.6 * v, "lowpass", pan, 0.5); this.tone(300, 900, 0.4, 0.1 * v, "sawtooth", pan); } break;
      case "cannon": if (this.gate("cannon", 100)) { this.burst(0.6, 300, 0.4, 1.0 * v, "lowpass", pan, 0.6); this.tone(90, 30, 0.4, 0.6 * v, "sine", pan); } break;
      case "explosion": if (this.gate("explosion", 70)) { this.burst(1.3, 220, 0.4, 1.2 * v, "lowpass", pan, 1.3); this.tone(70, 25, 0.9, 0.8 * v, "sine", pan); } break;
      case "bloater": case "splat": if (this.gate("splat", 80)) this.burst(0.4, 350, 1.2, 0.6 * v, "lowpass", pan, 0.4); break;
      case "groan": if (this.gate("groan", 350)) { const f = 90 + rnd() * 50; this.tone(f, f * 0.7, 0.9, 0.18 * v, "sawtooth", pan); } break;
      case "growl": if (this.gate("growl", 300)) this.tone(70, 50, 0.6, 0.3 * v, "sawtooth", pan); break;
      case "scream": if (this.gate("scream", 1500)) { this.tone(900, 1500, 0.9, 0.25 * v, "sawtooth", pan); this.burst(0.9, 2500, 3, 0.15 * v, "bandpass", pan, 0.9); } break;
      case "bite": if (this.gate("bite", 120)) this.burst(0.12, 600, 2, 0.3 * v, "bandpass", pan, 0.12); break;
      case "bang": if (this.gate("bang", 200)) { this.burst(0.18, 300, 1.5, 0.5 * v, "lowpass", pan, 0.18); } break;
      case "reload": if (this.gate("reload", 250)) { this.tone(1800, 1200, 0.04, 0.1 * v, "square", pan); } break;
      case "heli": if (this.gate("heli", 3000)) { for (let k = 0; k < 10; k++) setTimeout(() => this.burst(0.08, 160, 1, 0.35 * v, "lowpass", pan, 0.08), k * 90); } break;
      case "truck": if (this.gate("truck", 3000)) this.tone(60, 70, 1.5, 0.2 * v, "sawtooth", pan); break;
      case "drop": this.burst(0.3, 400, 1, 0.5 * v, "lowpass", pan, 0.3); break;
      case "radio": this.tone(1300, 1300, 0.06, 0.08); setTimeout(() => this.tone(1700, 1700, 0.06, 0.08), 80); break;
      case "objective": this.tone(660, 660, 0.15, 0.12, "triangle"); setTimeout(() => this.tone(880, 880, 0.25, 0.12, "triangle"), 160); break;
      case "select": if (this.gate("select", 80)) this.tone(900, 700, 0.05, 0.06, "square"); break;
      case "ack": if (this.gate("ack", 80)) this.tone(600, 900, 0.07, 0.06, "square"); break;
      case "ui": this.tone(1000, 800, 0.05, 0.07, "triangle"); break;
    }
  }
}
