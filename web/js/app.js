// Orquestra olhos, voz, ouvidos e cérebro.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const eyes = new Eyes($('visor'));
  const voice = new Voice();
  const ears = new Ears();
  let brain = Brain.createBrain();

  const input = $('cli-input');
  const mic = $('mic');
  const sub = $('subtitle');
  const hudState = $('hud-state');
  const hudBrain = $('hud-brain');

  const history = [];   // [{role, content}], últimas trocas
  let abort = null;     // AbortController da resposta atual
  let streaming = false;
  let state = 'idle';
  let fadeTimer = null;
  let emoTimer = null;
  let greeted = false;
  let wakeReady = false;  // a escuta contínua só começa depois de tudo montado

  // ---------- estado ----------
  function setState(s) {
    state = s;
    eyes.setState(s);
    if (wakeReady) { if (s === 'idle') armWake(); else if (s !== 'listening') disarmVosk(); }
    hudState.textContent = 'SYS · ' + {
      idle: 'IDLE', listening: 'OUVINDO', thinking: 'PENSANDO', talking: 'FALANDO', error: 'ERRO',
    }[s];
  }

  function setEmotion(e, holdMs) {
    eyes.setEmotion(e);
    clearTimeout(emoTimer);
    if (holdMs) emoTimer = setTimeout(() => eyes.setEmotion('neutro'), holdMs);
  }

  function refreshHud() { hudBrain.textContent = brain.label + (voice.muted ? ' · MUDO' : ''); }

  function maybeIdle() {
    if (!streaming && !voice.busy && state !== 'listening') {
      setState('idle');
      setEmotion(eyes.emotion, 6000);
      scheduleFade();
    }
  }

  // ---------- legendas ----------
  function showLines(userText) {
    clearTimeout(fadeTimer);
    sub.classList.remove('fade');
    sub.innerHTML = '';
    if (userText) {
      const u = document.createElement('div');
      u.className = 'user';
      u.textContent = userText;
      sub.appendChild(u);
    }
    const r = document.createElement('div');
    sub.appendChild(r);
    return r;
  }
  function scheduleFade() {
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => sub.classList.add('fade'), 9000);
  }
  function systemLine(text) { showLines().textContent = text; scheduleFade(); }

  // ---------- voz ----------
  voice.onstart = () => { if (state !== 'listening') setState('talking'); };
  voice.onend = () => maybeIdle();

  // loop: passa o áudio para os olhos
  (function pump() {
    if (state === 'talking') {
      eyes.setLevel(voice.level());
      eyes.setWave(voice.wave());
    }
    requestAnimationFrame(pump);
  })();

  function unlockAudio() {
    voice.unlock();
    if (!greeted) {
      greeted = true;
      voice.say('Sistemas online.');
    }
  }
  window.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: false });

  // ---------- conversa ----------
  async function converse(text) {
    if (abort) abort.abort();
    voice.stop();
    abort = new AbortController();
    const myAbort = abort;

    history.push({ role: 'user', content: text });
    while (history.length > 8) history.shift();

    const line = showLines(text);
    setState('thinking');
    streaming = true;

    let raw = '';         // texto bruto (com etiqueta)
    let spoken = 0;       // quantos caracteres do texto limpo já foram para a voz
    let clean = '';

    const flushSpeech = (final) => {
      const pending = clean.slice(spoken);
      // fala frase a frase conforme chegam
      const re = final ? /[\s\S]+/ : /[\s\S]*?[.!?…](\s|$)/;
      let m;
      let rest = pending;
      while ((m = rest.match(re)) && m[0].trim()) {
        voice.say(m[0]);
        spoken += m[0].length;
        rest = rest.slice(m[0].length);
        if (final) break;
      }
    };

    try {
      const full = await brain.ask(history.slice(), {
        signal: myAbort.signal,
        onTool: (desc) => { line.textContent = '[' + desc + ']'; },
        onToken: (tok) => {
          raw += tok;
          // etiqueta de emoção no início: [feliz]
          const tag = raw.match(/^\s*\[(\w+)\]\s*/);
          if (!tag && /^\s*\[[^\]]{0,12}$/.test(raw)) return; // ainda chegando
          if (tag && EYE_EMOTIONS.includes(tag[1].toLowerCase())) setEmotion(tag[1].toLowerCase());
          clean = tag ? raw.slice(tag[0].length) : raw;
          line.textContent = clean;
          flushSpeech(false);
          if (voice.muted && state === 'thinking') setState('talking');
        },
      });
      if (myAbort !== abort) return;
      streaming = false;
      flushSpeech(true);
      history.push({ role: 'assistant', content: full });
      if (!clean.trim()) line.textContent = '...';
      maybeIdle();
    } catch (err) {
      if (err.name === 'AbortError') return;
      streaming = false;
      console.error(err);
      setState('error');
      line.textContent = 'falha no cérebro: ' + err.message;
      voice.say('Erro no sistema.');
      setTimeout(() => { if (state === 'error') maybeIdle(); }, 4000);
    } finally {
      if (myAbort === abort) abort = null;
    }
  }

  // ---------- comandos /cli ----------
  const HELP = [
    '/voz [' + Voice.presets().join('|') + ']',
    '/mudo', '/falar <texto>', '/emocao [' + EYE_EMOTIONS.join('|') + ']',
    '/estado [idle|listening|thinking|talking|error]', '/llm <url> | /llm mock', '/limpar',
    '/escuta [celular|vosk|off|debug]', '/olhar [on|off|inverter]',
    '/modelos', '/baixar <id>', '/usar <id>', '/apagar <id>',
    '/versao', '/atualizar', '/sair <pin>', '/liberar <pin>',
  ].join('   ');
  const native = window.ProtogenNative || null;

  function command(cmd) {
    const [name, ...rest] = cmd.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (name) {
      case 'ajuda': case 'help': systemLine(HELP); break;
      case 'voz':
        if (!arg) systemLine('voz: ' + voice.preset + '  ·  opções: ' + Voice.presets().join(', '));
        else if (voice.setPreset(arg)) { systemLine('voz: ' + arg); voice.say('Teste de voz. Um, dois, três.'); }
        else systemLine('voz desconhecida: ' + arg);
        break;
      case 'mudo': voice.muted = !voice.muted; voice.stop(); refreshHud(); systemLine(voice.muted ? 'mudo' : 'som ligado'); break;
      case 'falar': voice.say(arg); showLines().textContent = arg; scheduleFade(); break;
      case 'emocao': case 'emoção': setEmotion(arg || 'neutro', 8000); break;
      case 'estado': setState(arg || 'idle'); if (arg === 'talking') eyes.setLevel(0.5); break;
      case 'llm':
        try {
          if (!arg || arg === 'mock') localStorage.removeItem('protogen.llm');
          else localStorage.setItem('protogen.llm', arg);
        } catch (e) { /* sem storage */ }
        brain = arg && arg !== 'mock' ? new Brain.OpenAIBrain(arg) : new Brain.MockBrain();
        refreshHud(); systemLine(brain.label);
        break;
      case 'limpar': history.length = 0; systemLine('memória limpa'); break;
      case 'versao': case 'versão':
        systemLine(native ? 'app ' + native.appVersion() + (native.isKiosk() ? ' · quiosque' : ' · app comum') : 'navegador (sem app)');
        break;
      case 'atualizar':
        if (native) { systemLine('verificando atualização...'); native.checkUpdate(); } else systemLine('só no app');
        break;
      case 'sair':
        if (!native) systemLine('só no app');
        else systemLine(native.exitKiosk(arg) ? 'quiosque desligado até reabrir o app' : 'pin errado');
        break;
      case 'liberar':
        if (!native) systemLine('só no app');
        else systemLine(native.releaseOwner(arg) ? 'app não é mais dono do aparelho' : 'pin errado');
        break;
      case 'escuta':
        if (arg === 'debug') {
          debugWake = !debugWake;
          if (native && native.wakeDebug) native.wakeDebug(debugWake);
          systemLine('depuração da escuta: ' + (debugWake ? 'ligada' : 'desligada'));
        } else if (['celular', 'vosk', 'off'].includes(arg)) {
          if (arg === 'vosk' && !(native && native.voskReady())) systemLine('vosk ainda não instalado/carregado (/modelos)');
          setWakeMode(arg); systemLine('escuta: ' + arg);
        } else systemLine('escuta: ' + wakeMode + '  ·  opções: celular, vosk, off, debug');
        break;
      case 'olhar':
        if (arg === 'inverter') faceInvert = !faceInvert;
        else if (arg === 'on' || arg === 'off') faceOn = arg === 'on';
        try {
          localStorage.setItem('protogen.face', faceOn ? 'on' : 'off');
          localStorage.setItem('protogen.faceInvert', faceInvert ? '1' : '0');
        } catch (e) { /* sem storage */ }
        applyFace();
        systemLine('olhar: ' + (faceOn ? 'seguindo rosto' : 'desligado') + (faceInvert ? ' (invertido)' : ''));
        break;
      case 'modelos': listModels(); break;
      case 'baixar': if (native) native.downloadModel(arg); else systemLine('só no app'); break;
      case 'usar':
        if (!native) systemLine('só no app');
        else systemLine(native.selectModel(arg) ? 'modelo selecionado: ' + arg : 'modelo inválido: ' + arg);
        break;
      case 'apagar':
        if (!native) systemLine('só no app');
        else systemLine(native.deleteModel(arg) ? 'apagado: ' + arg : 'não deu para apagar: ' + arg);
        break;
      default: systemLine('comando desconhecido. /ajuda');
    }
  }

  $('cli').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    input.blur(); // fecha o teclado do celular
    if (!text) return;
    if (text.startsWith('/')) command(text);
    else converse(text);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (abort) abort.abort();
      abort = null; streaming = false;
      voice.stop(); ears.stop();
      maybeIdle();
    }
  });

  // ---------- microfone ----------
  if (!ears.supported) mic.classList.add('unsupported');

  // Sessão do reconhecedor: 'passive' = escutando a palavra de ativação em segundo plano,
  // 'active' = ouvindo um pedido (olhos atentos).
  let session = null;
  let woke = false;       // a palavra de ativação apareceu nesta sessão passiva
  let heard = '';

  function startActive() {
    if (!ears.supported) { systemLine('reconhecimento de voz indisponível neste navegador'); return; }
    if (abort) abort.abort();
    voice.stop();
    disarmVosk();
    session = 'active';
    if (!ears.active) ears.start();
    mic.classList.add('on');
    setState('listening');
    setEmotion('neutro');
  }

  function toggleMic() {
    if (session === 'active' && ears.active) { ears.stop(); return; }
    if (session === 'passive' && ears.active) {
      // já está ouvindo em segundo plano: só promove a sessão
      session = 'active'; woke = true;
      mic.classList.add('on'); setState('listening');
      return;
    }
    startActive();
  }
  mic.addEventListener('click', toggleMic);
  // tocar no visor também ativa o microfone (modo quiosque, sem teclado)
  $('visor').addEventListener('click', toggleMic);

  ears.onpartial = (t) => {
    if (session === 'passive') {
      const m = Wake.match(t);
      if (m && !woke) { woke = true; wakeAck(); }
      if (woke) input.value = m ? m.rest : t;
      return;
    }
    input.value = Wake.strip(t);
  };
  ears.onfinal = (t) => { heard = t; };
  ears.onlevel = (v) => { if (state === 'listening') eyes.setLevel(v); };
  ears.onerror = (e) => {
    if (session === 'passive') { Wake.noteError(e); return; }
    if (e !== 'no-speech' && e !== 'aborted') systemLine('microfone: ' + e);
  };
  ears.onend = () => {
    mic.classList.remove('on');
    input.value = '';
    const t = heard; heard = '';
    const was = session; session = null;
    if (was === 'passive') {
      const m = Wake.match(t);
      if (debugWake && t) systemLine('ouvi: "' + t + '"' + (m ? '  -> ativou' : ''));
      if (m || woke) {
        woke = false;
        if (m && m.rest) converse(m.rest);
        else startActive(); // só chamou o nome: agora ouve o pedido
        return;
      }
      Wake.sessionEnded(!!t);
      armWake();
      return;
    }
    woke = false;
    const cmd = Wake.strip(t);
    if (cmd) converse(cmd);
    else { setState('idle'); maybeIdle(); }
  };

  // ---------- palavra de ativação: "ei proto" / "hey proto" ----------
  // modo 'celular': reconhecedor do Android/Chrome em loop (entende frase inteira, PT e EN)
  // modo 'vosk': reconhecedor offline só da palavra (app Android)
  const Wake = {
    // "hey" costuma sair como "ei"/"rei"; "proto" às vezes vira "prato", "preto", "porto"...
    RE: /(?:^|[\s,.!?])(?:(?:h?ei|hey|rei|oi|ai|hi|e)[\s,]+(?:proto|prot[oóô]|protu|prato|preto|porto|photo|pluto)|proto)(?=$|[\s,.!?])[\s,.!?]*/i,
    errors: 0,
    match(t) {
      if (!t) return null;
      const m = t.match(this.RE);
      return m ? { rest: t.slice(m.index + m[0].length).trim() } : null;
    },
    strip(t) { const m = this.match(t); return m ? m.rest || '' : (t || '').trim(); },
    noteError(e) {
      if (['no-speech', 'aborted', 'reconhecedor ocupado'].includes(e)) return;
      this.errors++;
      if (this.errors === 3) systemLine('escuta contínua com problema: ' + e);
    },
    sessionEnded(ok) { if (ok) this.errors = 0; },
  };

  let wakeMode = 'celular';
  let debugWake = false;
  let armTimer = null;
  try { wakeMode = localStorage.getItem('protogen.wake') || 'celular'; } catch (e) { /* sem storage */ }

  function canListen() {
    return wakeMode !== 'off' && state === 'idle' && !voice.busy && !streaming && session === null && !document.hidden;
  }

  function armWake() {
    clearTimeout(armTimer);
    // reinício rápido demais irrita o reconhecedor; com erros seguidos, espera mais
    const delay = Math.min(8000, 400 + Wake.errors * 1500);
    armTimer = setTimeout(() => {
      if (!canListen()) return;
      if (wakeMode === 'vosk') {
        if (native && native.voskReady()) native.voskListen(true);
        return;
      }
      if (!ears.supported) return;
      session = 'passive'; woke = false;
      ears.start();
    }, delay);
  }

  function disarmVosk() { if (native && native.voskListen) native.voskListen(false); }

  // ouviu o nome: olhos atentos + bipe
  function wakeAck() {
    disarmVosk();
    mic.classList.add('on');
    setState('listening');
    setEmotion('surpreso', 1500);
    voice.beep();
  }

  window.protogenWake = (ev) => {
    if (!ev) return;
    if (ev.type === 'debug') { if (debugWake) systemLine(ev.text); return; }
    if (ev.type === 'wake') { wakeAck(); startActive(); }
  };

  function setWakeMode(m) {
    wakeMode = m;
    try { localStorage.setItem('protogen.wake', m); } catch (e) { /* sem storage */ }
    disarmVosk();
    if (session === 'passive') ears.stop();
    armWake();
  }

  // ---------- olhar seguindo o rosto (câmera frontal) ----------
  let faceOn = true, faceInvert = false;
  try {
    faceOn = localStorage.getItem('protogen.face') !== 'off';
    faceInvert = localStorage.getItem('protogen.faceInvert') === '1';
  } catch (e) { /* sem storage */ }
  window.protogenFace = (ev) => {
    if (!ev || ev.lost) { eyes.clearGaze(); return; }
    eyes.setGaze(faceInvert ? -ev.x : ev.x, ev.y, ev.size);
  };
  function applyFace() { if (native && native.faceTracking) native.faceTracking(faceOn); if (!faceOn) eyes.clearGaze(); }

  // ---------- modelos ----------
  function fmtSize(b) { return b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB'; }
  function listModels() {
    if (!native) { systemLine('só no app'); return; }
    const ms = JSON.parse(native.models());
    systemLine(ms.map((m) => {
      const flag = m.installed ? '[ok]' : m.downloading ? '[baixando]' : m.partial ? '[parcial]' : '[ ]';
      return `${flag} ${m.id}${m.selected ? ' *' : ''}  ${fmtSize(m.size)}  ${m.notes || ''}`;
    }).join('\n') + '\n* = selecionado · /baixar <id> · /usar <id> · /apagar <id>');
  }

  // mensagens do app Android (atualização, downloads, permissões)
  window.protogenSys = (ev) => {
    if (!ev) return;
    if (ev.type === 'permissions') { applyFace(); armWake(); }
    if (ev.text) systemLine(ev.text);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (session === 'passive') ears.stop(); disarmVosk(); }
    else armWake();
  });

  // ---------- início ----------
  // No app o áudio não precisa de toque para liberar
  if (native) unlockAudio();
  wakeReady = true;
  setState('idle');
  refreshHud();
  applyFace();
  systemLine(wakeMode === 'off' ? 'toque no visor para falar  ·  /ajuda' : 'diga "ei proto" ou toque no visor  ·  /ajuda');
})();
