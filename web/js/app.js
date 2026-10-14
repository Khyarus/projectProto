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

  // ---------- estado ----------
  function setState(s) {
    state = s;
    eyes.setState(s);
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

  function toggleMic() {
    if (!ears.supported) { systemLine('reconhecimento de voz indisponível neste navegador'); return; }
    if (ears.active) { ears.stop(); return; }
    if (abort) abort.abort();
    voice.stop();
    ears.start();
    mic.classList.add('on');
    setState('listening');
    setEmotion('neutro');
  }
  mic.addEventListener('click', toggleMic);
  // tocar no visor também ativa o microfone (modo quiosque, sem teclado)
  $('visor').addEventListener('click', toggleMic);

  let heard = '';
  ears.onpartial = (t) => { input.value = t; };
  ears.onfinal = (t) => { heard = t; };
  ears.onlevel = (v) => { if (state === 'listening') eyes.setLevel(v); };
  ears.onerror = (e) => { if (e !== 'no-speech' && e !== 'aborted') systemLine('microfone: ' + e); };
  ears.onend = () => {
    mic.classList.remove('on');
    input.value = '';
    const t = heard; heard = '';
    if (t) converse(t);
    else { setState('idle'); maybeIdle(); }
  };

  // mensagens do app Android (atualização etc.)
  window.protogenSys = (ev) => { if (ev && ev.text) systemLine(ev.text); };

  // ---------- início ----------
  // No app o áudio não precisa de toque para liberar
  if (native) unlockAudio();
  setState('idle');
  refreshHud();
  systemLine('toque no visor para falar  ·  /ajuda');
})();
