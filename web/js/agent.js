// Agente: decide por regras se a pergunta precisa de dados da internet (clima, notícias, busca),
// busca pelo app Android e devolve um texto curto para ir junto da pergunta ao modelo.
// Regras em vez de "function calling": um modelo de 3B no celular erra muito para escolher
// ferramentas, e cada passada extra custa ~10 s.
(function (root) {
  'use strict';

  const WEATHER = /\b(clima|previs[aã]o( do tempo)?|tempo (hoje|amanh[aã]|agora|l[aá] fora)|vai chover|chover|chovendo|chuva|temperatura|calor|frio|quantos graus|umidade)\b/i;
  const NEWS = /\b(not[ií]cias?|manchetes?|aconteceu (hoje|no mundo|no brasil))\b/i;
  const SEARCH_EXPLICIT = /\b(pesquis\w*|procur\w*|busc\w*|googl\w*)\b(?:\s+(?:sobre|por|pra mim|para mim|na internet|na web))*\s*(.*)$/i;
  const SEARCH_IMPLICIT = /\b(quem (é|e|foi|ganhou|venceu|é o|é a)|o que (é|foi|aconteceu|significa)|quando (é|foi|será|vai|começa)|quanto (custa|está|vale|tá)|cota[cç][aã]o|d[oó]lar|euro|bitcoin|resultado|placar|jogo d[oe]|lan[cç]amento|presidente|elei[cç][aã]o|campe[aã]o)\b/i;
  const ABOUT_SELF = /\b(voc[eê]|vc|tu|proto|seu nome|te chama)\b/i;

  // cidade citada na pergunta: "clima em porto alegre", "vai chover no rio de janeiro amanhã"
  function cityIn(text) {
    const m = text.match(/\b(?:em|no|na|para|pra)\s+([a-zà-ú][a-zà-ú\s'-]{2,40}?)\s*(?:\?|\.|,|$|\s(?:hoje|amanh[aã]|agora|essa|esta|nessa|nesta|semana))/i);
    if (!m) return '';
    const c = m[1].trim();
    return /^(casa|tempo|clima|hoje|agora|rua|semana)$/i.test(c) ? '' : c;
  }

  function plan(text, profile) {
    const steps = [];
    const t = text.trim();
    if (WEATHER.test(t)) {
      const city = cityIn(t) || profile.local || '';
      steps.push({ tool: 'weather', arg: city, label: 'clima' + (city ? ': ' + city : '') });
    }
    if (NEWS.test(t)) {
      const m = t.match(/\bnot[ií]cias?\s+(?:sobre|de|do|da)\s+(.+?)[?.!]*$/i);
      steps.push({ tool: 'news', arg: m ? m[1] : '', label: 'notícias' + (m ? ': ' + m[1] : '') });
    }
    if (!steps.length) {
      const ex = t.match(SEARCH_EXPLICIT);
      if (ex && ex[2].trim()) steps.push({ tool: 'search', arg: ex[2].replace(/[?!.]+$/, ''), label: 'busca: ' + ex[2] });
      else if (SEARCH_IMPLICIT.test(t) && !ABOUT_SELF.test(t)) {
        steps.push({ tool: 'search', arg: t.replace(/[?!.]+$/, ''), label: 'busca: ' + t });
      }
    }
    return steps;
  }

  // ---- chamada assíncrona ao Kotlin: ProtogenNative.tool(id, nome, arg) -> window.protogenTool({id, ok, text}) ----
  const pending = new Map();
  let seq = 0;
  root.protogenTool = (ev) => {
    const p = pending.get(ev.id);
    if (!p) return;
    pending.delete(ev.id);
    if (ev.ok) p.resolve(ev.text); else p.reject(new Error(ev.text));
  };

  function run(step) {
    const nat = root.ProtogenNative;
    if (!nat || !nat.tool) return Promise.resolve('');
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      nat.tool(id, step.tool, step.arg);
      setTimeout(() => { if (pending.delete(id)) reject(new Error('tempo esgotado')); }, 15000);
    });
  }

  root.Agent = { plan, run, available: () => !!(root.ProtogenNative && root.ProtogenNative.tool) };
})(window);
