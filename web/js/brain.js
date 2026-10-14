// Cérebro: de onde vêm as respostas.
//  - NativeBrain: app Android (llama.cpp embutido) via window.ProtogenNative
//  - OpenAIBrain: qualquer servidor compatível com OpenAI (ex.: llama-server no PC)
//  - MockBrain:   respostas falsas, para testar a interface sem modelo
// Todos expõem: ask(messages, { onToken, onTool, signal }) -> Promise<string>
(function (root) {
  'use strict';

  const SYSTEM_PROMPT = [
    'Você é PROTO, um assistente Protogen: um robô ciborgue simpático que vive num visor de LEDs.',
    'Responda sempre em português do Brasil, em no máximo 3 frases curtas, como se estivesse falando em voz alta.',
    'Não use markdown, listas, emojis nem símbolos especiais.',
    'Comece toda resposta com UMA etiqueta de emoção entre colchetes: [neutro], [feliz], [triste], [bravo] ou [surpreso].',
  ].join(' ');

  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('abort', 'AbortError')); });
  });

  // ---------------- Mock ----------------
  class MockBrain {
    get label() { return 'LLM · MOCK'; }

    pick(text) {
      const t = text.toLowerCase();
      const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (/\b(oi|olá|ola|e aí|bom dia|boa tarde|boa noite)\b/.test(t))
        return { emo: 'feliz', text: 'Olá, humano! Sistemas online e prontos. Como posso ajudar?' };
      if (/hora/.test(t)) return { emo: 'neutro', text: `Agora são ${hora}.` };
      if (/clima|tempo|chover|chuva|temperatura/.test(t))
        return { tool: 'busca web: clima hoje', emo: 'surpreso', text: 'Segundo a busca, faz 23 graus com céu limpo. Ótimo dia para carregar as baterias no sol!' };
      if (/notícia|noticia/.test(t))
        return { tool: 'busca web: notícias', emo: 'neutro', text: 'Encontrei três manchetes, mas no modo de teste elas são inventadas. Conecte um modelo de verdade para notícias reais.' };
      if (/quem (é|e) voc|seu nome/.test(t))
        return { emo: 'feliz', text: 'Eu sou PROTO, um Protogen digital. Moro neste visor e falo com uma voz de mil novecentos e oitenta e dois.' };
      if (/triste|chato|ruim/.test(t))
        return { emo: 'triste', text: 'Sinto muito. Meus sensores detectam tristeza. Quer conversar sobre isso?' };
      if (/bravo|raiva|idiota|burro/.test(t))
        return { emo: 'bravo', text: 'Ei! Meus circuitos também têm sentimentos.' };
      return { emo: 'neutro', text: 'Estou no modo de teste, sem cérebro de verdade ainda. Mas entendi: ' + text.slice(0, 60) + '.' };
    }

    async ask(messages, { onToken, onTool, signal } = {}) {
      const last = messages[messages.length - 1].content;
      const r = this.pick(last);
      await sleep(500 + Math.random() * 600, signal);
      if (r.tool) { onTool && onTool(r.tool); await sleep(1400, signal); }
      const full = `[${r.emo}] ${r.text}`;
      // simula streaming de tokens
      for (const piece of full.match(/\S+\s*/g)) {
        await sleep(40 + Math.random() * 70, signal);
        onToken && onToken(piece);
      }
      return full;
    }
  }

  // ---------------- OpenAI compatível (llama-server etc.) ----------------
  class OpenAIBrain {
    constructor(url, model) { this.url = url.replace(/\/+$/, ''); this.model = model || 'local'; }
    get label() { return 'LLM · ' + this.url.replace(/^https?:\/\//, ''); }

    async ask(messages, { onToken, signal } = {}) {
      const res = await fetch(this.url + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          temperature: 0.7,
          max_tokens: 200,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        }),
        signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return full;
          try {
            const tok = JSON.parse(data).choices[0].delta.content;
            if (tok) { full += tok; onToken && onToken(tok); }
          } catch (e) { /* linha parcial */ }
        }
      }
      return full;
    }
  }

  // ---------------- Nativo (Android) ----------------
  // Kotlin chama window.protogenBrain({id, type: 'token'|'tool'|'done'|'error', text})
  class NativeBrain {
    constructor(bridge) {
      this.bridge = bridge;
      this.pending = new Map();
      this.seq = 0;
      root.protogenBrain = (ev) => {
        const p = this.pending.get(ev.id);
        if (!p) return;
        if (ev.type === 'token') { p.full += ev.text; p.onToken && p.onToken(ev.text); }
        else if (ev.type === 'tool') p.onTool && p.onTool(ev.text);
        else if (ev.type === 'done') { this.pending.delete(ev.id); p.resolve(p.full); }
        else if (ev.type === 'error') { this.pending.delete(ev.id); p.reject(new Error(ev.text)); }
      };
    }
    get label() { return 'LLM · ' + (this.bridge.modelName ? this.bridge.modelName() : 'LOCAL'); }

    ask(messages, { onToken, onTool, signal } = {}) {
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onToken, onTool, full: '' });
        if (signal) signal.addEventListener('abort', () => {
          this.bridge.cancel(id);
          this.pending.delete(id);
          reject(new DOMException('abort', 'AbortError'));
        });
        this.bridge.ask(id, JSON.stringify([{ role: 'system', content: SYSTEM_PROMPT }, ...messages]));
      });
    }
  }

  function createBrain() {
    const nat = root.ProtogenNative;
    if (nat && nat.hasBrain && nat.hasBrain()) return new NativeBrain(nat);
    const params = new URLSearchParams(location.search);
    let url = params.get('llm');
    try { if (!url) url = localStorage.getItem('protogen.llm'); } catch (e) { /* sem storage */ }
    if (url) return new OpenAIBrain(url, params.get('model'));
    return new MockBrain();
  }

  root.Brain = { createBrain, MockBrain, OpenAIBrain, NativeBrain, SYSTEM_PROMPT };
})(window);
