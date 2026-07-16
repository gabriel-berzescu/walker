// Generative ambient audio: slow synth pads drifting between chords,
// a bed of filtered rain noise, and small sfx. Everything is WebAudio,
// created lazily on the first user gesture.

const CHORDS = [
  [110.00, 164.81, 246.94],  // A minor-ish
  [87.31, 130.81, 196.00],   // F major-ish
  [98.00, 146.83, 220.00],   // G
  [73.42, 110.00, 174.61],   // D minor-ish
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  start() {
    if (this.started) { this.ctx.resume(); return; }
    this.started = true;

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // Slow fade-in so the world eases in around you
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(0.55, ctx.currentTime + 6);

    // Muffle filter for the pause screen
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);

    this.buildPad();
    this.buildRainNoise();

    // Drift between chords forever
    this.chordIndex = 0;
    setInterval(() => {
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      this.setChord(CHORDS[this.chordIndex]);
    }, 22000);
  }

  buildPad() {
    const ctx = this.ctx;

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 520;
    this.padFilter.Q.value = 0.7;

    const padGain = ctx.createGain();
    padGain.gain.value = 0.16;

    // A touch of feedback delay = cheap cavernous reverb
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.47;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    delay.connect(feedback).connect(delay);
    delay.connect(wet);

    this.padFilter.connect(padGain);
    padGain.connect(this.muffle);
    padGain.connect(delay);
    wet.connect(this.muffle);

    // Very slow LFO breathing on the filter cutoff
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain).connect(this.padFilter.frequency);
    lfo.start();

    this.voices = CHORDS[0].map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const detune = ctx.createOscillator();
      detune.type = 'triangle';
      detune.frequency.value = freq * 1.003;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      osc.connect(g);
      detune.connect(g);
      g.connect(this.padFilter);
      osc.start();
      detune.start();
      return { osc, detune };
    });
  }

  setChord(freqs) {
    const t = this.ctx.currentTime;
    this.voices.forEach((v, i) => {
      v.osc.frequency.exponentialRampToValueAtTime(freqs[i], t + 6);
      v.detune.frequency.exponentialRampToValueAtTime(freqs[i] * 1.003, t + 6);
    });
  }

  buildRainNoise() {
    const ctx = this.ctx;
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.5;

    const g = ctx.createGain();
    g.gain.value = 0.05;

    src.connect(band).connect(g).connect(this.muffle);
    src.start();
  }

  setMuffled(muffled) {
    if (!this.ctx) return;
    this.muffle.frequency.exponentialRampToValueAtTime(
      muffled ? 380 : 18000, this.ctx.currentTime + 0.4
    );
  }

  // ── SFX ────────────────────────────────────────────
  blip(freq, duration, gainValue, type = 'sine') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainValue, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.muffle);
    osc.start(t);
    osc.stop(t + duration);
  }

  chime() {
    // A tiny ascending arpeggio for shard pickup
    this.blip(880, 0.7, 0.12);
    setTimeout(() => this.blip(1174.66, 0.7, 0.1), 90);
    setTimeout(() => this.blip(1760, 0.9, 0.08), 180);
  }

  thump() {
    this.blip(95, 0.18, 0.2, 'sine');
    this.blip(240, 0.1, 0.06, 'triangle');
  }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    const g = ctx.createGain();
    g.gain.value = 0.15;
    src.connect(filter).connect(g).connect(this.muffle);
    src.start();
  }
}
