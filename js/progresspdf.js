/* Gera o PDF de progresso (relatório legível + dados embutidos para reimportar depois). */
(function (root) {
  'use strict';
  const JSPDF_URL = 'vendor/jspdf.umd.min.js';
  const loadScript = url => new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('Sem internet para carregar o gerador de PDF.')); document.head.appendChild(s); });

  /* ---------- dados embutidos ---------- */
  const b64FromBytes = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const bytesFromB64 = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  // Lê o fluxo com teto de tamanho (protege contra arquivo "bomba de descompressão")
  async function pipe(u8, stream, maxBytes) {
    const reader = new Blob([u8]).stream().pipeThrough(stream).getReader(); const parts = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (maxBytes && total > maxBytes) { reader.cancel(); throw new Error('Arquivo grande demais.'); } parts.push(value); }
    const out = new Uint8Array(total); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
  }
  async function encode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') return 'g' + b64FromBytes(await pipe(raw, new CompressionStream('gzip')));
    return 'p' + b64FromBytes(raw);
  }
  async function decode(s) {
    if (typeof s !== 'string' || s.length > 8e6 || !/^[gp][A-Za-z0-9+/=]+$/.test(s)) throw new Error('formato');
    const kind = s[0], u8 = bytesFromB64(s.slice(1));
    const raw = kind === 'g' ? await pipe(u8, new DecompressionStream('gzip'), 40 * 1024 * 1024) : u8;
    return JSON.parse(new TextDecoder().decode(raw));
  }


  /* ---------- PDF ---------- */
  const fmt = x => (Math.round(x * 10) / 10).toString().replace('.', ',') + '%';
  async function build(R, who) {
    if (!root.jspdf) await loadScript(JSPDF_URL);
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const PW = 595.28, PH = 841.89, M = 40, CW = PW - 2 * M, BOT = PH - 50, TOP = 56;
    const C = {
      ink: [23, 32, 46], mut: [100, 110, 128], pri: [31, 78, 140], priBg: [232, 239, 250],
      ok: [21, 115, 71], okBg: [226, 244, 234], bad: [179, 38, 30], badBg: [252, 232, 230],
      warn: [150, 100, 0], warnBg: [255, 244, 214], line: [221, 227, 238], zebra: [246, 248, 252], chip: [234, 240, 250], white: [255, 255, 255]
    };
    let y = 0;
    build.fill = [];                                   // diagnóstico: até onde cada página foi preenchida
    const tc = c => doc.setTextColor(c[0], c[1], c[2]);
    const fc = c => doc.setFillColor(c[0], c[1], c[2]);
    const dc = c => doc.setDrawColor(c[0], c[1], c[2]);
    const font = (size, bold, color) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); tc(color || C.ink); };
    const wrap = (t, w, size, bold) => { font(size, bold); return doc.splitTextToSize(String(t), w); };
    const newPage = () => { build.fill.push(Math.round(y)); doc.addPage(); y = TOP; };
    const ensure = h => { if (y + h > BOT) newPage(); };
    const colFor = (t, a) => t < 3 ? C.mut : (a * 100 / t >= 75 ? C.ok : a * 100 / t >= 60 ? C.warn : C.bad);
    const bgFor = (t, a) => t < 3 ? C.chip : (a * 100 / t >= 75 ? C.okBg : a * 100 / t >= 60 ? C.warnBg : C.badBg);
    const lvl = (t, a) => t < 3 ? 'Poucos dados' : (a * 100 / t >= 75 ? 'Forte' : a * 100 / t >= 60 ? 'Regular' : 'Fraco');
    const bar = (x, yy, w, p, col, h) => { h = h || 6; fc(C.chip); doc.roundedRect(x, yy, w, h, h / 2, h / 2, 'F'); if (p > 0) { fc(col); doc.roundedRect(x, yy, Math.max(h, w * Math.min(p, 100) / 100), h, h / 2, h / 2, 'F'); } };
    const pill = (txt, cx, yy, w, t, a) => { fc(bgFor(t, a)); doc.roundedRect(cx, yy, w, 13, 6.5, 6.5, 'F'); font(7.8, true, colFor(t, a)); doc.text(txt, cx + w / 2, yy + 9.3, { align: 'center' }); };
    const thead = labels => { fc(C.priBg); doc.roundedRect(M, y, CW, 18, 4, 4, 'F'); font(8.3, true, C.pri); labels.forEach(([t, x, al]) => doc.text(t, x, y + 12.3, { align: al || 'left' })); y += 21; };

    // título de seção (compacto); exige espaço mínimo para o título + algumas linhas do conteúdo
    const section = (title, sub, minBelow) => {
      ensure(40 + (minBelow || 40));
      if (y > TOP + 2) y += 10;
      fc(C.pri); doc.roundedRect(M, y, 4, 15, 2, 2, 'F');
      font(13, true, C.pri); doc.text(title, M + 11, y + 12); y += 20;
      if (sub) { font(8.5, false, C.mut); wrap(sub, CW, 8.5, false).forEach(l => { doc.text(l, M, y + 7); y += 10.5; }); y += 1; }
      y += 3;
    };

    // desenha linhas de tabela que podem continuar na página seguinte (repete o cabeçalho; nunca deixa linha isolada)
    const flowRows = (rows, rowH, header, drawRow) => {
      let i = 0;
      while (i < rows.length) {
        const first = rowH(rows[i]) + (rows[i + 1] ? rowH(rows[i + 1]) : 0);
        ensure(22 + first); header(i > 0);
        const start = i;
        for (; i < rows.length; i++) {
          const h = rowH(rows[i]);
          if (i > start && y + h > BOT) break;
          drawRow(rows[i], i, h); y += h;
        }
      }
    };

    /* ===== Capa (faixa compacta) ===== */
    fc(C.pri); doc.rect(0, 0, PW, 82, 'F');
    font(21, true, C.white); doc.text('Estudo PMSC 2026', M, 38);
    font(11, false, [214, 227, 247]); doc.text('Relatório de desempenho nos simulados', M, 56);
    font(9, false, [214, 227, 247]);
    doc.text('Aluno(a): ' + who + '   ·   Gerado em ' + new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), M, 72);
    if (R.firstTs) { font(8.5, false, [214, 227, 247]); doc.text('Respostas de ' + new Date(R.firstTs).toLocaleDateString('pt-BR') + ' a ' + new Date(R.lastTs).toLocaleDateString('pt-BR'), PW - M, 56, { align: 'right' }); }
    y = 96;

    /* ===== Resumo ===== */
    const gap = 8, bw = (CW - 3 * gap) / 4;
    [['Respostas', String(R.tot), C.pri, C.priBg], ['Acertos', R.ok + '  (' + fmt(R.pOk) + ')', C.ok, C.okBg], ['Erros', (R.tot - R.ok) + '  (' + fmt(100 - R.pOk) + ')', C.bad, C.badBg], ['Aproveitamento', fmt(R.pOk), C.pri, C.priBg]].forEach((b, i) => {
      const x = M + i * (bw + gap); fc(b[3]); doc.roundedRect(x, y, bw, 44, 7, 7, 'F');
      font(b[1].length > 12 ? 12 : 15, true, b[2]); doc.text(b[1], x + bw / 2, y + 22, { align: 'center' });
      font(8, false, C.mut); doc.text(b[0], x + bw / 2, y + 36, { align: 'center' });
    });
    y += 52; bar(M, y, CW, 100, C.bad, 8); bar(M, y, CW, R.pOk, C.ok, 8); y += 11;
    font(7.8, false, C.mut); doc.text('Verde = acertos  ·  Vermelho = erros', M, y + 6); y += 10;

    /* ===== Desempenho por disciplina ===== */
    const dX = { n: M + 10, ac: M + 252, bar: M + 268, pr: M + CW - 84, nv: M + CW - 72 };
    const dRowH = r => r ? Math.max(wrap(r.d, 200, 9, false).length * 10.5 + 9, 20) : 20;
    section('Desempenho por disciplina', null, 22 + dRowH(R.rowsD[0]) * 2);
    flowRows(R.rowsD, dRowH,
      () => thead([['Disciplina', dX.n], ['Acertos', dX.ac, 'right'], ['Aproveitamento', dX.bar], ['%', dX.pr, 'right'], ['Nível', dX.nv + 4]]),
      (r, i, h) => {
        if (i % 2 === 0) { fc(C.zebra); doc.roundedRect(M, y, CW, h, 3, 3, 'F'); }
        const ls = wrap(r.d, 200, 9, false), cy = y + h / 2;
        font(9, false, C.ink); ls.forEach((l, k) => doc.text(l, dX.n, cy - (ls.length - 1) * 5.25 + k * 10.5 + 3));
        font(9, false, C.ink); doc.text(r.t ? r.a + '/' + r.t : '-', dX.ac, cy + 3, { align: 'right' });
        if (r.t) bar(dX.bar, cy - 3, 100, r.p, colFor(r.t, r.a), 6);
        font(9, true, colFor(r.t, r.a)); doc.text(r.t ? fmt(r.p) : '-', dX.pr, cy + 3, { align: 'right' });
        pill(lvl(r.t, r.a), dX.nv, cy - 6.5, 66, r.t, r.a);
      });

    /* ===== Comparação com o relatório anterior ===== */
    const fdt = ts => { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
    const pp = x => (x > 0.05 ? '+' : x < -0.05 ? '-' : '') + Math.abs(Math.round(x * 10) / 10).toString().replace('.', ',') + ' pp';
    const dCol = x => x == null ? C.mut : x > 0.05 ? C.ok : x < -0.05 ? C.bad : C.mut;
    if (R.compare) {
      const c = R.compare, nAdd = c.now.tot - c.before.tot;
      section('Comparação com o relatório anterior', 'Relatório anterior: ' + fdt(c.T) + '   |   Este relatório: ' + fdt(R.generatedAt), 80);
      const cw = (CW - 24) / 4;
      [['Antes', fmt(c.before.p), C.pri], ['Agora', fmt(c.now.p), C.pri], ['Variação geral', pp(c.dTot), dCol(c.dTot)], ['Respostas no período', String(nAdd) + (c.per.tot ? '  (' + fmt(c.per.p) + ')' : ''), C.pri]].forEach((b, i) => {
        const x = M + i * (cw + 8); fc(C.priBg); doc.roundedRect(x, y, cw, 36, 6, 6, 'F');
        font(12.5, true, b[2]); doc.text(b[1], x + cw / 2, y + 17, { align: 'center' }); font(7.8, false, C.mut); doc.text(b[0], x + cw / 2, y + 29, { align: 'center' });
      });
      y += 42;
      const cX = { n: M + 10, b: M + 262, a: M + 330, v: M + 402, p: M + CW - 8 };
      flowRows(c.rowsD, () => 19,
        () => thead([['Disciplina', cX.n], ['Antes', cX.b, 'right'], ['Agora', cX.a, 'right'], ['Variação', cX.v, 'right'], ['No período (acertos)', cX.p, 'right']]),
        (r, i, h) => {
          if (i % 2 === 0) { fc(C.zebra); doc.roundedRect(M, y, CW, h, 3, 3, 'F'); }
          font(8.8, false, C.ink); doc.text(r.d, cX.n, y + 12.8, { maxWidth: 220 });
          doc.text(r.b.t ? fmt(r.b.p) : '-', cX.b, y + 12.8, { align: 'right' }); doc.text(r.n.t ? fmt(r.n.p) : '-', cX.a, y + 12.8, { align: 'right' });
          font(8.8, true, dCol(r.delta)); doc.text(r.delta == null ? '-' : pp(r.delta), cX.v, y + 12.8, { align: 'right' });
          font(8.8, false, C.ink); doc.text(r.per.t ? fmt(r.per.p) + '  (' + r.per.a + '/' + r.per.t + ')' : '-', cX.p, y + 12.8, { align: 'right' });
        });
      const lst = (arr, col, title) => {
        if (!arr.length) return;
        const ls = wrap(title + ': ' + arr.map(x => x.as + ' (de ' + fmt(x.bp) + ' para ' + fmt(x.pp) + ')').join('; '), CW - 20, 8.5, false), h = ls.length * 10.5 + 8;
        ensure(h + 4); fc(col === C.ok ? C.okBg : C.badBg); doc.roundedRect(M, y + 4, CW, h, 5, 5, 'F');
        font(8.5, false, C.ink); ls.forEach((l, k) => doc.text(l, M + 10, y + 4 + 11.5 + k * 10.5)); y += h + 6;
      };
      y += 2; lst(c.up, C.ok, 'Assuntos que melhoraram'); lst(c.down, C.bad, 'Assuntos que pioraram');
    }

    /* ===== Histórico de relatórios ===== */
    if (R.history && R.history.length) {
      const hist = R.history.slice(-10).reverse();
      section('Histórico de relatórios', 'Data e hora em que cada relatório foi gerado e o desempenho acumulado naquele momento.', 24 + hist.length * 19);
      const hX = { d: M + 10, r: M + 290, p: M + 380, v: M + CW - 10 };
      flowRows(hist, () => 19,
        () => thead([['Data e hora', hX.d], ['Respostas', hX.r, 'right'], ['Aproveitamento', hX.p, 'right'], ['Variação vs. anterior', hX.v, 'right']]),
        (r, i, h) => {
          if (i % 2 === 0) { fc(C.zebra); doc.roundedRect(M, y, CW, h, 3, 3, 'F'); }
          font(8.8, r.T === R.generatedAt || Math.abs(r.T - R.generatedAt) < 60000, C.ink); doc.text(fdt(r.T) + (Math.abs(r.T - R.generatedAt) < 60000 ? '  (este relatório)' : ''), hX.d, y + 12.8);
          font(8.8, false, C.ink); doc.text(String(r.tot), hX.r, y + 12.8, { align: 'right' }); doc.text(fmt(r.p), hX.p, y + 12.8, { align: 'right' });
          font(8.8, true, dCol(r.delta)); doc.text(r.delta == null ? '-' : pp(r.delta), hX.v, y + 12.8, { align: 'right' });
        });
    }

    /* ===== Pontos fortes e fracos ===== */
    section('Pontos mais fortes e mais fracos', 'Considera as disciplinas com pelo menos 3 respostas.', 70);
    const cw2 = (CW - 12) / 2;
    const colItems = (rows, col) => rows.map(r => ({ lines: wrap(r.d, cw2 - 24 - 74, 9, false), p: r.p, txt: fmt(r.p) + '  (' + r.a + '/' + r.t + ')', col }));
    const strongI = colItems(R.strong, C.ok), weakI = colItems(R.weak, C.bad);
    const itemH = it => it.lines.length * 10.5 + 12;
    const colH = items => 28 + (items.length ? items.reduce((s, it) => s + itemH(it), 0) : 16) + 4;
    const hh = Math.max(colH(strongI), colH(weakI));
    ensure(hh + 4);
    [[strongI, 'Mais fortes', C.ok, C.okBg, M], [weakI, 'Mais fracos', C.bad, C.badBg, M + cw2 + 12]].forEach(([items, title, col, bg, x]) => {
      fc(bg); doc.roundedRect(x, y, cw2, hh, 7, 7, 'F'); fc(col); doc.roundedRect(x, y, 4, hh, 2, 2, 'F');
      font(10.5, true, col); doc.text(title, x + 13, y + 17);
      let yy = y + 26;
      if (!items.length) { font(8.5, false, C.mut); doc.text('Responda mais questões para ver.', x + 13, yy + 8); }
      items.forEach(it => {
        font(9, false, C.ink); it.lines.forEach((l, i) => doc.text(l, x + 13, yy + 8 + i * 10.5));
        font(9, true, it.col); doc.text(it.txt, x + cw2 - 10, yy + 8, { align: 'right' });
        bar(x + 13, yy + it.lines.length * 10.5 + 0.5, cw2 - 26, it.p, it.col, 3.5); yy += itemH(it);
      });
    });
    y += hh + 2;

    /* ===== O que estudar primeiro ===== */
    section('O que estudar primeiro', 'Ordenado por taxa de erro × peso da disciplina na prova: o que mais custa pontos fica no topo.', 60);
    if (!R.prio.length) { font(9, false, C.mut); doc.text('Nenhum assunto abaixo de 75% com dados suficientes. Continue praticando.', M, y + 8); y += 18; }
    R.prio.forEach((r, i) => {
      const tl = wrap(r.as, CW - 56, 10.5, true), rl = r.refs && r.refs.length ? wrap('Revise: ' + r.refs.join('; '), CW - 52, 8.3, false) : [];
      const h = 9 + tl.length * 12.5 + 11 + 9 + (rl.length ? rl.length * 10.2 + 3 : 0) + 7;
      ensure(h + 6);
      fc(C.zebra); doc.roundedRect(M, y, CW, h, 7, 7, 'F'); fc(C.bad); doc.roundedRect(M, y, 4, h, 2, 2, 'F');
      fc(C.bad); doc.circle(M + 22, y + 19, 8.5, 'F'); font(9.5, true, C.white); doc.text(String(i + 1), M + 22, y + 22.3, { align: 'center' });
      font(10.5, true, C.ink); tl.forEach((l, k) => doc.text(l, M + 40, y + 16 + k * 12.5));
      let yy = y + 9 + tl.length * 12.5;
      font(8.3, false, C.mut); doc.text(r.d + '  ·  peso na prova: ' + r.peso + ' de 60', M + 40, yy + 7);
      font(8.5, true, colFor(r.t, r.a)); doc.text('Acertou ' + r.a + '/' + r.t + '  (' + fmt(r.acc * 100) + ')', M + CW - 10, yy + 7, { align: 'right' });
      yy += 11; bar(M + 40, yy + 1, CW - 52, r.acc * 100, colFor(r.t, r.a), 4.5); yy += 9;
      if (rl.length) { font(8.3, false, C.bad); rl.forEach((l, k) => doc.text(l, M + 40, yy + 8 + k * 10.2)); }
      y += h + 5;
    });

    /* ===== Por assunto (agrupado por disciplina, com continuação entre páginas) ===== */
    const aX = { n: M + 10, ac: M + CW - 178, bar: M + CW - 168 };
    const textW = aX.ac - aX.n - 40;
    const aRowH = r => Math.max(wrap(r.as, textW, 8.8, false).length * 10.5 + 8, 19);
    const byDisc = new Map(); R.rowsA.forEach(r => { if (!byDisc.has(r.d)) byDisc.set(r.d, []); byDisc.get(r.d).push(r); });
    const groups = R.rowsD.filter(d => byDisc.has(d.d));
    section('Desempenho por assunto', 'Agrupado por disciplina; dentro de cada uma, do assunto mais fraco para o mais forte.', 22 + (groups[0] ? aRowH(byDisc.get(groups[0].d)[0]) * 2 : 0));
    groups.forEach((d, gi) => {
      const rows = byDisc.get(d.d);
      flowRows(rows, aRowH,
        cont => {
          fc(cont ? C.priBg : C.pri); doc.roundedRect(M, y, CW, 18, 4, 4, 'F');
          font(9.5, true, cont ? C.pri : C.white); doc.text(d.d + (cont ? ' (continuação)' : ''), M + 10, y + 12.5);
          if (!cont) { font(8.5, false, [214, 227, 247]); doc.text(d.a + '/' + d.t + ' acertos  ·  ' + fmt(d.p), M + CW - 10, y + 12.5, { align: 'right' }); }
          y += 21;
        },
        (r, i, h) => {
          if (i % 2 === 0) { fc(C.zebra); doc.roundedRect(M, y, CW, h, 3, 3, 'F'); }
          const ls = wrap(r.as, textW, 8.8, false), cy = y + h / 2;
          font(8.8, false, C.ink); ls.forEach((l, k) => doc.text(l, aX.n, cy - (ls.length - 1) * 5.25 + k * 10.5 + 3));
          font(8.8, false, C.ink); doc.text(r.a + '/' + r.t, aX.ac, cy + 3, { align: 'right' });
          bar(aX.bar, cy - 2.5, 44, r.acc * 100, colFor(r.t, r.a), 5);
          font(8.3, true, colFor(r.t, r.a)); doc.text(fmt(r.acc * 100), aX.bar + 50, cy + 3);
          pill(lvl(r.t, r.a), M + CW - 72, cy - 6.5, 66, r.t, r.a);
        });
      y += 7;
    });

    /* ===== Assuntos ainda sem resposta ===== */
    if (R.untouched && R.untouched.length) {
      section('Assuntos ainda sem nenhuma resposta', 'Vale incluir estes assuntos nas próximas sessões.', 50);
      const g = new Map(); R.untouched.forEach(u => { if (!g.has(u.d)) g.set(u.d, []); g.get(u.d).push(u.a); });
      g.forEach((list, d) => {
        const ls = wrap(list.join('  ·  '), CW - 20, 8.8, false), h = 20 + ls.length * 10.5 + 5;
        ensure(h + 4); fc(C.zebra); doc.roundedRect(M, y, CW, h, 5, 5, 'F');
        font(9, true, C.pri); doc.text(d, M + 10, y + 13);
        font(8.8, false, C.ink); ls.forEach((l, k) => doc.text(l, M + 10, y + 25 + k * 10.5));
        y += h + 4;
      });
    }

    /* ===== Evolução ===== */
    if (R.evo.length) {
      section('Evolução nas últimas sessões', 'Sessões com 5 ou mais questões. A linha tracejada marca a meta de 70%.', R.evo.length >= 2 ? 110 : 50);
      if (R.evo.length >= 2) {
        const cH = 96, x0 = M + 28, x1 = M + CW - 8, y0 = y + 6, y1 = y + cH - 14;
        const py = v => y1 - (y1 - y0) * v / 100, px = i => x0 + 8 + i * (x1 - x0 - 16) / (R.evo.length - 1);
        font(7.5, false, C.mut); dc(C.line); doc.setLineWidth(0.5);
        [0, 25, 50, 75, 100].forEach(v => { doc.line(x0, py(v), x1, py(v)); doc.text(v + '%', x0 - 4, py(v) + 2.6, { align: 'right' }); });
        dc(C.warn); doc.setLineWidth(0.8); doc.setLineDashPattern([3, 3], 0); doc.line(x0, py(70), x1, py(70)); doc.setLineDashPattern([], 0);
        dc(C.pri); doc.setLineWidth(1.6);
        R.evo.forEach((s, i) => { if (i) doc.line(px(i - 1), py(R.evo[i - 1].a * 100 / R.evo[i - 1].t), px(i), py(s.a * 100 / s.t)); });
        R.evo.forEach((s, i) => { fc(C.pri); doc.circle(px(i), py(s.a * 100 / s.t), 2.8, 'F'); });
        font(7.3, false, C.mut);
        R.evo.forEach((s, i) => { if (R.evo.length <= 8 || i % 2 === 0) doc.text(new Date(s.ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), px(i), y1 + 10, { align: 'center' }); });
        doc.setLineWidth(0.5); y += cH + 4;
      }
      const last = R.evo.slice(-8).reverse();
      flowRows(last, () => 19,
        () => thead([['Data', M + 10], ['Questões', M + 160, 'right'], ['Acertos', M + 250, 'right'], ['Aproveitamento', M + 280]]),
        (s, i, h) => {
          if (i % 2 === 0) { fc(C.zebra); doc.roundedRect(M, y, CW, h, 3, 3, 'F'); }
          font(9, false, C.ink); doc.text(new Date(s.ts).toLocaleDateString('pt-BR'), M + 10, y + 12.8);
          doc.text(String(s.t), M + 160, y + 12.8, { align: 'right' }); doc.text(String(s.a), M + 250, y + 12.8, { align: 'right' });
          bar(M + 280, y + 7, 120, s.a * 100 / s.t, colFor(s.t, s.a), 5); font(9, true, colFor(s.t, s.a)); doc.text(fmt(s.a * 100 / s.t), M + 410, y + 12.8);
        });
    }

    /* ===== Legenda ===== */
    ensure(52); y += 8; fc(C.zebra); doc.roundedRect(M, y, CW, 36, 7, 7, 'F');
    font(8.8, true, C.ink); doc.text('Como ler os níveis', M + 12, y + 14);
    font(8.5, false, C.mut);
    doc.text('Forte: 75% ou mais  ·  Regular: 60% a 74%  ·  Fraco: abaixo de 60%  ·  Poucos dados: menos de 3 respostas.', M + 12, y + 27);
    y += 38;

    /* ===== Dados embutidos (últimas páginas) ===== */
    section('Dados para reimportar este relatório', null, 90);
    const note = wrap('Este bloco permite reimportar o PDF no app (Banco > Meu progresso > Importar) e atualizar seu nível em outro aparelho. Ele contém apenas as suas respostas: código da questão, alternativa marcada e horário. Não edite nem apague esta parte.', CW - 24, 9, false);
    const nh = note.length * 12 + 16; fc(C.warnBg); doc.roundedRect(M, y, CW, nh, 7, 7, 'F');
    font(9, false, C.ink); note.forEach((l, k) => doc.text(l, M + 12, y + 15 + k * 12)); y += nh + 8;
    const payload = await encode({ v: 1, user: who, exportedAt: R.generatedAt || Date.now(), a: R.answers, reports: R.reports || [] });
    doc.setFont('courier', 'normal'); doc.setFontSize(4.6); tc(C.mut);
    const per = 190;
    for (let i = 0; i < payload.length; i += per) {
      if (y > PH - 46) { newPage(); doc.setFont('courier', 'normal'); doc.setFontSize(4.6); tc(C.mut); }
      doc.text('§PM1|' + payload.slice(i, i + per), M - 6, y + 4.6); y += 5.4;
    }
    build.fill.push(Math.round(y));

    /* ===== Cabeçalho corrente e rodapé em todas as páginas ===== */
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      if (p > 1) { font(8, false, C.mut); doc.text('Estudo PMSC 2026  ·  Relatório de desempenho  ·  ' + who, M, 26); dc(C.line); doc.setLineWidth(0.6); doc.line(M, 33, PW - M, 33); }
      dc(C.line); doc.setLineWidth(0.6); doc.line(M, PH - 36, PW - M, PH - 36);
      font(7.8, false, C.mut); doc.text('Gerado pelo app Estudo PMSC', M, PH - 24); doc.text('Página ' + p + ' de ' + n, PW - M, PH - 24, { align: 'right' });
    }
    return doc.output('blob');
  }

  root.ProgressPdf = { build, decode };
})(typeof window !== 'undefined' ? window : globalThis);
