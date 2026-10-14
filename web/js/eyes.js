// Visor Protogen: desenha olhos e boca em vetor numa máscara de baixa resolução
// e renderiza cada "pixel" da máscara como um LED com brilho.
(function (root) {
  'use strict';

  const COLORS = {
    idle: [25, 240, 255],
    listening: [60, 255, 170],
    thinking: [170, 110, 255],
    talking: [25, 240, 255],
    error: [255, 50, 70],
  };

  // Parâmetros de forma por emoção (interpolados entre si).
  // slantIn/slantOut: quanto o canto superior interno/externo desce (0..1 da altura)
  // round: 0 = polígono do visor, 1 = elipse | happy: 0..1 vira arco "^"
  // smile: curva da boca (+ sorri, - triste) | size: escala do olho
  const EMOTIONS = {
    neutro:   { slantIn: 0.18, slantOut: 0.00, round: 0, happy: 0, smile: 0.0,  size: 1.00 },
    feliz:    { slantIn: 0.00, slantOut: 0.00, round: 0, happy: 1, smile: 1.0,  size: 1.00 },
    triste:   { slantIn: 0.00, slantOut: 0.55, round: 0, happy: 0, smile: -0.9, size: 0.92 },
    bravo:    { slantIn: 0.62, slantOut: 0.00, round: 0, happy: 0, smile: -0.4, size: 1.00 },
    surpreso: { slantIn: 0.00, slantOut: 0.00, round: 1, happy: 0, smile: 0.0,  size: 1.18 },
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  class Eyes {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mask = document.createElement('canvas');
      this.mctx = this.mask.getContext('2d', { willReadFrequently: true });
      this.led = document.createElement('canvas');
      this.lctx = this.led.getContext('2d');
      this.glow = document.createElement('canvas');
      this.gctx = this.glow.getContext('2d');
      this.grid = document.createElement('canvas');

      this.state = 'idle';
      this.emotion = 'neutro';
      this.shape = { ...EMOTIONS.neutro };
      this.color = COLORS.idle.slice();
      this.level = 0;        // nível de áudio 0..1 (fala ou microfone)
      this.wave = null;      // Float32Array da forma de onda
      this.open = 1;         // abertura atual dos olhos
      this.look = { x: 0, y: 0 };
      this.lookTarget = { x: 0, y: 0 };
      this.blinkT = -1;      // >=0 durante uma piscada
      this.nextBlink = rand(1.5, 4);
      this.nextSaccade = rand(1, 3);
      this.t = 0;
      this.boot = 0;         // animação de ligar

      this.resize();
      this.last = performance.now();
      requestAnimationFrame((now) => this.frame(now));
    }

    setState(s) { if (COLORS[s]) this.state = s; }
    setEmotion(e) { if (EMOTIONS[e]) this.emotion = e; }
    setLevel(v) { this.level = clamp(v || 0, 0, 1); }
    setWave(w) { this.wave = w; }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 3);
      const W = Math.round(this.canvas.clientWidth * dpr);
      const H = Math.round(this.canvas.clientHeight * dpr);
      this.canvas.width = W; this.canvas.height = H;
      this.W = W; this.H = H;

      // Tamanho do LED: ~110 colunas na maior dimensão
      if (W < 1 || H < 1) { this.gw = this.gh = 0; return; }
      this.cell = Math.max(4, Math.round(Math.max(W, H) / 110));
      this.gw = Math.floor(W / this.cell);
      this.gh = Math.floor(H / this.cell);
      this.ox = Math.round((W - this.gw * this.cell) / 2);
      this.oy = Math.round((H - this.gh * this.cell) / 2);

      this.mask.width = this.gw; this.mask.height = this.gh;
      this.led.width = W; this.led.height = H;
      this.glow.width = Math.ceil(W / 4); this.glow.height = Math.ceil(H / 4);

      // Grade de LEDs apagados (estática)
      this.grid.width = W; this.grid.height = H;
      const g = this.grid.getContext('2d');
      g.fillStyle = 'rgba(40, 90, 100, 0.10)';
      const r = this.cell * 0.36;
      for (let y = 0; y < this.gh; y++) {
        for (let x = 0; x < this.gw; x++) {
          g.beginPath();
          g.arc(this.ox + (x + 0.5) * this.cell, this.oy + (y + 0.5) * this.cell, r, 0, Math.PI * 2);
          g.fill();
        }
      }

      // Sprite de um LED aceso (branco; a cor é aplicada depois)
      const c = this.cell;
      this.sprite = document.createElement('canvas');
      this.sprite.width = this.sprite.height = c;
      const s = this.sprite.getContext('2d');
      const grad = s.createRadialGradient(c / 2, c / 2, 0, c / 2, c / 2, c * 0.46);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.65, 'rgba(255,255,255,0.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      s.fillStyle = grad;
      s.fillRect(0, 0, c, c);
    }

    // ---------------- animação ----------------
    update(dt) {
      this.t += dt;
      this.boot = Math.min(1, this.boot + dt * 0.8);

      // emoção -> forma
      const target = this.state === 'error' ? EMOTIONS.triste : EMOTIONS[this.emotion];
      const k = 1 - Math.pow(0.0005, dt);
      for (const key in target) this.shape[key] = lerp(this.shape[key], target[key], k);

      // cor
      const tc = COLORS[this.state];
      for (let i = 0; i < 3; i++) this.color[i] = lerp(this.color[i], tc[i], 1 - Math.pow(0.002, dt));

      // piscar (não pisca pensando nem em erro)
      this.nextBlink -= dt;
      if (this.nextBlink <= 0 && this.blinkT < 0 && this.state !== 'thinking') {
        this.blinkT = 0;
        this.nextBlink = Math.random() < 0.15 ? 0.25 : rand(2.5, 6);
      }
      let blink = 1;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const d = 0.16;
        blink = Math.abs(1 - 2 * clamp(this.blinkT / d, 0, 1));
        if (this.blinkT > d) this.blinkT = -1;
      }

      // olhar
      this.nextSaccade -= dt;
      if (this.state === 'thinking') {
        this.lookTarget = { x: 0.10, y: -0.10 };
      } else if (this.nextSaccade <= 0) {
        this.nextSaccade = rand(1.2, 4);
        this.lookTarget = Math.random() < 0.4 ? { x: 0, y: 0 } : { x: rand(-0.07, 0.07), y: rand(-0.04, 0.04) };
      }
      const lk = 1 - Math.pow(0.00001, dt);
      this.look.x = lerp(this.look.x, this.lookTarget.x, lk);
      this.look.y = lerp(this.look.y, this.lookTarget.y, lk);

      // abertura base por estado
      let open = 1;
      if (this.state === 'thinking') open = 0.42;
      else if (this.state === 'listening') open = 1.08 + Math.sin(this.t * 3) * 0.04;
      else if (this.state === 'talking') open = 0.82 + this.level * 0.45;
      this.open = lerp(this.open, open, 1 - Math.pow(0.0001, dt));
      this.openNow = Math.max(0.06, this.open * blink * smoothstep(0, 0.6, this.boot));
    }

    // ---------------- máscara vetorial ----------------
    drawMask() {
      const m = this.mctx, gw = this.gw, gh = this.gh;
      m.clearRect(0, 0, gw, gh);
      m.fillStyle = '#fff';
      m.strokeStyle = '#fff';

      // Área livre: desconta o HUD em cima e legenda + CLI embaixo
      const dpr = this.W / Math.max(1, this.canvas.clientWidth);
      const top = (34 * dpr) / this.cell;
      const usable = gh - top - (120 * dpr) / this.cell;
      const S = Math.min(gw / 2.3, usable / 0.95);
      const cy = top + usable * 0.36;
      const sp = this.shape;
      const scale = sp.size * (this.state === 'listening' ? 1.08 : 1);
      const ew = S * 0.62 * scale, eh = S * 0.40 * scale;

      for (const side of [-1, 1]) {
        const cx = gw / 2 + side * S * 0.56 + this.look.x * S;
        const ey = cy + this.look.y * S;
        if (this.state === 'error') this.drawX(m, cx, ey, eh * 0.9);
        else this.drawEye(m, cx, ey, ew, eh, side, sp);
      }
      this.drawMouth(m, gw / 2, cy + S * 0.48, S * 0.85, S);
    }

    drawEye(m, cx, cy, w, h, side, sp) {
      const o = this.openNow;
      // olho "normal" (polígono/elipse), some conforme happy -> 1
      const normalA = 1 - sp.happy;
      if (normalA > 0.02) {
        m.save();
        m.globalAlpha = normalA;
        m.translate(cx, cy);
        m.scale(side, o); // espelha: lado interno (centro do rosto) sempre em x negativo
        const hw = w / 2, hh = h / 2;
        const r = h * 0.28;
        m.lineJoin = 'round';
        m.lineWidth = r;
        if (sp.round > 0.5) {
          m.beginPath();
          m.ellipse(0, 0, hh * 1.05, hh * 1.05, 0, 0, Math.PI * 2);
          m.fill();
        } else {
          const inset = r / 2;
          m.beginPath();
          m.moveTo(-hw + inset, -hh + inset + sp.slantIn * h);            // topo interno
          m.lineTo(hw - inset - h * 0.18, -hh + inset + sp.slantOut * h); // topo externo
          m.lineTo(hw - inset, -hh * 0.2 + sp.slantOut * h * 0.5);
          m.lineTo(hw - inset - h * 0.12, hh - inset);                    // base externa
          m.lineTo(-hw + inset + h * 0.25, hh - inset);                   // base interna
          m.closePath();
          m.fill();
          m.stroke();
        }
        m.restore();
      }
      // olho feliz: arco "^"
      if (sp.happy > 0.02) {
        m.save();
        m.globalAlpha = sp.happy;
        m.lineWidth = h * 0.30;
        m.lineCap = 'round';
        m.lineJoin = 'round';
        m.beginPath();
        m.moveTo(cx - w * 0.42, cy + h * 0.25);
        m.quadraticCurveTo(cx, cy - h * 0.75 * Math.max(0.3, this.openNow), cx + w * 0.42, cy + h * 0.25);
        m.stroke();
        m.restore();
      }
    }

    drawX(m, cx, cy, s) {
      m.save();
      m.lineWidth = s * 0.28;
      m.lineCap = 'round';
      m.beginPath();
      m.moveTo(cx - s / 2, cy - s / 2); m.lineTo(cx + s / 2, cy + s / 2);
      m.moveTo(cx + s / 2, cy - s / 2); m.lineTo(cx - s / 2, cy + s / 2);
      m.stroke();
      m.restore();
    }

    drawMouth(m, cx, cy, w, S) {
      const N = 10;
      const zig = S * 0.028;
      const smile = this.shape.smile * S * 0.10;
      const wave = this.wave;
      const talking = this.state === 'talking';
      const listening = this.state === 'listening';

      m.save();
      m.lineWidth = Math.max(1.4, S * 0.034);
      m.lineJoin = 'round';
      m.lineCap = 'round';
      m.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N;              // 0..1
        const x = cx - w / 2 + u * w;
        const centered = u * 2 - 1;   // -1..1
        let y = cy + smile * (1 - centered * centered) - smile * 0.5;
        y += (i % 2 ? 1 : -1) * zig;  // dente de serra Protogen
        if (talking && wave) {
          const idx = Math.floor(u * (wave.length - 1));
          y += wave[idx] * S * 0.35 * (0.4 + 0.6 * Math.sin(u * Math.PI));
        } else if (listening) {
          y += Math.sin(u * 14 + this.t * 9) * this.level * S * 0.12 * Math.sin(u * Math.PI);
        }
        if (i === 0) m.moveTo(x, y); else m.lineTo(x, y);
      }
      m.stroke();

      // pensando: ponto correndo na boca
      if (this.state === 'thinking') {
        const u = (Math.sin(this.t * 3.2) + 1) / 2;
        m.beginPath();
        m.arc(cx - w / 2 + u * w, cy + S * 0.10, S * 0.04, 0, Math.PI * 2);
        m.fill();
      }
      m.restore();
    }

    // ---------------- render dos LEDs ----------------
    render() {
      const { ctx, lctx, gctx, cell, gw, gh, ox, oy, W, H } = this;
      const data = this.mctx.getImageData(0, 0, gw, gh).data;

      // brilho global: pulsa ouvindo, varredura pensando
      let bright = 1;
      if (this.state === 'listening') bright = 0.85 + 0.15 * Math.sin(this.t * 4);
      if (this.state === 'talking') bright = 0.85 + 0.15 * this.level;
      const scanX = this.state === 'thinking' ? ((this.t * 0.9) % 1.4 - 0.2) * gw : null;
      // ligar: linha de varredura vertical
      const bootY = this.boot < 1 ? this.boot * gh * 1.2 : Infinity;

      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, W, H);
      for (let y = 0; y < gh; y++) {
        if (y > bootY) break;
        for (let x = 0; x < gw; x++) {
          const a = data[(y * gw + x) * 4 + 3] / 255;
          if (a < 0.08) continue;
          let b = smoothstep(0.08, 0.7, a) * bright;
          if (scanX !== null) b *= 0.55 + 0.45 * Math.exp(-((x - scanX) ** 2) / (gw * 0.6));
          lctx.globalAlpha = b;
          lctx.drawImage(this.sprite, ox + x * cell, oy + y * cell);
        }
      }
      lctx.globalAlpha = 1;
      // tinge com a cor atual
      const [r, g, b] = this.color.map((v) => v | 0);
      lctx.globalCompositeOperation = 'source-in';
      lctx.fillStyle = `rgb(${r},${g},${b})`;
      lctx.fillRect(0, 0, W, H);

      // brilho (glow) barato: reduz, borra, amplia
      gctx.clearRect(0, 0, this.glow.width, this.glow.height);
      gctx.filter = `blur(${Math.max(2, cell * 0.5)}px)`;
      gctx.drawImage(this.led, 0, 0, this.glow.width, this.glow.height);
      gctx.filter = 'none';

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(this.grid, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.glow, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.led, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      // linha de boot
      if (this.boot < 1) {
        ctx.fillStyle = `rgba(${r},${g},${b},0.35)`;
        ctx.fillRect(0, oy + Math.min(bootY, gh) * cell, W, Math.max(2, cell * 0.3));
      }
    }

    frame(now) {
      requestAnimationFrame((n) => this.frame(n));
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      // WebView pode começar com tamanho 0; acompanha o tamanho real
      const dpr = Math.min(root.devicePixelRatio || 1, 3);
      if (Math.round(this.canvas.clientWidth * dpr) !== this.W || Math.round(this.canvas.clientHeight * dpr) !== this.H) this.resize();
      if (this.gw < 1 || this.gh < 1) return;
      this.update(dt);
      this.drawMask();
      this.render();
    }
  }

  root.Eyes = Eyes;
  root.EYE_EMOTIONS = Object.keys(EMOTIONS);
})(window);
