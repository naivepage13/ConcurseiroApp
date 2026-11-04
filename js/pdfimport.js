/* Importação de simulados a partir de PDF (roda no navegador, com pdf.js). */
(function (root) {
  'use strict';
  const PDFJS_URL = 'vendor/pdf.min.js';
  const PDFJS_WORKER = 'vendor/pdf.worker.min.js';

  function loadScript(url) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('Sem internet para carregar o leitor de PDF.')); document.head.appendChild(s); });
  }
  async function pdfjs() {
    if (!root.pdfjsLib) await loadScript(PDFJS_URL);
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return root.pdfjsLib;
  }

  const clean = s => (s || '').replace(/­/g, '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/\s+/g, ' ').trim();

  /* Lê um PDF e devolve, por página, as linhas já separadas por coluna, em ordem de leitura. */
  async function readPdf(buf) {
    const lib = await pdfjs();
    // isEvalSupported:false = mitigação oficial da falha CVE-2024-4367 do pdf.js 3.x (PDF malicioso executando código)
    const doc = await lib.getDocument({ data: buf.slice(0), isEvalSupported: false, verbosity: 0, enableXfa: false, disableFontFace: false, useSystemFonts: false, stopAtErrors: false }).promise;
    if (doc.numPages > 400) throw new Error('PDF com páginas demais (limite: 400).');
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str && i.str.trim() !== '').map(i => ({ s: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height }));
      const two = items.filter(i => i.x >= 305 && i.x <= 314).length >= 6 && items.filter(i => i.x >= 44 && i.x <= 52).length >= 6;
      const cols = [[], []];
      items.forEach(it => { cols[two && it.x >= 304 ? 1 : 0].push(it); });
      const lines = [];
      cols.forEach((c, ci) => {
        c.sort((a, b) => a.y - b.y || a.x - b.x);
        let cur = null;
        c.forEach(it => {
          if (cur && Math.abs(it.y - cur.y) < 2.5) { cur.items.push(it); } else { cur = { y: it.y, items: [it] }; lines.push({ col: ci, line: cur }); }
        });
      });
      const out = [];
      [0, 1].forEach(ci => lines.filter(l => l.col === ci).forEach(({ line }) => {
        line.items.sort((a, b) => a.x - b.x);
        let t = '', prev = null;
        line.items.forEach(it => { if (prev && it.x - (prev.x + prev.w) > 1.2 && !/\s$/.test(t) && !/^\s/.test(it.s)) t += ' '; t += it.s; prev = it; });
        out.push({ page: p, x: line.items[0].x, y: line.y, h: Math.max(...line.items.map(i => i.h)), text: clean(t) });
      }));
      // se a página tem linha única atravessando (ex.: capa, redação), mantém a ordem por y quando só há uma coluna usada
      if (!lines.some(l => l.col === 1)) out.sort((a, b) => a.y - b.y);
      pages.push(out.filter(l => l.text));
    }
    // remove cabeçalhos/rodapés repetidos em várias páginas
    const key = l => l.text.replace(/\d+/g, '#'), edge = l => l.y < 75 || l.y > 770, cnt = {};
    pages.forEach(pg => new Set(pg.filter(edge).map(key)).forEach(k => { cnt[k] = (cnt[k] || 0) + 1; }));
    const thr = Math.max(2, Math.ceil(pages.length * 0.5));
    const freq = Object.keys(cnt).filter(k => cnt[k] >= thr && k.length >= 8);
    return pages.map(pg => pg.filter(l => !(edge(l) && (cnt[key(l)] >= thr || freq.some(k => key(l).includes(k))))));
  }

  /* ---------- classificação de assunto (mesma lógica do banco-base) ---------- */
  const DISC_BY_POS = (n) => n <= 8 ? 'Língua Portuguesa' : n <= 13 ? 'Informática' : n <= 21 ? 'Direito Constitucional' : n <= 27 ? 'Direito Penal Comum' : n <= 33 ? 'Direito Processual Penal Comum' : n <= 39 ? 'Direito Penal Militar' : n <= 45 ? 'Legislação Especial' : n <= 50 ? 'Legislação de Trânsito' : 'Legislação Institucional';
  const POS = root.PM_POS || {};
  function assuntoRota(q, total, expl) {
    const s = q.stem.toLowerCase(), d = q.disc;
    if (d === 'Língua Portuguesa') {
      for (const [pat, name] of [[/compreens|interpreta/, 'Interpretação de texto'], [/g[êe]nero|tipologia/, 'Gênero e tipologia textual'], [/sintaxe|ora[çc][ãa]o e do per|considerando o trecho/, 'Sintaxe'], [/estrutura, [àa] forma|acentua|ortografia|forma[çc][ãa]o das palavras/, 'Ortografia, acentuação e morfologia'], [/significa[çc][ãa]o|sem[âa]ntic|sentido semelhante|constitui exemplo/, 'Semântica e figuras de linguagem'], [/concord|reg[êe]ncia|crase/, 'Concordância, regência e crase'], [/pontua|v[íi]rgula/, 'Pontuação e reescrita'], [/coes[ãa]o|classes de palavras|rela[çc][ãa]o de sentido|voc[áa]bulo .que./, 'Coesão e classes de palavras']]) if (pat.test(s)) return name;
      return 'Língua Portuguesa (outros)';
    }
    if (d === 'Informática') {
      for (const [pat, name] of [[/hardware/, 'Hardware e software'], [/libreoffice|calc|writer|planilha/, 'LibreOffice (Calc/Writer)'], [/windows/, 'Windows 11'], [/navegador|correio|nuvem|lgpd/, 'Navegadores, e-mail, nuvem e LGPD'], [/seguran|v[íi]rus|antiv/, 'Segurança da informação e malware']]) if (pat.test(s)) return name;
      return 'Informática (outros)';
    }
    if (d === 'Direito Penal Militar' && (q.n === 38 || q.n === 39) && expl) {
      const first = expl.split(/(?<=[a-zçãõáéíóú)])\.\s+(?=[A-ZÁÉÍÓÚ])/)[0].toLowerCase();
      const aut = first.search(/motim|revolta|insubordin|desrespeit|recusa de obedi|viol[êe]ncia contra (?:superior|inferior|militar|oficial)|reuni[ãa]o il[íi]cita|conspira|ofensa|resist[êe]ncia|oposi[çc][ãa]o|assuada/);
      const srv = first.search(/abandono|dormir em servi|desers|insubmiss|embriaguez em servi|omiss[ãa]o de|servi[çc]o militar|dever militar|patrim|furto|roubo|peculato|corrup|homic|les[ãa]o|desacato/);
      if (aut >= 0 && (srv < 0 || aut <= srv)) return 'CPM: crimes contra a autoridade ou disciplina militar';
      if (srv >= 0) return 'CPM: crimes contra o serviço e o dever militar e outros';
    }
    if (total === 60 && POS[q.n] && DISC_BY_POS(q.n) === d) return POS[q.n];
    return d;
  }

  /* ---------- formato "Rota Sul" (caderno com gabarito ao final) ---------- */
  const DISC_RE = /^(Língua Portuguesa|Informática|Direito [A-Za-zÀ-ú ]{3,40}|Legislação [A-Za-zÀ-ú ]{3,30}|Matemática|Raciocínio Lógico|Conhecimentos [A-Za-zÀ-ú ]{3,30}|Atualidades|Ética[A-Za-zÀ-ú ]{0,30})$/;
  const isHeading = t => t.length < 48 && !/[.?:;()\d]/.test(t) && t.split(' ').length <= 5 && DISC_RE.test(t);

  function paragraphs(lines) { // texto de apoio: junta linhas; novo parágrafo em recuo
    const out = []; let cur = '';
    lines.forEach(l => { if (l.indent && cur) { out.push(cur); cur = ''; } cur = (cur + ' ' + l.text).trim(); });
    if (cur) out.push(cur); return out;
  }

  function parseRota(pages, name) {
    const L = []; pages.forEach((pg, i) => { if (i >= 1) pg.forEach(l => L.push(l)); }); // pula a capa
    const gabIdx = L.findIndex(l => /^Gabarito Comentado/i.test(l.text) || /^GABARITO$/.test(l.text));
    const qLines = gabIdx >= 0 ? L.slice(0, gabIdx) : L;
    const gLines = gabIdx >= 0 ? L.slice(gabIdx) : [];
    const redIdx = qLines.findIndex(l => l.text === 'Redação');
    const body = redIdx >= 0 ? qLines.slice(0, redIdx) : qLines;

    const qs = []; let cur = null, section = null, expect = 1, supp = [], seenE = false, suppDisc = null, hasSupp = false;
    const bodyH = (() => { const hs = body.map(l => Math.round(l.h * 2) / 2); const f = {}; hs.forEach(h => f[h] = (f[h] || 0) + 1); return +Object.keys(f).sort((a, b) => f[b] - f[a])[0] || 10; })();
    let minX = {};
    body.forEach(l => { const c = l.x > 297 ? 1 : 0; minX[c] = Math.min(minX[c] == null ? 1e9 : minX[c], l.x); });
    body.forEach((l, li) => {
      let t = l.text;
      const nx = body[li + 1];
      if (/^Direito .*[^.]$/.test(t) && nx && /^(Comum|Militar|Especial)$/.test(nx.text) && !/(Comum|Militar|Especial)$/.test(t)) { l.merged = t + ' ' + nx.text; return; }
      if (li > 0 && body[li - 1].merged && /^(Comum|Militar|Especial)$/.test(t)) t = body[li - 1].merged;
      if (isHeading(t)) { section = t; cur = null; return; }
      if (/^\d{1,3}$/.test(t) && +t === expect && (expect === 1 || seenE)) { cur = { n: expect, disc: section, raw: [] }; qs.push(cur); expect++; seenE = false; return; }
      if (!cur) { if (qs.length === 0 && section) { const c = l.x > 297 ? 1 : 0; supp.push({ text: t, h: l.h, indent: l.x > minX[c] + 6 }); } return; }
      cur.raw.push(t); if (/\(E\)/.test(t)) seenE = true;
    });
    if (!qs.length) return null;
    qs.forEach(q => {
      const s = clean(q.raw.join(' ')); const parts = s.split(/\(([A-E])\)\s*/);
      q.stem = parts[0].trim(); q.alts = {}; for (let i = 1; i < parts.length - 1; i += 2) q.alts[parts[i]] = parts[i + 1].trim();
    });
    // texto de apoio (cabeçalho em fonte maior = título)
    let texts = {}, tid = null;
    if (supp.length) {
      const hi = supp.findIndex(l => /^\(?Texto /i.test(l.text));
      const head = hi >= 0 ? supp.slice(0, hi + 1).map(l => l.text) : [];
      const rest = hi >= 0 ? supp.slice(hi + 1) : supp;
      let title = head[0] || '', i = 1;
      while (i < head.length - 1 && i === 1 && /^[a-zà-ú]/.test(head[i]) && head[i].split(' ').length <= 2) title += ' ' + head[i++];
      const sub = clean(head.slice(i).join(' '));
      tid = 'txt1';
      texts[tid] = { title: clean(title), paras: (sub ? [sub] : []).concat(paragraphs(rest)) };
    }
    // gabarito
    const gab = {};
    const gt = gLines.map(l => l.text).join(' ');
    const ms = [...gt.matchAll(/Quest[ãa]o\s+(\d+)\s*[–-]\s*Alternativa\s+([A-E])/g)];
    if (ms.length) {
      ms.forEach((m, k) => {
        let ex = gt.slice(m.index + m[0].length, k + 1 < ms.length ? ms[k + 1].index : undefined);
        ex = ex.replace(/\s*(Língua Portuguesa|Informática|Direito [A-Za-zÀ-ú ]+?|Legislação [A-Za-zÀ-ú ]+?)\s*$/, '').trim();
        gab[+m[1]] = [m[2], ex.replace(/^[\s.]+/, '')];
      });
    } else {
      [...gt.matchAll(/(?:^|\s)(\d{1,3})\s+([A-E])(?=\s|$)/g)].forEach(m => { if (+m[1] >= 1 && +m[1] <= qs.length && !gab[+m[1]]) gab[+m[1]] = [m[2], '']; });
    }
    const total = qs.length;
    const out = [];
    const errors = [];
    qs.forEach(q => {
      if (Object.keys(q.alts).length < 4) { errors.push('Questão ' + q.n + ': alternativas não reconhecidas.'); return; }
      const g = gab[q.n]; if (!g) { errors.push('Questão ' + q.n + ': sem gabarito.'); return; }
      q.disc = q.disc || 'Geral';
      out.push({ n: q.n, disc: q.disc, assunto: assuntoRota(q, total, g[1]), stem: q.stem, alts: q.alts, gab: g[0], expl: g[1], texto: q.disc === 'Língua Portuguesa' && tid ? tid : null });
    });
    return out.length ? { questions: out, texts, errors } : null;
  }

  /* ---------- formato "VIP Preparatório" (caderno + gabarito comentado em PDFs separados) ---------- */
  const flat = pages => pages.map(pg => pg.map(l => l.text).join('\n')).join('\n');
  const isVipQ = txt => /QUESTÃO\s+\d+\.\s/.test(txt) && /(?:^|\s)a\)\s/.test(txt) && !/GABARITO:\s*[A-E]/.test(txt);
  const isVipG = txt => /QUESTÃO\s+\d+\s*[—–-]\s*GABARITO:\s*[A-E]/.test(txt);

  function parseVip(qpages, gpages) {
    let q = clean(flat(qpages).replace(/\n/g, ' '));
    const head = q.slice(0, 400);
    const title = (head.match(/SIMULADO\s*[—–-]\s*([^•]{5,90}?)(?=\s{0}Polícia|\s{0}Estatuto|\s*Pol[ií]cia|$)/i) || [])[1];
    q = q.replace(/VIP PREPARATÓRIO\s+Simulado · PMSC/g, ' ').replace(/VIP Preparatório · Simulado.*?Página \d+ de \d+/g, ' ');
    const assuntos = [];
    const dist = q.match(/DISTRIBUIÇÃO DOS ASSUNTOS\s+Assunto\s+Questões\s+(.*?)\s+QUESTÕES/);
    if (dist) [...dist[1].matchAll(/(.+?)\s+(\d+)\s+a\s+(\d+)(?=\s|$)/g)].forEach(m => assuntos.push({ nome: clean(m[1]), a: +m[2], b: +m[3] }));
    if (assuntos.length) assuntos[0].a = 1;
    const body = q.slice(q.indexOf('QUESTÕES') >= 0 ? q.indexOf('QUESTÕES') + 8 : 0);
    const parts = body.split(/QUESTÃO\s+(\d+)\.\s*/);
    const g = clean(flat(gpages).replace(/\n/g, ' '));
    const gm = {};
    const gparts = g.split(/QUESTÃO\s+(\d+)\s*[—–-]\s*GABARITO:\s*([A-E])\s*/);
    for (let i = 1; i < gparts.length - 2; i += 3) {
      let ex = gparts[i + 2].split('O QUE MAIS PESA NA PROVA')[0].replace(/VIP Preparatório — Gabarito.*$/, '').trim();
      gm[+gparts[i]] = [gparts[i + 1], ex];
    }
    const out = [], errors = [];
    for (let i = 1; i < parts.length - 1; i += 2) {
      const n = +parts[i]; const t = parts[i + 1];
      const m = t.search(/(?:^|\s)a\)\s/); if (m < 0) { errors.push('Questão ' + n + ': alternativas não reconhecidas.'); continue; }
      const stem = clean(t.slice(0, m)); const al = (' ' + t.slice(m)).split(/\s([a-e])\)\s/); const alts = {};
      for (let k = 1; k < al.length - 1; k += 2) alts[al[k].toUpperCase()] = clean(al[k + 1]);
      const gg = gm[n]; if (!gg || Object.keys(alts).length < 4) { errors.push('Questão ' + n + ': sem gabarito ou alternativas incompletas.'); continue; }
      const as = assuntos.find(x => n >= x.a && n <= x.b);
      out.push({ n, disc: 'Legislação Institucional', assunto: /6\.?218|Estatuto dos Policiais/i.test(head + title) ? 'Estatuto dos Policiais-Militares (Lei 6.218/1983)' : (title || 'Geral'), tema: as ? as.nome : undefined, stem, alts, gab: gg[0], expl: gg[1], texto: null });
    }
    return out.length ? { questions: out, texts: {}, errors, title: title ? 'Simulado — ' + clean(title) : 'Simulado importado' } : null;
  }

  /* ---------- API ---------- */
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

  // files: [{name, buf}] -> {pkgs:[{sim,texts,questions}], msgs:[...]}
  async function importPdfs(files) {
    const msgs = [], pkgs = [];
    const read = [];
    for (const f of files) {
      try { const pages = await readPdf(f.buf); read.push({ f, pages, txt: flat(pages) }); }
      catch (e) { msgs.push(f.name + ': não consegui abrir este PDF (' + (e.message || e) + ').'); }
    }
    const vq = read.filter(r => isVipQ(r.txt)), vg = read.filter(r => isVipG(r.txt));
    const used = new Set();
    for (const q of vq) {
      const g = vg.find(x => !used.has(x));
      if (!g) { msgs.push(q.f.name + ': este caderno precisa do PDF do gabarito comentado. Selecione os dois PDFs juntos.'); used.add(q); continue; }
      used.add(g); used.add(q);
      const r = parseVip(q.pages, g.pages);
      if (!r) { msgs.push(q.f.name + ': não encontrei questões neste PDF.'); continue; }
      const id = 'pdf-' + hash(r.questions.map(x => x.stem).join('|'));
      pkgs.push({ sim: { id, nome: r.title, fonte: 'PDF importado' }, texts: {}, questions: r.questions.map(x => ({ ...x, id: id + '-q' + String(x.n).padStart(2, '0'), sim: id })), errors: r.errors });
    }
    for (const g of vg) if (!used.has(g)) msgs.push(g.f.name + ': gabarito sem o caderno de questões correspondente. Selecione os dois PDFs juntos.');
    for (const r of read) {
      if (used.has(r)) continue;
      const parsed = parseRota(r.pages, r.f.name);
      if (!parsed) { msgs.push(r.f.name + ': não reconheci o formato deste PDF. Hoje o app lê os simulados no padrão Rota Sul (caderno com gabarito no final) e os da VIP Preparatório (caderno + gabarito comentado).'); continue; }
      const num = (r.f.name.match(/Simulado[_\s-]*(\d{1,2})[_\s-]/i) || [])[1];
      const id = num ? 's' + String(num).padStart(2, '0') : 'pdf-' + hash(parsed.questions.map(x => x.stem).join('|'));
      const nome = num ? 'Simulado ' + String(num).padStart(2, '0') + ' — AOCP PMSC Soldado QPPM' : r.f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
      const texts = {}; Object.keys(parsed.texts).forEach(k => texts[id + '-' + k] = parsed.texts[k]);
      pkgs.push({ sim: { id, nome, fonte: 'PDF importado' }, texts, questions: parsed.questions.map(x => ({ ...x, id: id + '-q' + String(x.n).padStart(2, '0'), sim: id, texto: x.texto ? id + '-' + x.texto : null })), errors: parsed.errors });
    }
    return { pkgs, msgs };
  }

  /* ---------- leitura do PDF de progresso (exportado pelo próprio app) ---------- */
  async function readProgressPdf(buf) {
    const pages = await readPdf(buf);
    const txt = pages.map(pg => pg.map(l => l.text).join('\n')).join('\n');
    const lines = txt.split('\n').map(s => s.trim()).filter(s => s.startsWith('§PM1|'));
    if (!lines.length) return null;
    const b64 = lines.map(s => s.slice(5).replace(/\s+/g, '')).join('');
    return b64;
  }

  root.PdfImport = { importPdfs, readProgressPdf, readPdf };
})(typeof window !== 'undefined' ? window : globalThis);
