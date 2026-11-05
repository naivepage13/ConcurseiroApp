/* Estudo PMSC — Portal da comunidade: materiais compartilhados (links) + anotações pessoais.
   Carregado antes do app.js; o app.js entrega o contexto em window.PMCtx. Toda a escrita no HTML passa por esc(). */
(function () {
'use strict';
const ctx = () => window.PMCtx;
const KINDS = {
  video: { nome: 'Vídeo', plural: 'Vídeos', cls: 'v', svg: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 9.5v5l4-2.5z"/>' },
  apostila: { nome: 'Apostila', plural: 'Apostilas', cls: 'p', svg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>' },
  simulado: { nome: 'Simulado', plural: 'Simulados', cls: 's', svg: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>' },
  resumo: { nome: 'Resumo', plural: 'Resumos', cls: 'r', svg: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>' }
};
const icon = (k, extra) => `<svg class="cm-svg" viewBox="0 0 24 24" aria-hidden="true">${extra || KINDS[k].svg}</svg>`;
const PLUS = '<path d="M12 5v14M5 12h14"/>', PEN = KINDS.resumo.svg;

const S = { kind: '', q: '', sort: 'top', mine: false, posts: null, notes: null, share: false, draft: null, homeSort: 'top', homePosts: null, homeNotes: null, busy: false };

function friendly(e) {
  const m = String((e && e.message) || e);
  if (/Could not find the function|schema cache|404/i.test(m)) return 'A comunidade ainda não foi ativada no servidor (falta executar supabase/comunidade.sql).';
  return m;
}
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora há pouco'; if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'há ' + Math.round(s / 3600) + ' h'; const d = Math.round(s / 86400); return d === 1 ? 'ontem' : 'há ' + d + ' dias';
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const safeUrl = u => /^https:\/\/[^\s<>"']+$/.test(String(u || '')) ? u : '';
const cfg = () => window.APP_CONFIG || {};
const baseUrl = () => String(cfg().SUPABASE_URL || '').replace(/\/$/, '');
const FILE_RE = /^[0-9a-f-]{36}\.pdf$/;
const fileUrl = p => FILE_RE.test(String(p || '')) ? baseUrl() + '/storage/v1/object/public/comunidade/' + p : '';
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const MAX_PDF = 10 * 1024 * 1024;
function storage(method, path, body) {
  const k = cfg().SUPABASE_ANON_KEY, h = { apikey: k, Authorization: 'Bearer ' + k }; if (body) h['Content-Type'] = 'application/pdf';
  return fetch(baseUrl() + '/storage/v1/object/comunidade/' + path, { method, headers: h, body });
}
// apaga do Storage os PDFs que já não pertencem a nenhuma publicação (liberando espaço)
async function cleanup() {
  try {
    const ps = await rpc('app_cm_pending_deletes', {});
    for (const f of ps || []) { if (!FILE_RE.test(f)) continue; try { const r = await storage('DELETE', f); if (r.ok || r.status === 404 || r.status === 400) await rpc('app_cm_forget', { p_path: f }); } catch (e) { /* tenta na próxima */ } }
  } catch (e) { /* silencioso */ }
}
const rpc = (fn, a) => ctx().Cloud.rpc(fn, Object.assign({ p_token: ctx().Cloud.token }, a));

function listArgs(o) { return { p_kind: o.kind || null, p_sort: o.sort, p_q: o.q || null, p_mine: !!o.mine, p_limit: o.limit || 40 }; }

/* ---------- peças de HTML ---------- */
function postHtml(p, compact) {
  const { esc } = ctx(), k = KINDS[p.kind] || KINDS.resumo, isFile = !!p.file_path, url = isFile ? fileUrl(p.file_path) : safeUrl(p.url);
  return `<div class="cm-post">
    <div class="cm-ico ${k.cls}">${icon(p.kind, isFile ? KINDS.apostila.svg : '')}</div>
    <div class="cm-main">
      <h4>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(p.title)}</a>` : esc(p.title)}</h4>
      <div class="cm-meta"><span class="cm-tag">${esc(k.nome)}</span>${isFile ? '<span class="cm-tag cm-pdf">PDF</span>' : ''}${p.disciplina ? `<span class="cm-tag">${esc(p.disciplina)}</span>` : ''}${isFile ? esc(fmtSize(p.file_size || 0)) : esc(hostOf(url))} · por <b>${esc(p.author)}</b> · ${esc(ago(p.created_at))}</div>
      ${!compact && p.descr ? `<p class="cm-desc">${esc(p.descr)}</p>` : ''}
      ${compact ? '' : `<div class="cm-acts">${isFile && url ? `<a class="cm-lnk" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>` : ''}<button type="button" class="cm-lnk" data-cm="note" data-id="${esc(p.id)}">✎ Anotar</button>${p.mine ? `<button type="button" class="cm-lnk" data-cm="del" data-id="${esc(p.id)}">Apagar</button>` : `<button type="button" class="cm-lnk" data-cm="report" data-id="${esc(p.id)}">Denunciar</button>`}</div>`}
    </div>
    <button type="button" class="cm-vote ${p.voted ? 'on' : ''}" data-cm="vote" data-id="${esc(p.id)}" title="${p.mine ? 'Seu material' : 'Marcar como útil'}" ${p.mine ? 'disabled' : ''}><b>${esc(p.votes)}</b>úteis</button>
  </div>`;
}
const emptyMsg = t => `<div class="cm-empty">${t}</div>`;

/* ---------- bloco da página inicial ---------- */
async function mountHome() {
  const el = document.getElementById('cm-home'); if (!el) return;
  const { esc } = ctx(); el.innerHTML = homeShell('<div class="mut small" style="padding:10px 0">Carregando…</div>', null);
  try {
    const [posts, notes] = await Promise.all([rpc('app_cm_list', listArgs({ sort: S.homeSort, limit: 3 })), rpc('app_notes_list', {})]);
    S.homePosts = posts; S.homeNotes = notes;
    const box = document.getElementById('cm-home'); if (!box) return;
    box.innerHTML = homeShell(posts.length ? posts.map(p => postHtml(p, true)).join('') : emptyMsg('Ainda não há materiais. Seja a primeira pessoa a compartilhar!'), notes);
  } catch (e) {
    const box = document.getElementById('cm-home'); if (box) box.innerHTML = homeShell(`<div class="cm-empty">${esc(friendly(e))}</div>`, null);
  }
}
function homeShell(inner, notes) {
  const { esc } = ctx(), last = notes && notes[0];
  return `<div class="row cm-hhead"><h2>Comunidade</h2><a class="small cm-all" href="#/comunidade">Ver tudo →</a></div>
  <div class="card">
    <div class="row cm-chips"><button type="button" class="chip ${S.homeSort === 'top' ? 'sel' : ''}" data-cm="hsort" data-v="top">Em alta</button><button type="button" class="chip ${S.homeSort === 'new' ? 'sel' : ''}" data-cm="hsort" data-v="new">Novos</button></div>
    ${inner}
    <div class="row" style="margin-top:10px"><a class="btn pri" href="#/comunidade" data-cm="go-share"><svg class="cm-svg" viewBox="0 0 24 24" aria-hidden="true">${PLUS}</svg> Compartilhar material</a><a class="btn" href="#/comunidade">Abrir portal</a></div>
  </div>
  <div class="card"><div class="row" style="justify-content:space-between"><b><svg class="cm-svg" viewBox="0 0 24 24" aria-hidden="true">${PEN}</svg> Minhas anotações</b><span class="small mut">${notes ? notes.length + (notes.length === 1 ? ' nota' : ' notas') : ''}</span></div>
    ${last ? `<div class="cm-note"><b>${esc(last.title)}</b> — ${esc(last.body.slice(0, 110))}${last.body.length > 110 ? '…' : ''}</div><a class="small" href="#/comunidade" data-cm="go-notes">Ver todas as anotações</a>` : `<p class="mut small" style="margin:6px 0 0">Você ainda não tem anotações. <a href="#/comunidade" data-cm="go-notes">Criar a primeira</a></p>`}
  </div>`;
}

/* ---------- portal completo ---------- */
function tabsHtml() {
  const t = [['', 'Tudo'], ['video', 'Vídeos'], ['apostila', 'Apostilas'], ['simulado', 'Simulados'], ['resumo', 'Resumos'], ['notas', '✎ Minhas anotações']];
  return `<div class="cm-tabs">${t.map(([k, n]) => `<button type="button" class="chip ${S.kind === k ? 'sel' : ''}" data-cm="tab" data-v="${k}">${n}</button>`).join('')}</div>`;
}
function shareHtml() {
  const { esc } = ctx(), discs = Object.keys((window.APP_CONFIG || {}).EXAM_STRUCTURE || {});
  return `<form class="card" data-cmform="share" autocomplete="off">
    <h3>Compartilhar material</h3>
    <p class="mut small" style="margin-top:0">Compartilhe um <b>link</b> (YouTube, Google Drive, site…) ou envie um <b>PDF</b> de até 10 MB.</p>
    <div class="cm-mode"><label><input type="radio" name="cm-mode" value="link" data-cm="mode" data-v="link" checked> Link</label><label><input type="radio" name="cm-mode" value="pdf" data-cm="mode" data-v="pdf"> Arquivo PDF</label></div>
    <label class="f" for="cm-kind">Tipo</label>
    <select id="cm-kind">${Object.keys(KINDS).map(k => `<option value="${k}">${esc(KINDS[k].nome)}</option>`).join('')}</select>
    <label class="f" for="cm-title">Título</label><input type="text" id="cm-title" maxlength="120" required placeholder="ex.: Direito Penal Militar em 40 min">
    <div id="cm-linkbox"><label class="f" for="cm-url">Link (https://…)</label><input type="text" id="cm-url" inputmode="url" maxlength="500" required placeholder="https://"></div>
    <div id="cm-filebox" hidden><label class="f" for="cm-file">Arquivo PDF <span class="mut small">(até 10 MB)</span></label><input type="file" id="cm-file" accept="application/pdf,.pdf"></div>
    <label class="f" for="cm-disc">Disciplina <span class="mut small">(opcional)</span></label>
    <select id="cm-disc"><option value="">—</option>${discs.map(d => `<option>${esc(d)}</option>`).join('')}</select>
    <label class="f" for="cm-descr">Descrição <span class="mut small">(opcional)</span></label><textarea id="cm-descr" maxlength="300" style="min-height:70px" placeholder="O que a pessoa vai encontrar aqui?"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn pri" type="submit" id="cm-pub">Publicar</button><button class="btn" type="button" data-cm="share-close">Cancelar</button></div>
  </form>`;
}
function noteEditorHtml() {
  const { esc } = ctx(), d = S.draft || { id: null, title: '', body: '', post: null, postTitle: '' };
  return `<form class="card" data-cmform="note" autocomplete="off">
    <h3>${d.id ? 'Editar anotação' : 'Nova anotação'}</h3>
    ${d.post ? `<p class="small mut" style="margin:0 0 4px">Vinculada a: <b>${esc(d.postTitle || 'material')}</b> <button type="button" class="cm-lnk" data-cm="unlink">remover vínculo</button></p>` : ''}
    <label class="f" for="cm-ntitle">Título</label><input type="text" id="cm-ntitle" maxlength="80" value="${esc(d.title)}" placeholder="ex.: Crimes contra a pessoa">
    <label class="f" for="cm-nbody">Anotação</label><textarea id="cm-nbody" maxlength="5000" required style="min-height:140px" placeholder="Escreva aqui. Só você vê.">${esc(d.body)}</textarea>
    <div class="row" style="margin-top:12px"><button class="btn pri" type="submit">Salvar anotação</button>${d.id || d.body ? '<button class="btn" type="button" data-cm="note-new">Nova</button>' : ''}<span class="small mut">Só você vê suas anotações.</span></div>
  </form>`;
}
function notesHtml() {
  const { esc } = ctx(), ns = S.notes;
  if (!ns) return '<div class="mut small">Carregando…</div>';
  return noteEditorHtml() + (ns.length ? ns.map(n => `<div class="card cm-nrow">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><b>${esc(n.title)}</b><span class="small mut">${esc(ago(n.updated_at))}</span></div>
      ${n.post_title ? `<div class="small mut">Vinculada a: ${esc(n.post_title)}</div>` : ''}
      <div class="cm-nbody">${esc(n.body)}</div>
      <div class="cm-acts"><button type="button" class="cm-lnk" data-cm="note-edit" data-id="${esc(n.id)}">Editar</button><button type="button" class="cm-lnk" data-cm="note-del" data-id="${esc(n.id)}">Apagar</button></div></div>`).join('') : emptyMsg('Nenhuma anotação ainda.'));
}
function portalPaint(err) {
  const { esc, app } = ctx(), notas = S.kind === 'notas';
  app.innerHTML = `<div class="row cm-top"><h1 style="margin:0">Comunidade</h1>${notas ? '' : `<button type="button" class="btn pri" data-cm="share-open"><svg class="cm-svg" viewBox="0 0 24 24" aria-hidden="true">${PLUS}</svg> Compartilhar</button>`}</div>
  ${notas ? '' : `<form class="cm-search" data-cmform="search" role="search"><input type="text" id="cm-q" maxlength="60" value="${esc(S.q)}" placeholder="Buscar por título ou disciplina…" aria-label="Buscar"></form>`}
  ${tabsHtml()}
  ${err ? `<div class="notice">${esc(err)}</div>` : ''}
  ${notas ? notesHtml() : `${S.share ? shareHtml() : ''}
    <div class="row cm-sort"><button type="button" class="chip ${S.sort === 'top' ? 'sel' : ''}" data-cm="sort" data-v="top">Mais úteis</button><button type="button" class="chip ${S.sort === 'new' ? 'sel' : ''}" data-cm="sort" data-v="new">Mais recentes</button><button type="button" class="chip ${S.mine ? 'sel' : ''}" data-cm="mine">Só os meus</button></div>
    <div class="card cm-list">${S.posts ? (S.posts.length ? S.posts.map(p => postHtml(p)).join('') : emptyMsg(S.q || S.kind || S.mine ? 'Nada encontrado com esses filtros.' : 'Ainda não há materiais. Seja a primeira pessoa a compartilhar!')) : '<div class="mut small">Carregando…</div>'}</div>`}`;
}
async function load() {
  try {
    if (S.kind === 'notas') S.notes = await rpc('app_notes_list', {});
    else S.posts = await rpc('app_cm_list', listArgs(S));
    return '';
  } catch (e) { if (e && e.expired) throw e; return friendly(e); }
}
async function viewPortal() {
  const c = ctx(); c.setNav('comunidade'); S.posts = S.kind === 'notas' ? S.posts : null; portalPaint();
  const err = await load(); if (location.hash.replace(/^#\/?/, '').split('?')[0] === 'comunidade') portalPaint(err);
  cleanup();
}
async function refresh() { const err = await load(); portalPaint(err); }

/* ---------- ações ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-cm]'); if (!el || !ctx() || !ctx().app.contains(el)) return;
  const a = el.dataset.cm, v = el.dataset.v, id = el.dataset.id, { toast } = ctx();
  const post = () => (S.posts || []).find(p => p.id === id) || (S.homePosts || []).find(p => p.id === id);
  try {
    switch (a) {
      case 'go-share': S.kind = ''; S.share = true; break;      // o link já navega para #/comunidade
      case 'go-notes': S.kind = 'notas'; break;
      case 'hsort': S.homeSort = v; mountHome(); break;
      case 'tab': S.kind = v; S.share = false; S.posts = null; portalPaint(); await refresh(); break;
      case 'sort': S.sort = v; await refresh(); break;
      case 'mine': S.mine = !S.mine; await refresh(); break;
      case 'mode': { const pdf = v === 'pdf'; document.getElementById('cm-linkbox').hidden = pdf; document.getElementById('cm-filebox').hidden = !pdf; document.getElementById('cm-url').required = !pdf; break; }
      case 'share-open': S.share = true; portalPaint(); document.getElementById('cm-title').focus(); break;
      case 'share-close': S.share = false; portalPaint(); break;
      case 'vote': {
        const r = await rpc('app_cm_vote', { p_id: id }), p = post(); if (p) { p.votes = r.votes; p.voted = r.voted; }
        if (document.getElementById('cm-home')) { const h = (S.homePosts || []).find(x => x.id === id); if (h) { h.votes = r.votes; h.voted = r.voted; } mountHome(); } else portalPaint(); break;
      }
      case 'report': if (confirm('Denunciar este material como impróprio, enganoso ou spam? Com 3 denúncias ele é escondido.')) { await rpc('app_cm_report', { p_id: id }); toast('Obrigado. A denúncia foi registrada.'); await refresh(); } break;
      case 'del': if (confirm('Apagar este material da comunidade?')) { await rpc('app_cm_delete', { p_id: id }); toast('Material apagado.'); await refresh(); cleanup(); } break;
      case 'note': { const p = post(); S.draft = { id: null, title: p ? 'Sobre: ' + p.title.slice(0, 60) : '', body: '', post: id, postTitle: p ? p.title : '' }; S.kind = 'notas'; S.notes = null; portalPaint(); await refresh(); document.getElementById('cm-nbody').focus(); break; }
      case 'unlink': if (S.draft) { S.draft.post = null; S.draft.postTitle = ''; keepDraft(); portalPaint(); } break;
      case 'note-new': S.draft = null; portalPaint(); break;
      case 'note-edit': { const n = (S.notes || []).find(x => x.id === id); if (n) { S.draft = { id: n.id, title: n.title === 'Sem título' ? '' : n.title, body: n.body, post: n.post_id, postTitle: n.post_title || '' }; portalPaint(); window.scrollTo({ top: 0 }); } break; }
      case 'note-del': if (confirm('Apagar esta anotação?')) { await rpc('app_note_delete', { p_id: id }); if (S.draft && S.draft.id === id) S.draft = null; toast('Anotação apagada.'); await refresh(); } break;
    }
  } catch (er) { if (er && er.expired) { ctx().Cloud.clear(); location.reload(); return; } toast(friendly(er), 5000); }
});
function keepDraft() { const t = document.getElementById('cm-ntitle'), b = document.getElementById('cm-nbody'); if (S.draft && t && b) { S.draft.title = t.value; S.draft.body = b.value; } }

document.addEventListener('submit', async e => {
  const f = e.target.dataset && e.target.dataset.cmform; if (!f || !ctx()) return; e.preventDefault();
  const { toast } = ctx(), btn = e.target.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  const val = id => document.getElementById(id).value;
  try {
    if (f === 'search') { S.q = val('cm-q').trim(); await refresh(); }
    else if (f === 'share') {
      const pdf = document.querySelector('input[name=cm-mode]:checked').value === 'pdf', base = { p_kind: val('cm-kind'), p_title: val('cm-title'), p_disc: val('cm-disc') || null, p_descr: val('cm-descr') || null };
      if (!pdf) {
        const url = val('cm-url').trim(); if (!/^https:\/\//i.test(url)) throw new Error('Cole um link que comece com https://');
        await rpc('app_cm_add', Object.assign(base, { p_url: url }));
      } else {
        const file = document.getElementById('cm-file').files[0];
        if (!file) throw new Error('Escolha um arquivo PDF.');
        if (file.size > MAX_PDF) throw new Error('O PDF precisa ter no máximo 10 MB.');
        const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        if (String.fromCharCode(...head) !== '%PDF-') throw new Error('Este arquivo não é um PDF válido.');
        if (btn) btn.textContent = 'Enviando…'; toast('Enviando o PDF…', 8000);
        const path = await rpc('app_cm_upload_ticket', { p_size: file.size });
        try {
          const r = await storage('POST', path, file);
          if (!r.ok) throw new Error('Não consegui enviar o PDF (erro ' + r.status + '). Tente de novo.');
          await rpc('app_cm_add', Object.assign(base, { p_url: null, p_file: path }));
        } catch (er2) { try { await rpc('app_cm_discard', { p_path: path }); } catch (e3) { /* ok */ } cleanup(); throw er2; }
      }
      S.share = false; S.kind = ''; S.sort = 'new'; S.q = ''; toast('Material publicado. Obrigado por compartilhar!'); await refresh(); cleanup();
    } else if (f === 'note') {
      const d = S.draft || {};
      await rpc('app_note_save', { p_id: d.id || null, p_title: val('cm-ntitle'), p_body: val('cm-nbody'), p_post: d.post || null });
      S.draft = null; toast('Anotação salva.'); await refresh();
    }
  } catch (er) { if (er && er.expired) { ctx().Cloud.clear(); location.reload(); return; } toast(friendly(er), 5000); }
  if (btn) btn.disabled = false;
});

window.Comunidade = { viewPortal, mountHome };
})();
