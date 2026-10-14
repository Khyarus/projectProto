// Conversor grosseiro de português (BR) para fonemas do SAM.
// O SAM só conhece fonemas do inglês; aqui aproximamos o PT-BR com eles.
// Saída: string fonética pronta para `new SamJs().buf32(str, true)`.
(function (root) {
  'use strict';

  const VOWELS = 'aeiouáéíóúâêôãõàü';
  const ACCENTED = 'áéíóúâêôãõ';
  const FRONT = 'eiéêí';
  // Monossílabos átonos: não recebem acento tônico.
  const CLITICS = new Set(['o', 'a', 'os', 'as', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
    'nos', 'nas', 'um', 'uns', 'que', 'se', 'me', 'te', 'lhe', 'com', 'por', 'sem', 'mas', 'ou']);

  const isVowel = (c) => !!c && VOWELS.includes(c);

  // ---------- números por extenso ----------
  const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
    'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
    'setecentos', 'oitocentos', 'novecentos'];

  function below1000(n) {
    if (n === 100) return 'cem';
    const parts = [];
    if (n >= 100) { parts.push(HUNDREDS[Math.floor(n / 100)]); n %= 100; }
    if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) parts.push(UNITS[n]); }
    else if (n > 0) parts.push(UNITS[n]);
    return parts.join(' e ');
  }

  function numberToWords(n) {
    if (n === 0) return 'zero';
    if (n >= 1e9) return String(n).split('').map((d) => UNITS[+d]).join(' ');
    const out = [];
    const mi = Math.floor(n / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000;
    if (mi) out.push(mi === 1 ? 'um milhão' : below1000(mi) + ' milhões');
    if (th) out.push(th === 1 ? 'mil' : below1000(th) + ' mil');
    if (rest) out.push(below1000(rest));
    return out.join(' e ');
  }

  function expandNumbers(text) {
    return text
      .replace(/(\d+)[.,](\d+)/g, (_, a, b) => `${a} vírgula ${b}`)
      .replace(/(\d+)\s*%/g, '$1 por cento')
      .replace(/(\d+)\s*°\s*c?/gi, '$1 graus')
      .replace(/\d+/g, (m) => ' ' + numberToWords(parseInt(m, 10)) + ' ');
  }

  // ---------- sílaba tônica ----------
  // Índices das vogais "núcleo" (primeira vogal de cada grupo vocálico, aproximação).
  function nuclei(w) {
    const idx = [];
    for (let i = 0; i < w.length; i++) {
      if (!isVowel(w[i])) continue;
      // "qu"/"gu" + vogal: o u não é núcleo
      if (w[i] === 'u' && (w[i - 1] === 'q' || w[i - 1] === 'g') && isVowel(w[i + 1])) continue;
      if (i > 0 && isVowel(w[i - 1]) && idx.length && idx[idx.length - 1] === i - 1) {
        // ditongos decrescentes (ai, ei, oi, au, eu...) ficam no mesmo núcleo
        if ('iu'.includes(w[i]) && !ACCENTED.includes(w[i])) continue;
      }
      idx.push(i);
    }
    return idx;
  }

  function stressIndex(w) {
    for (let i = 0; i < w.length; i++) if (ACCENTED.includes(w[i])) return i;
    const nuc = nuclei(w);
    if (nuc.length === 0) return -1;
    if (nuc.length === 1) return CLITICS.has(w) ? -1 : nuc[0];
    // Paroxítona por padrão quando termina em a/e/o(s), em/ens, am
    if (/([aeo]s?|em|ens|am)$/.test(w)) return nuc[nuc.length - 2];
    return nuc[nuc.length - 1];
  }

  // ---------- timbre do e/o tônico (aberto é/ó x fechado ê/ô) ----------
  // A escrita não marca o timbre; reescrevemos palavras comuns com o acento certo.
  const RESPELL = {
    // e aberto
    ela: 'éla', elas: 'élas', aquela: 'aquéla', aquelas: 'aquélas', essa: 'éssa', esta: 'ésta',
    certo: 'cérto', certa: 'cérta', perto: 'pérto', festa: 'fésta', terra: 'térra', guerra: 'guérra',
    sete: 'séte', dez: 'déz', neve: 'néve', pedra: 'pédra', velho: 'vélho', velha: 'vélha',
    era: 'éra', eram: 'éram', meta: 'méta', reta: 'réta', quero: 'quéro', quer: 'quér',
    espera: 'espéra', aberto: 'abérto', aberta: 'abérta', ferro: 'férro', erro: 'êrro', erros: 'érros',
    serie: 'séri', regra: 'régra', perna: 'pérna', inverno: 'invérno', moderno: 'modérno',
    // e fechado
    ele: 'êle', eles: 'êles', aquele: 'aquêle', aqueles: 'aquêles', esse: 'êsse', este: 'êste',
    isso: 'isso', mesa: 'mêsa', medo: 'mêdo', cedo: 'cêdo', dedo: 'dêdo', mesmo: 'mêsmo',
    mesma: 'mêsma', seco: 'sêco', preto: 'prêto', vermelho: 'vermêlho', verde: 'vêrde',
    cabeça: 'cabêça', começo: 'comêço', desejo: 'desêjo', sistema: 'sistêma', problema: 'problêma',
    tema: 'têma', cerca: 'cêrca', peso: 'pêso', porque: 'purquê',
    // o aberto
    pode: 'póde', podem: 'pódem', posso: 'pósso', hora: 'hóra', horas: 'hóras', agora: 'agóra',
    nossa: 'nóssa', nosso: 'nósso', nota: 'nóta', porta: 'pórta', forte: 'fórte', sol: 'sól',
    bola: 'bóla', loja: 'lója', moda: 'móda', roda: 'róda', nove: 'nóve', nova: 'nóva',
    logo: 'lógo', obra: 'óbra', jogos: 'jógos', olhos: 'ólhos', gosta: 'gósta', forma: 'fórma',
    escola: 'escóla', embora: 'embóra', fora: 'fóra', mora: 'móra', ótimo: 'ótimo', proto: 'próto',
    protogen: 'prótogen', robo: 'robô', sobre: 'sôbre', globo: 'glôbo', relógio: 'relógio',
    // o fechado
    novo: 'nôvo', hoje: 'hôje', ontem: 'ôntem', jogo: 'jôgo', fogo: 'fôgo', corpo: 'côrpo',
    povo: 'pôvo', todo: 'tôdo', toda: 'tôda', todos: 'tôdos', todas: 'tôdas', como: 'cômo',
    onde: 'ônde', ovo: 'ôvo', olho: 'ôlho', boa: 'bôa', gosto: 'gôsto', senhor: 'senhôr',
    amor: 'amôr', maior: 'maiór', melhor: 'melhór', pior: 'piór', ser: 'sêr', ter: 'têr', ver: 'vêr', ler: 'lêr', calor: 'calôr', favor: 'favôr', cor: 'côr', flor: 'flôr', avô: 'avô',
  };

  // Sufixos regulares (só se a palavra não tem acento gráfico)
  const SUFFIX_RULES = [
    [/eza$/, 'êza'], [/esa$/, 'êsa'], [/ela$/, 'éla'], [/elas$/, 'élas'], [/ema$/, 'êma'],
    [/oso$/, 'ôso'], [/osos$/, 'ósos'], [/osa$/, 'ósa'], [/osas$/, 'ósas'],
    [/ola$/, 'óla'], [/olas$/, 'ólas'], [/ora$/, 'óra'], [/oras$/, 'óras'],
    [/ota$/, 'óta'], [/ote$/, 'óte'], [/er$/, 'êr'],
    [/or$/, 'ôr'], [/ores$/, 'ôres'],
  ];

  function respell(w) {
    if (RESPELL[w]) return RESPELL[w];
    if ([...w].some((c) => ACCENTED.includes(c))) return w;
    for (const [re, rep] of SUFFIX_RULES) if (re.test(w) && w.length > 3) return w.replace(re, rep);
    return w;
  }

  // ---------- palavra -> fonemas ----------
  function wordToSam(w) {
    w = respell(w);
    const stress = stressIndex(w);
    const out = [];
    const n = w.length;
    // "e" / "o" finais átonos viram i / u
    const finalUnstressed = (i) => {
      const tail = w.slice(i + 1);
      return (tail === '' || tail === 's') && i !== stress;
    };
    const mark = (i, ph) => out.push(i === stress ? ph + '4' : ph);
    // vogal seguida de m/n + consoante ou fim => nasal
    const nasalAfter = (i) => {
      const c = w[i + 1];
      if (c !== 'm' && c !== 'n') return false;
      const d = w[i + 2];
      return !d || (!isVowel(d) && d !== 'h');
    };

    for (let i = 0; i < n; i++) {
      const c = w[i], nx = w[i + 1], prev = w[i - 1];

      // ----- vogais -----
      if (isVowel(c)) {
        if (c === 'u' && (prev === 'q' || prev === 'g') && isVowel(nx)) continue; // tratado na consoante
        if ((c === 'ã' || c === 'a') && nx === 'o' && (c === 'ã' || i + 2 >= n)) { mark(i, 'AW'); out.push('N'); i++; continue; }
        if (c === 'ã' && nx === 'e') { mark(i, 'AY'); out.push('N'); i++; continue; }
        if (c === 'õ' && nx === 'e') { mark(i, 'OY'); out.push('N'); i++; continue; }
        if (c === 'e' && nx === 'm' && i + 2 >= n) { mark(i, 'EY'); out.push('N'); i++; continue; }
        if (c === 'a' && nx === 'm' && i + 2 >= n) { mark(i, 'AW'); out.push('N'); i++; continue; }
        // ditongos decrescentes: ai, ei, oi, au, ou
        const dip = { ai: 'AY', ei: 'EY', éi: 'EY', oi: 'OY', ói: 'OY', au: 'AW', ou: 'OW' }[c + (nx || '')];
        if (dip && !isVowel(w[i + 2]) && !nasalAfter(i + 1)) { mark(i, dip); i++; continue; }

        let ph;
        switch (c) {
          case 'a': case 'á': case 'à': ph = 'AA'; break;
          case 'â': case 'ã': ph = 'AH'; break;
          case 'é': ph = 'EH'; break;
          case 'ê': ph = 'EY'; break;
          case 'e': ph = (n === 1 || finalUnstressed(i)) ? 'IY' : 'EH'; break;
          case 'i': case 'í': ph = 'IY'; break;
          case 'ó': ph = 'AO'; break;
          case 'ô': case 'õ': ph = 'OW'; break;
          case 'o': ph = (n === 1 || finalUnstressed(i)) ? 'UW' : 'OH'; break;
          case 'u': case 'ú': case 'ü': ph = 'UW'; break;
        }
        mark(i, ph);
        if (c === 'ã' || c === 'õ') out.push('N');
        if (nasalAfter(i)) { out.push(w[i + 2] === 'p' || w[i + 2] === 'b' ? 'M' : 'N'); i++; }
        continue;
      }

      // ----- dígrafos -----
      if (c === 'c' && nx === 'h') { out.push('SH'); i++; continue; }
      if (c === 'l' && nx === 'h') { out.push('LY'); i++; continue; }
      if (c === 'n' && nx === 'h') { out.push('NY'); i++; continue; }
      if (c === 'r' && nx === 'r') { out.push('/H'); i++; continue; }
      if (c === 's' && nx === 's') { out.push('S'); i++; continue; }
      if ((c === 's' || c === 'x') && nx === 'c' && FRONT.includes(w[i + 2] || '')) { out.push('S'); i++; continue; }
      if (c === 'q' && nx === 'u') {
        if (FRONT.includes(w[i + 2] || '')) out.push('K'); else out.push('K', 'W');
        i++; continue;
      }
      if (c === 'g' && nx === 'u' && FRONT.includes(w[i + 2] || '')) { out.push('G'); i++; continue; }

      // ----- consoantes -----
      const beforeI = nx === 'i' || nx === 'í' || (nx === 'e' && finalUnstressed(i + 1));
      switch (c) {
        case 'b': out.push('B'); break;
        case 'c': out.push(FRONT.includes(nx || '') ? 'S' : 'K'); break;
        case 'ç': out.push('S'); break;
        case 'd': out.push(beforeI ? 'J' : 'D'); break;
        case 'f': out.push('F'); break;
        case 'g': out.push(FRONT.includes(nx || '') ? 'ZH' : 'G'); break;
        case 'h': break;
        case 'j': out.push('ZH'); break;
        case 'k': out.push('K'); break;
        case 'l': out.push(isVowel(nx) ? 'L' : 'W'); break;
        case 'm': out.push('M'); break;
        case 'n': out.push('N'); break;
        case 'p': out.push('P'); break;
        case 'r':
          if (i === 0 || 'nls'.includes(prev)) out.push('/H');
          else if (isVowel(prev) && isVowel(nx)) out.push('DX');
          else out.push('R');
          break;
        case 's':
          if (i > 0 && isVowel(prev) && isVowel(nx)) out.push('Z'); else out.push('S');
          break;
        case 't': out.push(beforeI ? 'CH' : 'T'); break;
        case 'v': out.push('V'); break;
        case 'w': out.push('W'); break;
        case 'x':
          if (prev === 'e' && i === 1 && isVowel(nx)) out.push('Z'); else out.push('SH');
          break;
        case 'y': out.push(i === stress ? 'IY4' : 'IY'); break;
        case 'z': out.push(i === n - 1 ? 'S' : 'Z'); break;
      }
    }
    // Sem espaço dentro da palavra: no SAM espaço é pausa.
    return out.join('');
  }

  // ---------- texto -> lista de frases fonéticas ----------
  // O SAM tem limite de ~255 fonemas por chamada, então quebramos em frases curtas.
  const MAX_CHUNK = 180;

  function toSam(text) {
    let t = String(text)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#`>~|\[\]{}()"“”«»]/g, ' ')
      .replace(/https?:\/\/\S+/g, ' link ');
    t = expandNumbers(t).toLowerCase();

    const chunks = [];
    let cur = '';
    const flush = (punct) => {
      const s = cur.trim();
      if (s) chunks.push(s + (punct || '.'));
      cur = '';
    };

    const tokens = t.match(/[a-zà-ÿ]+|[.!?;:,\n-]/g) || [];
    for (const tok of tokens) {
      if (/^[.!?;:\n]$/.test(tok)) { flush(tok === '?' ? '?' : '.'); continue; }
      if (tok === ',' || tok === '-') { if (cur.trim()) cur += ', '; continue; }
      const ph = wordToSam(tok);
      if (!ph) continue;
      if (cur.length + ph.length + 1 > MAX_CHUNK) flush(',');
      cur += ph + ' ';
    }
    flush('.');
    return chunks.map((c) => c.replace(/\s+/g, ' ').replace(/ ([,.?])/g, '$1'));
  }

  const api = { toSam, wordToSam, numberToWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PtSam = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
