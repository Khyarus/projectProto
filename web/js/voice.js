// Voz: SAM (1982) via sam-js, tocado pelo WebAudio com um analisador
// para os olhos/boca reagirem ao som.
(function (root) {
  'use strict';

  // Valores clássicos do manual do SAM
  const PRESETS = {
    sam:   { speed: 72,  pitch: 64, throat: 128, mouth: 128 },
    robo:  { speed: 92,  pitch: 60, throat: 190, mouth: 190 },
    et:    { speed: 100, pitch: 64, throat: 150, mouth: 200 },
    elfo:  { speed: 72,  pitch: 64, throat: 110, mouth: 160 },
    grave: { speed: 82,  pitch: 72, throat: 110, mouth: 105 },
  };

  // Palavras muito comuns de cada idioma, para decidir a pronúncia de cada frase
  const EN = new Set('the is are was and you your of to it this that what with for have i my me can do not be on at in how why'.split(' '));
  const PT = new Set('o a os as de do da que é não você um uma para com em no na por eu meu se mas como isso está'.split(' '));
  function isEnglish(text) {
    let en = 0, pt = 0;
    for (const w of text.toLowerCase().match(/[a-zà-ÿ']+/g) || []) {
      if (EN.has(w)) en++;
      if (PT.has(w)) pt++;
    }
    return en > pt;
  }

  class Voice {
    constructor() {
      this.preset = 'sam';
      this.muted = false;
      this.queue = [];       // frases fonéticas pendentes
      this.playing = false;
      this.ctx = null;
      this.analyser = null;
      this.timeData = null;
      this.onstart = null;
      this.onend = null;
      this.sam = new root.SamJs(PRESETS.sam);
    }

    setPreset(name) {
      if (!PRESETS[name]) return false;
      this.preset = name;
      this.sam = new root.SamJs(PRESETS[name]);
      return true;
    }

    static presets() { return Object.keys(PRESETS); }

    // Precisa ser chamado dentro de um gesto do usuário (toque/tecla).
    unlock() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        this.ctx = new AC();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.6;
        this.analyser.connect(this.ctx.destination);
        this.timeData = new Float32Array(this.analyser.fftSize);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // Enfileira texto (português ou inglês). Pode ser chamado várias vezes (streaming).
    // Português passa pelo conversor ptsam; inglês usa o conversor original do próprio SAM.
    say(text) {
      if (this.muted || !text || !text.trim()) return;
      if (isEnglish(text)) {
        const clean = text.replace(/[^A-Za-z0-9\s.,!?'-]/g, ' ');
        for (const part of clean.match(/[^.!?]+[.!?]*/g) || []) {
          // o SAM aceita ~250 fonemas por vez: quebra frases longas
          for (const piece of part.match(/.{1,110}(\s|$)/g) || []) if (piece.trim()) this.queue.push({ text: piece.trim(), english: true });
        }
      } else {
        for (const chunk of root.PtSam.toSam(text)) this.queue.push({ text: chunk, english: false });
      }
      if (!this.playing) this.next();
    }

    stop() {
      this.queue.length = 0;
      if (this.source) { try { this.source.stop(); } catch (e) { /* já parou */ } }
    }

    get busy() { return this.playing || this.queue.length > 0; }

    // Bipe curto de "estou ouvindo" (dois tons de onda quadrada, estilo 8 bits)
    beep() {
      if (this.muted) return;
      this.unlock();
      const t = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      g.connect(this.ctx.destination);
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(1320, t + 0.07);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.2);
    }

    next() {
      if (!this.queue.length) {
        if (this.playing) { this.playing = false; this.onend && this.onend(); }
        return;
      }
      this.unlock();
      const item = this.queue.shift();
      const buf = item.english ? this.sam.buf32(item.text) : this.sam.buf32(item.text, true);
      if (!buf) { console.warn('[voz] SAM rejeitou:', item.text); this.next(); return; }

      const ab = this.ctx.createBuffer(1, buf.length, 22050);
      ab.getChannelData(0).set(buf);
      const src = this.ctx.createBufferSource();
      src.buffer = ab;
      src.connect(this.analyser);
      src.onended = () => { if (this.source === src) this.source = null; setTimeout(() => this.next(), 90); };
      this.source = src;
      if (!this.playing) { this.playing = true; this.onstart && this.onstart(); }
      src.start();
    }

    // Nível RMS 0..1 e forma de onda atual (para a boca).
    level() {
      if (!this.analyser || !this.source) return 0;
      this.analyser.getFloatTimeDomainData(this.timeData);
      let s = 0;
      for (let i = 0; i < this.timeData.length; i++) s += this.timeData[i] * this.timeData[i];
      return Math.min(1, Math.sqrt(s / this.timeData.length) * 4);
    }

    wave() {
      if (!this.analyser || !this.source) return null;
      return this.timeData; // atualizado em level()
    }
  }

  root.Voice = Voice;
})(window);
