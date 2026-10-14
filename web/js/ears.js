// Ouvidos: reconhecimento de voz.
// No app Android usa a ponte nativa (window.ProtogenNative); no navegador do PC
// usa a Web Speech API (só funciona no Chrome/Edge, e precisa de internet).
(function (root) {
  'use strict';

  class Ears {
    constructor() {
      this.native = root.ProtogenNative && typeof root.ProtogenNative.startListening === 'function'
        ? root.ProtogenNative : null;
      const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
      this.SR = SR || null;
      this.supported = !!(this.native || this.SR);
      this.active = false;
      this.onpartial = null; this.onfinal = null; this.onlevel = null;
      this.onend = null; this.onerror = null;

      // Eventos vindos do Kotlin: window.protogenEars({type, text, level})
      root.protogenEars = (ev) => this.handleNative(ev);
    }

    start() {
      if (this.active || !this.supported) return;
      this.active = true;
      if (this.native) { this.native.startListening('pt-BR'); return; }

      const rec = new this.SR();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
        }
        if (interim && this.onpartial) this.onpartial(interim);
        if (final && this.onfinal) this.onfinal(final.trim());
      };
      rec.onerror = (e) => { this.onerror && this.onerror(e.error); };
      rec.onend = () => { this.finish(); };
      this.rec = rec;
      rec.start();
      this.startLevelMeter();
    }

    stop() {
      if (!this.active) return;
      if (this.native) this.native.stopListening();
      else if (this.rec) this.rec.stop();
    }

    finish() {
      this.active = false;
      this.stopLevelMeter();
      this.onlevel && this.onlevel(0);
      this.onend && this.onend();
    }

    handleNative(ev) {
      if (!ev) return;
      if (ev.type === 'partial') this.onpartial && this.onpartial(ev.text);
      else if (ev.type === 'final') this.onfinal && this.onfinal(ev.text);
      else if (ev.type === 'level') this.onlevel && this.onlevel(ev.level);
      else if (ev.type === 'error') this.onerror && this.onerror(ev.text);
      else if (ev.type === 'end') this.finish();
    }

    // Medidor de volume do microfone (só para animação), opcional.
    async startLevelMeter() {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AC = root.AudioContext || root.webkitAudioContext;
        this.mctx = new AC();
        const an = this.mctx.createAnalyser();
        an.fftSize = 256;
        this.mctx.createMediaStreamSource(this.stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        const tick = () => {
          if (!this.active) return;
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          this.onlevel && this.onlevel(Math.min(1, Math.sqrt(s / buf.length) * 6));
          requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { /* sem medidor, tudo bem */ }
    }

    stopLevelMeter() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.mctx) this.mctx.close();
      this.stream = null; this.mctx = null;
    }
  }

  root.Ears = Ears;
})(window);
