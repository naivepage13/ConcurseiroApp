/* Estrutura os comentários das questões: justificativa da correta, motivo de cada errada, o que estudar. */
(function (root) {
  'use strict';
  const UP = 'A-ZÁÉÍÓÚÂÊÔÃÕÇ';
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();

  // Último limite de frase: ponto + espaço + maiúscula (ignora "art. 5º", "nº 8.072" etc.)
  function lastBoundary(s) {
    const re = new RegExp('[.!?”"\\)]\\s+(?=[' + UP + '“"])', 'g'); let m, last = -1;
    while ((m = re.exec(s))) {
      const before = s.slice(0, m.index + 1);
      if (/(?:\bart|\barts|\bnº|\bn|\binc|\bpar|\bp|\bcf|\bex|\bobs)\.$/i.test(before)) continue;
      last = m.index + 1;
    }
    return last;
  }


  const STOP = new Set('para pela pelo pelos pelas como mais menos entre sobre sendo sendo quando onde cujo cuja caso mesmo mesma seus suas desde ainda apenas somente qualquer todos todas outro outra cada tambem porem assim essa esse esta este isso aquele'.split(' '));
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function toks(s) { const set = new Set(); (norm(s).match(/[a-z0-9]{3,}/g) || []).forEach(w => { if (!STOP.has(w)) set.add(w.length > 5 ? w.slice(0, 5) : w); }); return set; }
  function overlap(a, b) { let n = 0; a.forEach(w => { if (b.has(w)) n++; }); return n / Math.sqrt((a.size || 1) * (b.size || 1)); }
  function perms(n) { if (n <= 1) return [[0].slice(0, n)]; const out = []; (function rec(cur, rest) { if (!rest.length) { out.push(cur); return; } rest.forEach((x, i) => rec(cur.concat(x), rest.filter((_, j) => j !== i))); })([], [...Array(n).keys()]); return out; }
  // associa cada alternativa errada ao trecho do comentário que a descreve (maior sobreposição de termos)
  function assign(clauses, alts) {
    const n = alts.length; if (n !== clauses.length || n > 5) return null;
    const A = alts.map(toks), C = clauses.map(toks);
    const S = A.map(a => C.map(c => overlap(a, c)));
    let best = -1, second = -1, bestP = null;
    perms(n).forEach(pm => { const sc = pm.reduce((s, ci, ai) => s + S[ai][ci], 0); if (sc > best) { second = best; best = sc; bestP = pm; } else if (sc > second) second = sc; });
    const minPair = Math.min(...bestP.map((ci, ai) => S[ai][ci]));
    if (minPair < 0.12 || best - second < 0.06) return null;
    return bestP;
  }

  function parseLei(expl) { // formato "Alternativa correta: … Fundamento: … Comentário: … Erros das demais: … PEGADINHA: …"
    const idx = k => expl.indexOf(k);
    const keys = ['Alternativa correta:', 'Fundamento:', 'Comentário:', 'Erros das demais:', 'PEGADINHA:'];
    const pos = keys.map(idx);
    if (pos[0] < 0 || pos[1] < 0) return null;
    const get = i => { if (pos[i] < 0) return ''; const nxt = pos.filter(p => p > pos[i]).sort((a, b) => a - b)[0]; return clean(expl.slice(pos[i] + keys[i].length, nxt === undefined ? undefined : nxt)); };
    const wrongTxt = get(3), wrong = {};
    if (wrongTxt) {
      wrongTxt.split(/;\s+|\.\s+(?=[a-e]\))/).forEach(cl => {
        const m = cl.match(/^((?:[a-e]\)(?:,\s*|\s+e\s+|\s*))+)(.*)$/);
        if (!m) return;
        const letters = (m[1].match(/[a-e]/g) || []).map(x => x.toUpperCase());
        letters.forEach(L => { wrong[L] = cap(clean(m[2]).replace(/\.$/, '') + '.'); });
      });
    }
    return { fundamento: get(1), why: get(2), wrong: Object.keys(wrong).length ? wrong : null, wrongRaw: wrongTxt, pegadinha: get(4), corretaTxt: get(0) };
  }

  function explain(q) {
    const out = { why: '', wrong: null, rest: '', pegadinha: '', fundamento: '', has: !!(q && q.expl) };
    if (!q || !q.expl) return out;
    const expl = q.expl;
    if (/Alternativa correta:/.test(expl) && /Fundamento:/.test(expl)) {
      const p = parseLei(expl);
      if (p) { out.fundamento = p.fundamento; out.why = p.why; out.wrong = p.wrong; out.rest = p.wrong ? '' : p.wrongRaw; out.pegadinha = p.pegadinha; out.src = expl; return out; }
    }
    const wrongLetters = Object.keys(q.alts).sort().filter(l => l !== q.gab);
    const parts = expl.split(/;\s+/);
    if (parts.length === wrongLetters.length) {
      const b = lastBoundary(parts[0]);
      if (b > 0) {
        out.why = clean(parts[0].slice(0, b));
        const clauses = [parts[0].slice(b)].concat(parts.slice(1)).map(c => cap(clean(c).replace(/^e\s+/i, '')));
        const asg = assign(clauses, wrongLetters.map(l => q.alts[l]));
        if (asg) { out.wrong = {}; wrongLetters.forEach((l, i) => out.wrong[l] = clauses[asg[i]]); return out; }
        out.rest = clauses.join('; ') ; out.clauses = clauses; return out;
      }
    }
    // fallback: primeira frase = justificativa, resto = análise geral
    const b = lastBoundary(parts.length > 1 ? parts[0] : expl);
    const firstEnd = (function () { const re = new RegExp('[.!?]\\s+(?=[' + UP + '“"])', 'g'); let m; while ((m = re.exec(expl))) { if (!/(?:\bart|\barts|\bnº|\binc)\.$/i.test(expl.slice(0, m.index + 1))) return m.index + 1; } return -1; })();
    if (firstEnd > 0) { out.why = clean(expl.slice(0, firstEnd)); out.rest = clean(expl.slice(firstEnd)); } else out.why = clean(expl);
    return out;
  }

  const LAW = /(Lei Complementar(?: Estadual| Federal)? nº [\d.]+\/\d{4}|Lei(?: Estadual| Federal)? nº [\d.]+\/\d{4}|LC nº [\d.]+\/\d{4}|Decreto(?: Estadual| Federal)?(?:-Lei)? nº [\d.]+\/\d{4}|Súmula Vinculante \d+|Súmula \d+(?: do (?:STJ|STF))?|Código Penal Militar|Código de Processo Penal|Código de Trânsito Brasileiro|Código Penal|Constituição Federal|Constituição (?:do Estado de Santa Catarina|catarinense)|Estatuto do Desarmamento|Estatuto da Pessoa Idosa|Estatuto dos Policiais[- ]Militares|\bECA\b|\bCPM\b|\bCPP\b|\bCTB\b|\bCP\b|\bCF\b|\bLGPD\b)/g;
  const ART = /\bart(?:s)?\.\s*\d+[ºo]?(?:-[A-Z])?(?:\s*(?:,|e|a)\s*\d+[ºo]?)*(?:,\s*(?:§\s*\d+[ºo]?|parágrafo único|[IVXL]+(?:-[A-Z])?)(?:,\s*[IVXL]+)?(?:,\s*[“"][a-z][”"])?)?/g;
  function study(q) {
    const t = (q.expl || '');
    const laws = [...new Set((t.match(LAW) || []).map(x => x.trim()))].slice(0, 6);
    const arts = [...new Set((t.match(ART) || []).map(x => x.replace(/\s+/g, ' ').trim()))].slice(0, 12);
    return { laws, arts };
  }

  const api = { explain, study };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Explain = api;
})(typeof window !== 'undefined' ? window : globalThis);
