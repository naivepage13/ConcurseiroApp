/* Estudo PMSC 2026 — app de simulados (HTML/JS puro, sem build). */
(function () {
'use strict';
const CFG = window.APP_CONFIG || {};
// O banco de questões embutido é opcional (arquivo data/bank.js, que não vai para o GitHub). Sem ele, as questões vêm da nuvem (após o login) ou de PDFs importados.
const SEED = window.SEED_BANK || { sims: [], texts: {}, questions: [], disciplinas: Object.keys(CFG.EXAM_STRUCTURE || {}) };
const $app = document.getElementById('app');
// Anti-clickjacking: não funciona dentro de <iframe> de outro site
try { if (window.top !== window.self) { window.top.location = window.self.location; } } catch (e) { document.body.innerHTML = ''; }

/* ---------- sanitização de dados vindos de fora (nuvem, PDFs, arquivos) ---------- */
// Tudo que não é de confiança passa por aqui: só texto simples, tamanhos limitados, ids em formato seguro.
// (E, na hora de desenhar a tela, todo texto ainda passa por esc() — duas camadas contra XSS.)
const SAFE_ID = /^[A-Za-z0-9._-]{1,90}$/;
const strOf = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
function cleanPackage(pk) {
  try {
    if (!pk || typeof pk !== 'object' || !pk.sim || typeof pk.sim !== 'object' || !Array.isArray(pk.questions)) return null;
    const sid = strOf(pk.sim.id, 60); if (!SAFE_ID.test(sid)) return null;
    const sim = { id: sid, nome: strOf(pk.sim.nome, 120) || sid, fonte: strOf(pk.sim.fonte, 80) };
    const texts = {};
    Object.keys(pk.texts && typeof pk.texts === 'object' ? pk.texts : {}).slice(0, 20).forEach(k => {
      const t = pk.texts[k]; if (SAFE_ID.test(k) && t && typeof t === 'object') texts[k] = { title: strOf(t.title, 300), paras: (Array.isArray(t.paras) ? t.paras : []).slice(0, 60).map(p => strOf(p, 4000)) };
    });
    const seen = new Set(), questions = [];
    for (const q of pk.questions.slice(0, 400)) {
      if (!q || typeof q !== 'object' || !q.alts || typeof q.alts !== 'object') continue;
      const alts = {}; ['A', 'B', 'C', 'D', 'E'].forEach(l => { if (typeof q.alts[l] === 'string' && q.alts[l]) alts[l] = q.alts[l].slice(0, 2500); });
      const gab = strOf(q.gab, 1), id = strOf(q.id, 90);
      if (Object.keys(alts).length < 2 || !alts[gab] || !SAFE_ID.test(id) || seen.has(id)) continue; seen.add(id);
      questions.push({ id, sim: sid, n: Math.max(0, parseInt(q.n, 10) || 0), disc: strOf(q.disc, 80) || 'Geral', assunto: strOf(q.assunto, 140) || 'Geral', tema: q.tema ? strOf(q.tema, 140) : undefined, stem: strOf(q.stem, 6000), alts, gab, expl: strOf(q.expl, 12000), texto: typeof q.texto === 'string' && texts[q.texto] ? q.texto : null });
    }
    return questions.length ? { sim, texts, questions } : null;
  } catch (e) { return null; }
}
const MAX_PDF_BYTES = 30 * 1024 * 1024;

/* ---------- utilidades ---------- */
const rawGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const rawSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignora */ } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, t) => t ? Math.round(a * 1000 / t) / 10 : 0;
const fmtPct = x => (Math.round(x * 10) / 10).toString().replace('.', ',') + '%';
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let toastT;
function toast(msg, ms) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 3600); }
function download(name, data, type) { const b = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
const fmtStem = s => esc(s).replace(/\s(?=(?:I|II|III|IV|V|VI)\s[–-]\s)/g, '\n');
const qKey = q => String(q.stem + Object.keys(q.alts).sort().map(l => q.alts[l]).join('')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 400);
const fileBuf = f => f.arrayBuffer();

/* ---------- nuvem (Supabase via REST, sem e-mail) ---------- */
// Proteção contra erro humano: se alguém colar a chave SECRETA (service_role / sb_secret) no config.js, o app se recusa a funcionar
function keyIsSecret(k) {
  k = String(k || ''); if (/^sb_secret_/i.test(k)) return true;
  try { const pl = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return pl && pl.role === 'service_role'; } catch (e) { return false; }
}
const SECRET_KEY_FOUND = keyIsSecret(CFG.SUPABASE_ANON_KEY);
if (SECRET_KEY_FOUND) { CFG.SUPABASE_ANON_KEY = ''; }
const Cloud = {
  enabled: !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(CFG.SUPABASE_URL)),
  token: rawGet('pm_token'), username: rawGet('pm_user'), status: '',
  async rpc(fn, args) {
    let r;
    try {
      r = await fetch(CFG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY }, body: JSON.stringify(args || {}) });
    } catch (e) { const er = new Error('Sem conexão com a internet.'); er.offline = true; throw er; }
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* texto */ }
    if (!r.ok) { const er = new Error((j && j.message) || 'Erro no servidor (' + r.status + ').'); er.expired = /Sessão expirada/.test(er.message); throw er; }
    return j;
  },
  setSession(j) { this.token = j.token; this.username = j.username; rawSet('pm_token', j.token); rawSet('pm_user', j.username); },
  clear() { this.token = null; this.username = null; rawSet('pm_token', null); rawSet('pm_user', null); },
  async register(u, p, invite) { const j = await this.rpc('app_register', { p_username: u, p_password: p, p_invite: invite }); if (j && j.error) throw new Error(j.error); this.setSession(j); },
  async login(u, p) { const j = await this.rpc('app_login', { p_username: u, p_password: p }); if (j && j.error) throw new Error(j.error); this.setSession(j); },
  async logout() { try { await this.rpc('app_logout', { p_token: this.token }); } catch (e) { /* ok */ } this.clear(); },
  async checkSession() {
    if (!this.token) return;
    try { const j = await this.rpc('app_me', { p_token: this.token }); this.username = j.username; rawSet('pm_user', j.username); }
    catch (e) { if (e.expired) this.clear(); }
  },
  async sync() {
    if (!this.token) return;
    try { await this.pullSims(); await this.pullAnswers(); await this.pushPending(); await reportSimulados(); this.status = 'Sincronizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.'; }
    catch (e) { this.status = e.offline ? 'Sem internet — seu progresso está salvo neste aparelho e será enviado depois.' : 'Falha ao sincronizar: ' + e.message; if (e.expired) { this.clear(); route(); } }
  },
  async pushAnswer(a) { if (!this.token) return; try { await this.rpc('app_push_answers', { p_token: this.token, p_rows: [{ qid: a.qid, chosen: a.chosen, ok: a.ok, ts: a.ts }] }); a.synced = true; saveAnswers(); } catch (e) { /* fica pendente */ } },
  async pushPending() {
    const pend = answers.filter(a => !a.synced);
    for (let i = 0; i < pend.length; i += 500) {
      const chunk = pend.slice(i, i + 500);
      await this.rpc('app_push_answers', { p_token: this.token, p_rows: chunk.map(a => ({ qid: a.qid, chosen: a.chosen, ok: a.ok, ts: a.ts })) });
      chunk.forEach(a => { a.synced = true; });
    }
    saveAnswers();
  },
  async pullAnswers() {
    const have = new Set(answers.map(a => a.ts + '|' + a.qid)); let after = 0, added = 0;
    for (;;) {
      const rows = await this.rpc('app_pull_answers', { p_token: this.token, p_after: after, p_limit: 1000 });
      rows.forEach(r => { const k = r.ts + '|' + r.qid; if (!have.has(k)) { have.add(k); added++; answers.push({ qid: r.qid, chosen: r.chosen, ok: r.ok, ts: Number(r.ts), sess: 'h' + Math.floor(r.ts / 1800000), synced: true }); } });
      if (rows.length < 1000) break; after = Number(rows[rows.length - 1].ts);
    }
    if (added) { answers.sort((a, b) => a.ts - b.ts); saveAnswers(); }
  },
  // Simulados PRIVADOS da conta: baixa só os que este aparelho ainda não tem; envia os que foram adicionados offline
  async pullSims() {
    const list = await this.rpc('app_list_sims', { p_token: this.token });
    const cache = LS.get('simcache', {}), next = {}, have = new Set();
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || !SAFE_ID.test(String(s.id))) continue; have.add(s.id);
      const pk = cache[s.id] || await this.rpc('app_get_sim', { p_token: this.token, p_id: s.id });
      const c = cleanPackage(pk); if (c) next[s.id] = c;      // só guarda o que passou na sanitização
    }
    // simulados adicionados neste aparelho enquanto estava sem login/internet: sobem para a conta e saem da lista local
    const stay = [];
    for (const pk of custom) { const c = cleanPackage(pk); if (!c) continue; if (have.has(c.sim.id)) continue; try { await this.publish(c, next); } catch (e) { stay.push(c); } }
    if (stay.length !== custom.length) { custom = stay; LS.set('custom', custom); }
    LS.set('simcache', next); cloudSims = Object.values(next); buildBank();
  },
  async publish(pk, cacheObj) {
    await this.rpc('app_add_sim', { p_token: this.token, p_id: pk.sim.id, p_nome: pk.sim.nome, p_fonte: pk.sim.fonte || '', p_payload: pk });
    const cache = cacheObj || LS.get('simcache', {}); cache[pk.sim.id] = pk; if (!cacheObj) { LS.set('simcache', cache); cloudSims = Object.values(cache); }
  },
  leaderboard() { return this.rpc('app_leaderboard', { p_token: this.token }); }
};

/* ---------- estado (por usuário neste aparelho) ---------- */
let answers = [], custom = [], cloudSims = [], session = null, filters = null, pending = null, BANK = null, reports = [], cmpBase = null;
const uKey = () => Cloud.username || '_local';
const LS = {
  get(k, d) { try { const v = localStorage.getItem('pm_' + k + ':' + uKey()); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pm_' + k + ':' + uKey(), JSON.stringify(v)); } catch (e) { toast('Não foi possível salvar neste aparelho (armazenamento cheio ou bloqueado).'); } }
};
const DEF_FILTERS = () => ({ sims: [], discs: [], assuntos: [], status: 'all', count: 20, order: 'rand' });
function loadState() {
  answers = LS.get('answers', []); custom = LS.get('custom', []); session = LS.get('session', null); reports = LS.get('reports', []); cmpBase = null;
  filters = Object.assign(DEF_FILTERS(), LS.get('filters', {})); pending = null;
  cloudSims = Object.values(LS.get('simcache', {}));   // cópia local dos simulados desta conta (por usuário; funciona sem internet)
  buildBank();
}
const saveAnswers = () => LS.set('answers', answers);
const saveFilters = () => LS.set('filters', filters);
const saveSession = () => LS.set('session', session);
const who = () => Cloud.username || 'Aluno';

function buildBank() {
  const sims = SEED.sims.map(s => ({ ...s, origem: 'base' }))
    .sort((a, b) => (a.id === 'lei6218') - (b.id === 'lei6218') || a.id.localeCompare(b.id, 'pt', { numeric: true }));
  const texts = { ...SEED.texts };
  const qs = SEED.questions.slice();
  const ids = new Set(qs.map(q => q.id)), simIds = new Set(sims.map(s => s.id));
  const add = (pk, origem) => {
    if (!pk || !pk.sim || simIds.has(pk.sim.id)) return;
    simIds.add(pk.sim.id);
    sims.push({ ...pk.sim, n: pk.questions.length, origem, comentado: pk.questions.some(q => q.expl) });
    Object.assign(texts, pk.texts || {});
    pk.questions.forEach(q => { if (!ids.has(q.id)) { ids.add(q.id); qs.push(q); } });
  };
  cloudSims.forEach(p => add(cleanPackage(p), 'minha conta'));
  custom.forEach(p => add(cleanPackage(p), 'neste aparelho'));
  const discs = SEED.disciplinas.slice();
  qs.forEach(q => { if (!discs.includes(q.disc)) discs.push(q.disc); });
  BANK = { sims, texts, questions: qs, byId: new Map(qs.map(q => [q.id, q])), disciplinas: discs };
}
const weightOf = d => (CFG.EXAM_STRUCTURE && CFG.EXAM_STRUCTURE[d]) || 5;
const simName = id => (BANK.sims.find(s => s.id === id) || {}).nome || id;
const shortSim = n => String(n).replace(' — AOCP PMSC Soldado QPPM', '');

/* ---------- ranking: quantos simulados a pessoa já fez ---------- */
// "Feito" = todas as questões do simulado respondidas ao menos uma vez. É o ÚNICO dado de desempenho que o ranking mostra.
function simuladosFeitos() {
  const done = new Set(answers.map(a => a.qid)), tot = new Map(), got = new Map();
  BANK.questions.forEach(q => { tot.set(q.sim, (tot.get(q.sim) || 0) + 1); if (done.has(q.id)) got.set(q.sim, (got.get(q.sim) || 0) + 1); });
  let n = 0; tot.forEach((t, sid) => { if (t > 0 && got.get(sid) === t) n++; });
  return n;
}
async function reportSimulados() {
  if (!Cloud.token) return;
  const n = simuladosFeitos(), last = LS.get('simdone', 0);
  if (n > last) { try { await Cloud.rpc('app_set_simulados', { p_token: Cloud.token, p_n: n }); LS.set('simdone', n); } catch (e) { /* tenta na próxima */ } }
}
function lastByQ() { const m = new Map(); answers.forEach(a => { const p = m.get(a.qid); if (!p || a.ts >= p.ts) m.set(a.qid, a); }); return m; }
function statsBy(keyFn) {
  const m = new Map();
  answers.forEach(a => { const q = BANK.byId.get(a.qid); if (!q) return; const k = keyFn(q); const o = m.get(k) || { t: 0, a: 0 }; o.t++; if (a.ok) o.a++; m.set(k, o); });
  return m;
}
/* ---------- histórico de relatórios (data e hora de cada relatório + comparação) ---------- */
const fmtDT = ts => { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const fmtPP = x => (x > 0.05 ? '+' : x < -0.05 ? '−' : '') + Math.abs(Math.round(x * 10) / 10).toString().replace('.', ',') + ' pp';
const deltaCls = x => x > 0.05 ? 'ok' : x < -0.05 ? 'bad' : 'mut';
const deltaArrow = x => x > 0.05 ? '▲ ' : x < -0.05 ? '▼ ' : '= ';
function summarize(list) {
  const byD = new Map(), byA = new Map(); let ok = 0, tot = 0;
  list.forEach(a => {
    const q = BANK.byId.get(a.qid); if (!q) return; tot++; if (a.ok) ok++;
    [[byD, q.disc], [byA, q.disc + '||' + q.assunto]].forEach(([m, k]) => { const o = m.get(k) || { t: 0, a: 0 }; o.t++; if (a.ok) o.a++; m.set(k, o); });
  });
  return { tot, ok, p: pct(ok, tot), byD, byA };
}
function saveSnapshot(ts) {
  ts = ts || Date.now();
  if (!reports.some(t => Math.abs(t - ts) < 60000)) { reports.push(ts); reports.sort((a, b) => a - b); LS.set('reports', reports); }
  return ts;
}
function historyRows() {
  let prev = null;
  return reports.slice().sort((a, b) => a - b).map(T => {
    const s = summarize(answers.filter(a => a.ts <= T));
    const r = { T, tot: s.tot, ok: s.ok, p: s.p, delta: prev ? s.p - prev.p : null, added: prev ? s.tot - prev.tot : s.tot }; prev = s; return r;
  });
}
function compareWith(T, nowTs) {
  const before = summarize(answers.filter(a => a.ts <= T)), now = summarize(nowTs ? answers.filter(a => a.ts <= nowTs) : answers), per = summarize(answers.filter(a => a.ts > T && (!nowTs || a.ts <= nowTs)));
  const g = (m, k) => m.get(k) || { t: 0, a: 0 };
  const cell = o => ({ t: o.t, a: o.a, p: pct(o.a, o.t) });
  const rowsD = BANK.disciplinas.map(d => { const b = g(before.byD, d), n = g(now.byD, d), p = g(per.byD, d); return { d, b: cell(b), n: cell(n), per: cell(p), delta: b.t && n.t ? pct(n.a, n.t) - pct(b.a, b.t) : null }; }).filter(r => r.b.t || r.n.t);
  const as = [];
  now.byA.forEach((n, k) => { const b = g(before.byA, k), p = g(per.byA, k); if (b.t >= 3 && p.t >= 3) { const [d, a] = k.split('||'); as.push({ d, as: a, bp: pct(b.a, b.t), pp: pct(p.a, p.t), delta: pct(p.a, p.t) - pct(b.a, b.t), pt: p.t }); } });
  as.sort((x, y) => y.delta - x.delta);
  return { T, before, now, per, rowsD, up: as.filter(x => x.delta > 0).slice(0, 5), down: as.filter(x => x.delta < 0).slice(-5).reverse(), dTot: now.p - before.p };
}
const level = (t, a) => { if (t < 3) return ['x', 'Poucos dados']; const p = a * 100 / t; return p >= 75 ? ['f', 'Forte'] : p >= 60 ? ['m', 'Regular'] : ['w', 'Fraco']; };
const barCls = (t, a) => { if (t < 3) return ''; const p = a * 100 / t; return p >= 75 ? 'g' : p >= 60 ? 'y' : 'r'; };

/* ---------- filtros / sessões ---------- */
function filterQs(f) {
  const last = lastByQ(); const S = new Set(f.sims), D = new Set(f.discs), A = new Set(f.assuntos);
  return BANK.questions.filter(q => {
    if (S.size && !S.has(q.sim)) return false;
    if (D.size && !D.has(q.disc)) return false;
    if (A.size && !A.has(q.disc + '||' + q.assunto)) return false;
    const l = last.get(q.id);
    if (f.status === 'new') return !l;
    if (f.status === 'wrong') return l && !l.ok;
    if (f.status === 'right') return l && l.ok;
    if (f.status === 'unright') return !l || !l.ok;
    return true;
  });
}
function startSession(qids, title) {
  if (!qids.length) { toast('Nenhuma questão encontrada com esses filtros.'); return; }
  session = { id: 's' + Date.now(), ts: Date.now(), title: title || 'Sessão de estudo', qids, idx: 0, results: {} };
  saveSession(); location.hash = '#/questao';
}
function startFromFilters(f, title) {
  let list = filterQs(f);
  list = f.order === 'rand' ? shuffle(list) : list.slice().sort((a, b) => (a.sim + a.n).localeCompare(b.sim + b.n, 'pt', { numeric: true }));
  const n = parseInt(f.count, 10); if (n > 0) list = list.slice(0, n);
  startSession(list.map(q => q.id), title);
}
function examMock() {
  const out = []; BANK.disciplinas.forEach(d => out.push(...shuffle(BANK.questions.filter(q => q.disc === d)).slice(0, weightOf(d))));
  startSession(out.map(q => q.id), 'Simulado aleatório (padrão da prova)');
}
function recordAnswer(q, chosen) {
  const a = { qid: q.id, chosen, ok: chosen === q.gab, ts: Date.now(), sess: session.id, synced: false };
  answers.push(a); saveAnswers(); session.results[q.id] = { chosen, ok: a.ok }; saveSession(); Cloud.pushAnswer(a); reportSimulados();
}

/* ---------- importação de simulados (somente PDF) ---------- */
async function importPackages(pkgs) {
  // O simulado entra SÓ na conta de quem o adicionou (ninguém mais vê). Sem login/internet: fica neste aparelho e sobe depois.
  let added = 0, offline = 0;
  for (const raw of pkgs) {
    const pk = cleanPackage(raw); if (!pk) continue;           // só entra o que passou na sanitização
    added++;
    if (Cloud.token) { try { await Cloud.publish(pk); continue; } catch (e) { offline++; } }
    custom.push(pk);
  }
  LS.set('custom', custom); buildBank();
  return { added, offline };
}
function dupOf(pk) {
  const have = new Set(BANK.questions.map(qKey));
  const same = pk.questions.filter(q => have.has(qKey(q))).length;
  return same >= pk.questions.length * 0.5 || BANK.sims.some(s => s.id === pk.sim.id);
}

/* ---------- relatório ---------- */
function refsFor(key) {
  const last = lastByQ(), laws = new Map(), arts = new Map();
  last.forEach(a => {
    if (a.ok) return; const q = BANK.byId.get(a.qid); if (!q || q.disc + '||' + q.assunto !== key) return;
    const st = Explain.study(q); st.laws.forEach(x => laws.set(x, (laws.get(x) || 0) + 1)); st.arts.forEach(x => arts.set(x, (arts.get(x) || 0) + 1));
  });
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const L = top(laws).slice(0, 3), A = top(arts).slice(0, 6);
  return (L.length || A.length) ? [(L.length ? L.join(', ') : '') + (L.length && A.length ? ' — ' : '') + A.join(', ')] : [];
}
function computeReport() {
  const tot = answers.length, ok = answers.filter(a => a.ok).length;
  const byD = statsBy(q => q.disc), byA = statsBy(q => q.disc + '||' + q.assunto);
  const rowsD = BANK.disciplinas.map(d => { const s = byD.get(d) || { t: 0, a: 0 }; return { d, ...s, p: pct(s.a, s.t) }; });
  const ranked = rowsD.filter(r => r.t >= 3).sort((x, y) => y.p - x.p);
  const rowsA = [...byA.entries()].map(([k, s]) => { const [d, a] = k.split('||'); return { k, d, as: a, ...s, acc: s.a / s.t }; }).sort((x, y) => x.acc - y.acc);
  const prio = rowsA.filter(r => r.t >= 2 && r.acc < 0.75).map(r => ({ ...r, peso: weightOf(r.d), score: (1 - r.acc) * weightOf(r.d) * Math.min(1, r.t / 4), refs: refsFor(r.k) })).sort((x, y) => y.score - x.score).slice(0, 8);
  const untouched = []; BANK.disciplinas.forEach(d => [...new Set(BANK.questions.filter(q => q.disc === d).map(q => q.assunto))].forEach(a => { if (!byA.get(d + '||' + a)) untouched.push({ d, a }); }));
  const ses = new Map(); answers.forEach(a => { const o = ses.get(a.sess) || { ts: a.ts, t: 0, a: 0 }; o.t++; if (a.ok) o.a++; ses.set(a.sess, o); });
  const evo = [...ses.values()].filter(s => s.t >= 5).sort((x, y) => x.ts - y.ts).slice(-15);
  const generatedAt = Date.now(), prevT = reports.filter(t => t < generatedAt - 60000).pop();
  const tss = answers.map(a => a.ts);
  return { tot, ok, pOk: pct(ok, tot), rowsD, rowsA, strong: ranked.slice(0, 3), weak: ranked.slice().reverse().slice(0, 3), prio, untouched, evo, generatedAt, firstTs: tss.length ? Math.min(...tss) : null, lastTs: tss.length ? Math.max(...tss) : null,
    compare: prevT ? compareWith(prevT) : null, history: historyRows(), reports: reports.slice(), answers: answers.map(a => [a.qid, a.chosen, a.ok ? 1 : 0, a.ts]) };
}

/* ---------- views ---------- */
function setNav(r) { document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r)); }
function countdown() {
  const el = document.getElementById('countdown'); if (!el || !CFG.EXAM_DATE) return;
  const d = Math.ceil((new Date(CFG.EXAM_DATE + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5);
  const dt = new Date(CFG.EXAM_DATE + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  el.textContent = d > 1 ? 'Faltam ' + d + ' dias · prova em ' + dt : d === 1 ? 'Falta 1 dia · prova amanhã (' + dt + ')' : d === 0 ? 'A prova é HOJE — boa sorte!' : '';
}
const statCard = (v, l, cls) => `<div class="card stat"><b class="${cls || ''}">${v}</b><span>${l}</span></div>`;

function viewSecretKeyAlert() {
  document.body.classList.add('gate');
  $app.innerHTML = '<h1>⚠ Configuração insegura</h1><div class="notice">O arquivo <b>config.js</b> contém uma chave <b>SECRETA</b> do Supabase (service_role / sb_secret). Isso dá acesso total ao seu banco a qualquer visitante do site. <b>O app foi bloqueado.</b><br><br>1) Apague a chave do config.js e do histórico do GitHub; 2) no painel do Supabase, gere uma nova chave secreta (a antiga deve ser considerada vazada); 3) use no config.js apenas a chave pública "anon" / "publishable".</div>';
}
function viewLogin() {
  document.body.classList.add('gate'); setNav('');
  $app.innerHTML = `
  <h1>Bem-vindo ao Estudo PMSC</h1>
  <p class="mut">Entre com seu <b>nome de usuário e senha</b>. Não pedimos e-mail nem nenhum dado pessoal. Seu progresso fica salvo só para você.</p>
  <div class="grid g2">
    <form class="card" data-form="login"><h3>Já tenho cadastro</h3>
      <label class="f" for="lu">Nome de usuário</label><input id="lu" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <label class="f" for="lp">Senha</label><input id="lp" type="password" autocomplete="current-password" required>
      <label class="opt show"><input type="checkbox" data-act="show-pw"> Mostrar senha</label>
      <button class="btn pri full" type="submit">Entrar</button></form>
    <form class="card" data-form="register"><h3>Primeiro acesso? Crie seu cadastro</h3>
      <label class="f" for="ru">Escolha um nome de usuário</label><input id="ru" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="ex.: joao.silva" required>
      <div class="small mut">3 a 20 caracteres: letras minúsculas, números, ponto, traço ou _</div>
      <label class="f" for="rp">Crie uma senha (mínimo 8 caracteres)</label><input id="rp" type="password" autocomplete="new-password" minlength="8" required>
      <label class="f" for="ri">Código de convite</label><input id="ri" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="peça a quem convidou você" required>
      <label class="opt show"><input type="checkbox" data-act="show-pw"> Mostrar senha</label>
      <button class="btn pri full" type="submit">Criar cadastro e entrar</button></form>
  </div>
  <div class="notice">Anote sua senha: como não usamos e-mail, não há "esqueci minha senha" automático (quem administra o sistema pode redefinir).</div>`;
}

function viewHome() {
  setNav('home');
  const tot = answers.length, ok = answers.filter(a => a.ok).length, last = lastByQ();
  const answered = last.size, totalQ = BANK.questions.length, wrongNow = [...last.values()].filter(a => !a.ok).length;
  const byD = statsBy(q => q.disc);
  const cont = session && Object.keys(session.results).length < session.qids.length ? session : null;
  $app.innerHTML = `
  <h1>Olá${Cloud.username ? ', ' + esc(Cloud.username) : ''}! Vamos estudar?</h1>
  ${totalQ === 0 ? `<div class="notice"><b>Ainda não há questões carregadas.</b> ${Cloud.token ? 'Cada pessoa vê só os simulados que ela mesma adicionou: vá em <a href="#/banco">Banco</a> e adicione os PDFs dos seus simulados.' : 'Vá em <a href="#/banco">Banco</a> e adicione os PDFs dos simulados.'}</div>` : ''}
  ${cont ? `<div class="card"><b>Sessão em andamento:</b> ${esc(cont.title)} — ${Object.keys(cont.results).length}/${cont.qids.length} respondidas.
    <div class="row" style="margin-top:10px"><a class="btn pri" href="#/questao">Continuar</a><button class="btn" data-act="drop-session">Descartar</button></div></div>` : ''}
  <div class="grid g4">
    ${statCard(totalQ, 'questões no banco')}${statCard(tot, 'respostas dadas')}
    ${statCard(tot ? fmtPct(pct(ok, tot)) : '—', 'de acerto', tot ? (pct(ok, tot) >= 70 ? 'ok' : pct(ok, tot) < 50 ? 'bad' : '') : '')}
    ${statCard(wrongNow, 'para revisar', wrongNow ? 'bad' : '')}
  </div>
  <h2>Começar</h2>
  <div class="grid g2">
    <div class="card"><h3>Misturar tudo</h3><p class="mut small">Todas as ${totalQ} questões em ordem aleatória.</p>
      <div class="row"><button class="btn pri" data-act="mix-all">Misturar tudo</button><button class="btn" data-act="mix-new">Só inéditas (${totalQ - answered})</button></div></div>
    <div class="card"><h3>Simulado no padrão da prova</h3><p class="mut small">60 questões sorteadas na proporção de cada disciplina da prova.</p>
      <button class="btn pri" data-act="mock">Gerar simulado de 60</button></div>
    <div class="card"><h3>Revisar meus erros</h3><p class="mut small">${wrongNow} questão(ões) em que a última tentativa foi errada.</p>
      <button class="btn pri" data-act="review-wrong" ${wrongNow ? '' : 'disabled'}>Revisar erros</button></div>
    <div class="card"><h3>Escolher quantidade e assunto</h3><p class="mut small">Filtre por simulado, disciplina e assunto e escolha quantas questões quer fazer.</p>
      <a class="btn pri" href="#/praticar">Montar minha prática</a></div>
  </div>
  ${tot ? `<h2>Seu desempenho por disciplina</h2><div class="card">${BANK.disciplinas.filter(d => byD.get(d)).map(d => { const s = byD.get(d); return `<div style="margin:8px 0"><div class="row" style="justify-content:space-between"><span>${esc(d)}</span><span class="small mut">${s.a}/${s.t} · <b>${fmtPct(pct(s.a, s.t))}</b></span></div><div class="bar ${barCls(s.t, s.a)}"><i style="width:${pct(s.a, s.t)}%"></i></div></div>`; }).join('')}
    <a class="btn" href="#/relatorio">Ver relatório completo</a></div>` : ''}`;
}

const QTY = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
function qtyHtml(matches) {
  const f = filters, n = +f.count;
  return `<label class="f">Quantas questões? <span class="mut small">(${matches} disponíveis com esses filtros)</span></label>
  <div id="qty-chips">${QTY.map(v => `<button type="button" class="chip ${n === v ? 'sel' : ''}" data-act="qty" data-v="${v}">${v}</button>`).join('')}<button type="button" class="chip ${n === 0 ? 'sel' : ''}" data-act="qty" data-v="0">Todas</button></div>
  <div class="row" style="margin-top:6px"><label for="qty-custom" class="small">Ou digite a quantidade que quiser:</label>
  <input type="number" inputmode="numeric" id="qty-custom" data-act="qty-custom" min="1" max="${Math.max(matches, 1)}" placeholder="ex.: 35" value="${n > 0 && !QTY.includes(n) ? n : ''}" style="width:110px"></div>`;
}
function refreshStartBtn() {
  const matches = filterQs(filters).length, n = +filters.count, btn = document.querySelector('[data-act="go-filters"]');
  if (btn) { btn.disabled = !matches; btn.textContent = `Começar (${n > 0 ? Math.min(n, matches) : matches} questões)`; }
  document.querySelectorAll('#qty-chips .chip').forEach(c => c.classList.toggle('sel', +c.dataset.v === n));
}

function viewPractice() {
  setNav('praticar');
  const f = filters;
  const groups = BANK.disciplinas.map(d => ({ d, as: [...new Set(BANK.questions.filter(q => q.disc === d).map(q => q.assunto))] }));
  const matches = filterQs(f).length;
  $app.innerHTML = `
  <h1>Praticar</h1>
  <div class="card filters">
    ${qtyHtml(matches)}
    <h3 style="margin-top:16px">Simulados <span class="mut small">(nenhum marcado = todos)</span></h3>
    <div>${BANK.sims.map(s => `<button type="button" class="chip ${f.sims.includes(s.id) ? 'sel' : ''}" data-act="tog-sim" data-v="${esc(s.id)}">${esc(shortSim(s.nome))}</button>`).join('')}</div>
    <h3 style="margin-top:12px">Disciplinas <span class="mut small">(nenhuma marcada = todas)</span></h3>
    <div>${BANK.disciplinas.map(d => `<button type="button" class="chip ${f.discs.includes(d) ? 'sel' : ''}" data-act="tog-disc" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
    <h3 style="margin-top:12px">Assuntos <span class="mut small">(opcional)</span></h3>
    ${groups.filter(g => !f.discs.length || f.discs.includes(g.d)).map(g => `<details class="dsc" ${g.as.some(a => f.assuntos.includes(g.d + '||' + a)) ? 'open' : ''}><summary>${esc(g.d)}</summary>
      ${g.as.map(a => { const k = g.d + '||' + a; const n = BANK.questions.filter(q => q.disc === g.d && q.assunto === a).length; return `<label class="opt"><input type="checkbox" data-act="tog-as" data-v="${esc(k)}" ${f.assuntos.includes(k) ? 'checked' : ''}> <span>${esc(a)} <span class="mut small">(${n})</span></span></label>`; }).join('')}</details>`).join('')}
    <div class="grid g2" style="margin-top:14px">
      <div><label class="f">Quais questões</label><select data-act="set-status">
        ${[['all', 'Todas'], ['new', 'Ainda não respondidas'], ['wrong', 'Que errei na última vez'], ['unright', 'Inéditas + erradas'], ['right', 'Que acertei na última vez']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label class="f">Ordem</label><select data-act="set-order"><option value="rand" ${f.order === 'rand' ? 'selected' : ''}>Aleatória</option><option value="orig" ${f.order === 'orig' ? 'selected' : ''}>Ordem original da prova</option></select></div>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn pri" data-act="go-filters" ${matches ? '' : 'disabled'}>Começar (${+f.count > 0 ? Math.min(+f.count, matches) : matches} questões)</button>
    <button class="btn" data-act="clear-filters">Limpar filtros</button></div>
  </div>`;
}

/* ----- explicação detalhada ----- */
const quote = t => `<blockquote class="quote">“${esc(t)}”</blockquote>`;
function studyBox(q) {
  const st = Explain.study(q); const key = q.disc + '||' + q.assunto;
  return `<div class="study"><div class="t">📚 O que estudar</div>
    <div><b>Disciplina:</b> ${esc(q.disc)}</div><div><b>Assunto:</b> ${esc(q.assunto)}${q.tema ? ' — ' + esc(q.tema) : ''}</div>
    ${st.laws.length ? `<div><b>Norma(s) cobrada(s):</b> ${st.laws.map(esc).join('; ')}</div>` : ''}
    ${st.arts.length ? `<div><b>Dispositivos para reler na íntegra:</b> ${st.arts.map(esc).join(' · ')}</div>` : ''}
    <div class="small mut" style="margin-top:4px">Releia o texto da lei nesses dispositivos (com atenção a prazos, números e exceções) e depois treine o assunto.</div>
    <div class="noprint" style="margin-top:8px"><button class="btn sm" data-act="drill" data-v="${esc(key)}" data-s="all">Treinar este assunto</button></div></div>`;
}
function feedback(q, res) {
  const ex = Explain.explain(q), ok = res.ok;
  let h = `<div class="fb ${ok ? 'ok' : 'bad'}"><div class="t">${ok ? '✔ Acertou! A resposta é a ' + esc(q.gab) + '.' : '✘ Errou. Você marcou a ' + esc(res.chosen) + '; a correta é a ' + esc(q.gab) + '.'}</div>`;
  if (!ok) {
    h += `<div class="blk"><b>Sua resposta (${esc(res.chosen)}):</b>${quote(q.alts[res.chosen])}`;
    h += ex.wrong && ex.wrong[res.chosen] ? `<div><b>Por que está errada:</b> ${esc(ex.wrong[res.chosen])}</div>` : '';
    h += '</div>';
  }
  h += `<div class="blk"><b>Alternativa correta (${esc(q.gab)}):</b>${quote(q.alts[q.gab])}`;
  if (ex.has) {
    if (ex.fundamento) h += `<div><b>Base legal:</b> ${esc(ex.fundamento)}</div>`;
    if (ex.why) h += `<div><b>Por que está certa:</b> ${esc(ex.why)}</div>`;
  } else h += `<div class="mut">Este simulado não traz comentário. O gabarito oficial é a alternativa ${esc(q.gab)}.</div>`;
  h += '</div>';
  const others = Object.keys(q.alts).sort().filter(l => l !== q.gab && !(l === res.chosen && !ok));
  if (ex.wrong && others.length) {
    h += `<div class="blk"><b>Por que as outras estão erradas:</b>${others.map(l => ex.wrong[l] ? `<div class="alt-ex"><span class="l2">${l}</span><div>${quote(q.alts[l])}<div>${esc(ex.wrong[l])}</div></div></div>` : '').join('')}</div>`;
  } else if (ex.clauses && ex.clauses.length) {
    h += `<div class="blk"><b>Análise das demais alternativas:</b><ul>${ex.clauses.map(c => `<li>${esc(c)}</li>`).join('')}</ul><div class="small mut">As afirmações acima seguem a ordem do comentário da prova (que nem sempre segue a ordem das letras).</div></div>`;
  } else if (ex.rest) h += `<div class="blk"><b>Comentário sobre as demais:</b> ${esc(ex.rest)}</div>`;
  if (ex.pegadinha) h += `<div class="blk peg"><b>⚠ Atenção (pegadinha da banca):</b> ${esc(ex.pegadinha)}</div>`;
  h += studyBox(q) + '</div>';
  return h;
}

function viewQuestion() {
  setNav('praticar');
  if (!session || !session.qids.length) { location.hash = '#/praticar'; return; }
  const total = session.qids.length, i = session.idx;
  if (i >= total) { location.hash = '#/resultado'; return; }
  const q = BANK.byId.get(session.qids[i]);
  if (!q) { session.idx++; saveSession(); return viewQuestion(); }
  const res = session.results[q.id], done = Object.keys(session.results).length;
  const tx = q.texto && BANK.texts[q.texto], letters = Object.keys(q.alts).sort();
  $app.innerHTML = `
  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${esc(session.title)}</b><span class="small mut">Questão ${i + 1} de ${total} · ${done} respondida(s)</span></div>
    <div class="bar"><i style="width:${(done / total) * 100}%"></i></div>
  </div>
  <div class="card">
    <div><span class="chip">${esc(shortSim(simName(q.sim)))} · Q${q.n}</span><span class="chip">${esc(q.disc)}</span><span class="chip">${esc(q.assunto)}</span></div>
    ${tx ? `<details class="support" open><summary><b>Texto de apoio</b></summary><h4>${esc(tx.title || '')}</h4>${(tx.paras || []).map(p => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
    <div class="stem">${fmtStem(q.stem)}</div>
    <div class="alts">${letters.map(l => {
      let cls = ''; if (res) { if (l === q.gab) cls = 'right'; else if (l === res.chosen) cls = 'wrong'; }
      return `<button class="alt ${cls}" data-act="answer" data-v="${l}" ${res ? 'disabled' : ''}><span class="l">${l}</span><span>${esc(q.alts[l])}</span></button>`;
    }).join('')}</div>
    ${res ? feedback(q, res) : `<p class="small mut kbd" style="margin-top:12px">Dica: no computador, use as teclas A–E para responder e Enter para avançar.</p>`}
    <div class="row navrow">
      <button class="btn" data-act="prev" ${i === 0 ? 'disabled' : ''}>← Anterior</button>
      <button class="btn" data-act="finish">Encerrar</button>
      <button class="btn pri" data-act="next">${i === total - 1 ? 'Ver resultado' : (res ? 'Próxima →' : 'Pular →')}</button>
    </div>
  </div>`;
  window.scrollTo({ top: 0 });
}

function viewResult() {
  setNav('praticar');
  if (!session) { location.hash = '#/'; return; }
  const items = session.qids.map(id => ({ q: BANK.byId.get(id), r: session.results[id] })).filter(x => x.q);
  const answered = items.filter(x => x.r), ok = answered.filter(x => x.r.ok).length, bad = answered.length - ok, skipped = items.length - answered.length;
  const byD = new Map(); answered.forEach(x => { const o = byD.get(x.q.disc) || { t: 0, a: 0 }; o.t++; if (x.r.ok) o.a++; byD.set(x.q.disc, o); });
  const p = pct(ok, answered.length);
  $app.innerHTML = `
  <h1>Resultado da sessão</h1>
  <div class="card" style="text-align:center"><div class="bigpct ${p >= 70 ? 'ok' : p < 50 ? 'bad' : ''}">${answered.length ? fmtPct(p) : '—'}</div>
    <div class="mut"><b class="ok">${ok} acertos</b> (${fmtPct(pct(ok, answered.length))}) · <b class="bad">${bad} erros</b> (${fmtPct(pct(bad, answered.length))})${skipped ? ' · ' + skipped + ' sem resposta' : ''}</div></div>
  <div class="card"><h3>Por disciplina</h3><table><tr><th>Disciplina</th><th class="n">Acertos</th><th class="n">%</th></tr>
    ${[...byD.entries()].map(([d, s]) => `<tr><td>${esc(d)}</td><td class="n">${s.a}/${s.t}</td><td class="n"><b>${fmtPct(pct(s.a, s.t))}</b></td></tr>`).join('')}</table></div>
  ${bad ? `<div class="card"><h3>Questões erradas — o que revisar</h3>${answered.filter(x => !x.r.ok).map(x => { const st = Explain.study(x.q); return `<div style="margin:12px 0;padding-bottom:10px;border-bottom:1px solid var(--line)"><span class="chip">${esc(shortSim(simName(x.q.sim)))} · Q${x.q.n}</span><span class="chip">${esc(x.q.assunto)}</span>
    <div class="small">${esc(x.q.stem).slice(0, 170)}…</div><div class="small"><b class="bad">Você: ${x.r.chosen}</b> · <b class="ok">Correta: ${x.q.gab}</b>${st.arts.length ? ' · <b>Estude:</b> ' + st.arts.slice(0, 4).map(esc).join(', ') + (st.laws[0] ? ' (' + esc(st.laws[0]) + ')' : '') : ''}</div></div>`; }).join('')}</div>` : ''}
  <div class="row noprint"><button class="btn pri" data-act="retry-wrong" ${bad ? '' : 'disabled'}>Refazer os erros</button><a class="btn" href="#/praticar">Nova sessão</a><a class="btn" href="#/relatorio">Relatório geral</a></div>`;
}

function historyHtml(R) {
  const hist = R.history.slice().reverse();
  if (cmpBase == null || !reports.includes(cmpBase)) cmpBase = reports.length ? reports[reports.length - 1] : null;
  const dTag = x => x == null ? '<span class="mut">—</span>' : `<b class="${deltaCls(x)}">${deltaArrow(x)}${fmtPP(x)}</b>`;
  let h = `<h2>Histórico de relatórios</h2><div class="card">
    <p class="small mut" style="margin-top:0">Cada relatório guarda a <b>data e a hora</b> em que foi gerado e o seu desempenho naquele momento. Assim você compara a sua evolução de um relatório para o outro. Ao baixar o PDF, o relatório também entra aqui.</p>
    <p class="small"><b>Este relatório foi gerado em ${fmtDT(R.generatedAt)}</b>${R.firstTs ? ` · cobre respostas de ${fmtDT(R.firstTs)} até ${fmtDT(R.lastTs)}` : ''}.</p>
    <div class="row noprint" style="margin-bottom:10px"><button class="btn pri sm" data-act="save-report">Salvar relatório de agora no histórico</button></div>`;
  if (!hist.length) h += `<p class="small mut">Nenhum relatório salvo ainda. Salve um agora e, depois de estudar mais, salve outro: o app mostra o que melhorou e o que piorou entre os dois.</p>`;
  else h += `<div style="overflow-x:auto"><table><tr><th>Data e hora do relatório</th><th class="n">Respostas</th><th class="n">Aproveitamento</th><th class="n">Variação</th><th class="noprint"></th></tr>
    ${hist.map(r => `<tr><td>${fmtDT(r.T)}</td><td class="n">${r.tot}${r.added != null && r.delta != null ? ` <span class="small mut">(+${r.added})</span>` : ''}</td><td class="n"><b>${fmtPct(r.p)}</b></td><td class="n">${dTag(r.delta)}</td>
    <td class="n noprint">${r.T === cmpBase ? '<span class="tag f">Comparando</span>' : `<button class="btn sm" data-act="cmp-base" data-v="${r.T}">Comparar com agora</button>`}</td></tr>`).join('')}</table></div>
    <p class="small mut">A variação é a diferença em pontos percentuais (pp) em relação ao relatório anterior da lista.</p>`;
  h += '</div>';
  if (cmpBase != null) {
    const c = compareWith(cmpBase), nAdd = c.now.tot - c.before.tot;
    h += `<h2>Comparação: ${fmtDT(cmpBase)} → agora</h2><div class="card">
      <div class="grid g4" style="margin-bottom:10px">
        <div class="card stat" style="margin:0"><b>${fmtPct(c.before.p)}</b><span>em ${fmtDT(cmpBase)}</span></div>
        <div class="card stat" style="margin:0"><b>${fmtPct(c.now.p)}</b><span>agora (${fmtDT(R.generatedAt)})</span></div>
        <div class="card stat" style="margin:0"><b class="${deltaCls(c.dTot)}">${deltaArrow(c.dTot)}${fmtPP(c.dTot)}</b><span>variação geral</span></div>
        <div class="card stat" style="margin:0"><b>${nAdd}</b><span>respostas no período${c.per.tot ? ' · ' + fmtPct(c.per.p) + ' de acerto' : ''}</span></div>
      </div>
      ${nAdd ? '' : '<p class="small mut">Ainda não há respostas depois deste relatório. Estude mais e volte aqui para ver a comparação.</p>'}
      <div style="overflow-x:auto"><table><tr><th>Disciplina</th><th class="n">Antes</th><th class="n">Agora</th><th class="n">Variação</th><th class="n">No período</th></tr>
      ${c.rowsD.map(r => `<tr><td>${esc(r.d)}</td><td class="n">${r.b.t ? fmtPct(r.b.p) + ' <span class="small mut">(' + r.b.a + '/' + r.b.t + ')</span>' : '—'}</td><td class="n">${r.n.t ? fmtPct(r.n.p) + ' <span class="small mut">(' + r.n.a + '/' + r.n.t + ')</span>' : '—'}</td>
      <td class="n">${r.delta == null ? '—' : `<b class="${deltaCls(r.delta)}">${deltaArrow(r.delta)}${fmtPP(r.delta)}</b>`}</td><td class="n">${r.per.t ? fmtPct(r.per.p) + ' <span class="small mut">(' + r.per.a + '/' + r.per.t + ')</span>' : '—'}</td></tr>`).join('')}</table></div>
      ${(c.up.length || c.down.length) ? `<div class="grid g2" style="margin-top:12px">
        <div><h3 class="ok">▲ Assuntos que melhoraram</h3>${c.up.length ? c.up.map(x => `<div class="small">${esc(x.as)} <span class="mut">(${esc(x.d)})</span><br><b class="ok">${fmtPct(x.bp)} → ${fmtPct(x.pp)} (${fmtPP(x.delta)})</b></div>`).join('') : '<span class="small mut">Nenhum com dados suficientes.</span>'}</div>
        <div><h3 class="bad">▼ Assuntos que pioraram</h3>${c.down.length ? c.down.map(x => `<div class="small">${esc(x.as)} <span class="mut">(${esc(x.d)})</span><br><b class="bad">${fmtPct(x.bp)} → ${fmtPct(x.pp)} (${fmtPP(x.delta)})</b></div>`).join('') : '<span class="small mut">Nenhum com dados suficientes.</span>'}</div></div>
        <p class="small mut">Compara o acerto até o relatório antigo com o acerto nas respostas dadas depois dele (assuntos com pelo menos 3 respostas em cada fase).</p>` : ''}
    </div>`;
  }
  return h;
}
function viewReport() {
  setNav('relatorio');
  if (!answers.length) { $app.innerHTML = `<h1>Relatório de desempenho</h1><div class="card">Você ainda não respondeu nenhuma questão. <a href="#/praticar">Comece a praticar</a> e volte aqui para ver seus pontos fortes e fracos.</div>`; return; }
  const R = computeReport(), W = 600, H = 120;
  const svg = R.evo.length >= 2 ? (() => {
    const px = i => 20 + i * (W - 40) / (R.evo.length - 1), py = v => H - 15 - v * (H - 30) / 100;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolução do percentual de acerto por sessão"><line x1="20" x2="${W - 20}" y1="${py(70)}" y2="${py(70)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="4 4"/><text x="${W - 20}" y="${py(70) - 4}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">meta 70%</text>
      <polyline fill="none" stroke="var(--pri)" stroke-width="2.5" points="${R.evo.map((s, i) => px(i) + ',' + py(s.a * 100 / s.t)).join(' ')}"/>
      ${R.evo.map((s, i) => `<circle cx="${px(i)}" cy="${py(s.a * 100 / s.t)}" r="4" fill="var(--pri)"><title>${new Date(s.ts).toLocaleDateString('pt-BR')}: ${fmtPct(pct(s.a, s.t))} (${s.t} questões)</title></circle>`).join('')}</svg>`;
  })() : '<p class="mut small">Faça ao menos 2 sessões com 5+ questões para ver a evolução.</p>';
  const lv = r => { const [c, l] = level(r.t, r.a); return `<span class="tag ${c}">${l}</span>`; };
  $app.innerHTML = `
  <div class="row" style="justify-content:space-between"><h1>Relatório de desempenho</h1><div class="row noprint"><button class="btn sm" data-act="export-progress">Baixar em PDF</button></div></div>
  <p class="small mut" style="margin-top:-6px">Gerado em <b>${fmtDT(R.generatedAt)}</b></p>
  <div class="grid g4">${statCard(R.tot, 'respostas')}${statCard(R.ok, 'acertos', 'ok')}${statCard(R.tot - R.ok, 'erros', 'bad')}${statCard(fmtPct(R.pOk), 'aproveitamento')}</div>
  <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between"><b>Acertos × erros</b><span class="small mut">${fmtPct(R.pOk)} / ${fmtPct(100 - R.pOk)}</span></div>
    <div class="bar" style="height:16px;display:flex"><i style="width:${R.pOk}%;background:var(--ok)"></i><i style="width:${100 - R.pOk}%;background:var(--bad)"></i></div></div>
  ${historyHtml(R)}
  <h2>Pontos mais fortes e mais fracos</h2>
  <div class="grid g2">
    <div class="card"><h3 class="ok">💪 Mais fortes</h3>${R.strong.length ? R.strong.map(r => `<div>${esc(r.d)} — <b>${fmtPct(r.p)}</b> <span class="small mut">(${r.a}/${r.t})</span></div>`).join('') : '<span class="mut small">Responda ao menos 3 questões por disciplina.</span>'}</div>
    <div class="card"><h3 class="bad">⚠ Mais fracos</h3>${R.weak.length ? R.weak.map(r => `<div>${esc(r.d)} — <b>${fmtPct(r.p)}</b> <span class="small mut">(${r.a}/${r.t})</span></div>`).join('') : '<span class="mut small">Responda ao menos 3 questões por disciplina.</span>'}</div>
  </div>
  <h2>O que estudar primeiro</h2>
  <div class="card">${R.prio.length ? `<p class="mut small">Ordenado por: taxa de erro × peso da disciplina na prova — o que mais custa pontos fica no topo.</p>` +
    R.prio.map((r, i) => `<div class="rec"><b>${i + 1}. ${esc(r.as)}</b> <span class="small mut">(${esc(r.d)} · peso ${r.peso}/60)</span><br>Você acertou <b>${fmtPct(r.acc * 100)}</b> (${r.a}/${r.t}).
      ${r.refs.length ? `<div class="small"><b>Revise:</b> ${esc(r.refs[0])}</div>` : ''}
      <div class="noprint" style="margin-top:6px"><button class="btn sm" data-act="drill" data-v="${esc(r.k)}" data-s="wrong">Refazer erradas</button> <button class="btn sm" data-act="drill" data-v="${esc(r.k)}" data-s="all">Treinar assunto</button></div></div>`).join('')
    : '<span class="mut">Nenhum assunto abaixo de 75% com dados suficientes. Continue praticando para refinar a análise.</span>'}
    ${R.untouched.length ? `<details style="margin-top:10px"><summary class="small"><b>${R.untouched.length} assuntos ainda sem nenhuma resposta</b></summary><ul class="small">${R.untouched.map(u => `<li>${esc(u.a)} <span class="mut">(${esc(u.d)})</span></li>`).join('')}</ul></details>` : ''}</div>
  <h2>Por disciplina</h2>
  <div class="card"><table><tr><th>Disciplina</th><th class="n">Acertos</th><th>Aproveitamento</th><th>Nível</th></tr>
  ${R.rowsD.map(r => `<tr><td>${esc(r.d)}</td><td class="n">${r.a}/${r.t}</td><td style="min-width:110px"><div class="small">${r.t ? fmtPct(r.p) : '—'}</div><div class="bar ${barCls(r.t, r.a)}"><i style="width:${r.t ? r.p : 0}%"></i></div></td><td>${lv(r)}</td></tr>`).join('')}</table></div>
  <h2>Por assunto</h2>
  <div class="card" style="overflow-x:auto"><table><tr><th>Assunto</th><th class="n">Acertos</th><th class="n">%</th><th>Nível</th></tr>
  ${R.rowsA.map(r => `<tr><td>${esc(r.as)}<div class="small mut">${esc(r.d)}</div></td><td class="n">${r.a}/${r.t}</td><td class="n"><b>${fmtPct(r.acc * 100)}</b></td><td>${lv(r)}</td></tr>`).join('')}</table></div>
  <h2>Evolução</h2><div class="card">${svg}</div>
  <p class="small mut">Níveis: Forte ≥ 75% · Regular 60–74% · Fraco &lt; 60% · "Poucos dados" = menos de 3 respostas.</p>`;
}

function viewBank() {
  setNav('banco');
  const last = lastByQ();
  const pv = pending ? `<div class="card" style="margin-top:12px"><h3>PDF(s) lido(s)</h3>
    ${pending.msgs.map(m => `<div class="notice">${esc(m)}</div>`).join('')}
    ${pending.pkgs.map((pk, i) => { const dup = pk.dup; const discs = [...new Set(pk.questions.map(q => q.disc))]; return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0">
      <label class="opt"><input type="checkbox" data-act="pk-sel" data-i="${i}" ${dup ? 'disabled' : 'checked'}> <b>${pk.questions.length} questões</b> lidas${dup ? ' — <span class="bad">já estão no banco, não será adicionado</span>' : ''}</label>
      <label class="f">Nome do simulado</label><input type="text" data-pk-name="${i}" value="${esc(pk.sim.nome)}" ${dup ? 'disabled' : ''}>
      <div class="small mut" style="margin-top:4px">${esc(discs.join(' · '))}${pk.questions.some(q => q.expl) ? '' : ' · sem comentários no PDF (só gabarito)'}</div>
      ${pk.errors && pk.errors.length ? `<div class="small bad">${pk.errors.length} questão(ões) ignorada(s): ${esc(pk.errors.slice(0, 3).join(' '))}</div>` : ''}</div>`; }).join('')}
    ${pending.pkgs.some(p => !p.dup) ? `<p class="small mut">O simulado ficará <b>só na sua conta</b>${Cloud.token ? '' : ' (neste aparelho)'}: ninguém mais vê.</p><div class="row" style="margin-top:8px"><button class="btn pri" data-act="add-pkgs">Adicionar ao banco</button><button class="btn" data-act="cancel-pkgs">Cancelar</button></div>` : `<button class="btn" data-act="cancel-pkgs">Fechar</button>`}</div>` : '';
  $app.innerHTML = `
  <h1>Banco de questões</h1>
  <div class="card" style="overflow-x:auto"><table><tr><th>Simulado</th><th class="n">Questões</th><th class="n">Feitas</th><th class="n">Acerto</th><th></th></tr>
  ${BANK.sims.map(s => {
    const qs = BANK.questions.filter(q => q.sim === s.id), ans = answers.filter(a => (BANK.byId.get(a.qid) || {}).sim === s.id), k = ans.filter(a => a.ok).length, seen = qs.filter(q => last.has(q.id)).length;
    return `<tr><td>${esc(s.nome)}<div class="small mut">${esc(s.fonte || '')}${s.origem !== 'base' ? ' · ' + esc(s.origem) : ''}${s.comentado === false ? ' · sem comentários' : ''}</div></td><td class="n">${qs.length}</td><td class="n">${seen}</td><td class="n">${ans.length ? fmtPct(pct(k, ans.length)) : '—'}</td>
    <td class="n">${s.origem === 'neste aparelho' ? `<button class="btn sm" data-act="del-sim" data-v="${esc(s.id)}">Remover</button>` : (s.origem === 'minha conta' ? `<button class="btn sm" data-act="del-cloud-sim" data-v="${esc(s.id)}">Remover</button>` : '')}</td></tr>`;
  }).join('')}</table><p class="small mut">Total: ${BANK.questions.length} questões em ${BANK.sims.length} simulados.</p></div>

  <h2>Adicionar simulado (PDF)</h2>
  <div class="card">
    <p class="small">Escolha o arquivo <b>PDF</b> do simulado (pode escolher vários de uma vez). O app lê as questões, o gabarito e os comentários sozinho.
    Para os cadernos da <i>VIP Preparatório</i>, escolha juntos o PDF do caderno e o do gabarito comentado.<br><b>Os simulados que você adiciona ficam só na sua conta:</b> nenhum outro usuário vê as suas questões, e você não vê as dos outros.</p>
    <input type="file" id="file-pdf" accept=".pdf,application/pdf" multiple>
    <div class="row" style="margin-top:10px"><button class="btn pri" data-act="read-pdfs">Ler PDF(s)</button><span id="read-status" class="small mut"></span></div>
    ${pv}
  </div>

  <h2>Meu progresso (PDF)</h2>
  <div class="card">
    <p class="small"><b>Exportar:</b> gera um PDF com o seu relatório completo (acertos, erros, pontos fortes e fracos e o que estudar). Ele também guarda seus dados para você poder reimportá-lo.</p>
    <p class="small"><b>Importar:</b> escolha um PDF que foi exportado aqui para somar as respostas dele ao seu progresso e atualizar seu nível (útil para trazer o progresso de outro aparelho).</p>
    <div class="row"><button class="btn pri" data-act="export-progress">Exportar meu progresso (PDF)</button>
    <label class="btn">Importar progresso (PDF)<input type="file" id="file-progress" accept=".pdf,application/pdf" style="display:none"></label>
    <button class="btn" data-act="reset-progress" style="color:var(--bad)">Zerar meu progresso</button></div>
    <p class="small mut">${Cloud.token ? 'Seu progresso também fica salvo na sua conta.' : 'O progresso fica salvo neste aparelho — exporte de vez em quando como cópia de segurança.'}</p>
  </div>`;
}

async function viewAccount() {
  setNav('conta');
  if (!Cloud.enabled) {
    $app.innerHTML = `<h1>Conta</h1><div class="notice">Modo <b>local</b>: seu progresso fica salvo só neste aparelho. Quando o app for publicado com o banco de dados, cada pessoa terá usuário e senha próprios e o progresso ficará salvo por pessoa.</div>`;
    return;
  }
  $app.innerHTML = `<h1>Minha conta</h1><div class="card"><p>Usuário: <b>${esc(Cloud.username)}</b><br><span class="small mut">${esc(Cloud.status)}</span></p>
    <div class="row"><button class="btn" data-act="sync">Sincronizar agora</button><button class="btn" data-act="logout">Sair</button></div></div>
    <form class="card" data-form="chpw"><h3>Trocar senha</h3><label class="f" for="op">Senha atual</label><input id="op" type="password" autocomplete="current-password" required>
      <label class="f" for="np">Nova senha (mínimo 8)</label><input id="np" type="password" autocomplete="new-password" minlength="8" required><div style="margin-top:10px"><button class="btn" type="submit">Trocar senha</button></div></form>
    <h2>Ranking de simulados feitos</h2><div class="card" id="lb">Carregando…</div>`;
  try {
    const rows = await Cloud.leaderboard(); const el = document.getElementById('lb'); if (!el) return;
    const mine = simuladosFeitos();
    el.innerHTML = `<p style="margin-top:0">Você já fez <b>${mine}</b> simulado(s).</p>` + (rows.length ? `<table><tr><th>#</th><th>Usuário</th><th class="n">Simulados feitos</th></tr>${rows.map((r, i) => `<tr${r.name === Cloud.username ? ' style="font-weight:700"' : ''}><td>${i + 1}</td><td>${esc(r.name)}</td><td class="n">${esc(r.simulados)}</td></tr>`).join('')}</table>` : '<span class="mut">Ninguém terminou um simulado ainda.</span>') + '<p class="small mut">Conta como feito o simulado em que você respondeu todas as questões ao menos uma vez. O ranking não mostra acertos nem erros.</p>';
  } catch (e) { const el = document.getElementById('lb'); if (el) el.textContent = 'Não foi possível carregar o ranking: ' + e.message; }
}

/* ---------- roteador ---------- */
function route() {
  countdown();
  if (SECRET_KEY_FOUND) { viewSecretKeyAlert(); return; }
  if (Cloud.enabled && !Cloud.username) { viewLogin(); return; }
  document.body.classList.remove('gate');
  const r = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
  ({ '': viewHome, praticar: viewPractice, questao: viewQuestion, resultado: viewResult, relatorio: viewReport, banco: viewBank, conta: viewAccount }[r] || viewHome)();
  if (r !== 'questao') window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

/* ---------- eventos ---------- */
const toggleIn = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
const currentQ = () => session && BANK.byId.get(session.qids[session.idx]);
function doAnswer(l) { const q = currentQ(); if (!q || session.results[q.id] || !q.alts[l]) return; recordAnswer(q, l); viewQuestion(); }
function doNext() { if (!session) return; session.idx++; saveSession(); if (session.idx >= session.qids.length) location.hash = '#/resultado'; else viewQuestion(); }
async function afterLogin() { cloudSims = []; loadState(); route(); await Cloud.sync(); route(); }

document.addEventListener('keydown', e => {
  if (location.hash !== '#/questao' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toUpperCase();
  if (k.length === 1 && 'ABCDE'.includes(k)) doAnswer(k);
  else if (k === 'ENTER' || k === 'ARROWRIGHT') { e.preventDefault(); doNext(); }
  else if (k === 'ARROWLEFT' && session && session.idx > 0) { session.idx--; saveSession(); viewQuestion(); }
});

$app.addEventListener('input', e => {
  if (e.target.dataset.act === 'qty-custom') { const n = parseInt(e.target.value, 10); filters.count = n > 0 ? Math.min(n, 1000) : 20; saveFilters(); refreshStartBtn(); }
});
$app.addEventListener('change', async e => {
  const a = e.target.dataset.act;
  if (a === 'tog-as') { toggleIn(filters.assuntos, e.target.dataset.v); saveFilters(); viewPractice(); }
  else if (a === 'set-status') { filters.status = e.target.value; saveFilters(); viewPractice(); }
  else if (a === 'set-order') { filters.order = e.target.value; saveFilters(); viewPractice(); }
  else if (a === 'show-pw') document.querySelectorAll('input[type=password],input[data-pw]').forEach(i => { i.type = e.target.checked ? 'text' : 'password'; i.dataset.pw = 1; });
  else if (a === 'pk-sel') { pending.pkgs[+e.target.dataset.i].skip = !e.target.checked; }
  else if (e.target.id === 'file-progress' && e.target.files[0]) importProgress(e.target.files[0]);
});

$app.addEventListener('submit', async e => {
  const f = e.target.dataset.form; if (!f) return; e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (f === 'login') { await Cloud.login(document.getElementById('lu').value.trim(), document.getElementById('lp').value); await afterLogin(); }
    else if (f === 'register') { await Cloud.register(document.getElementById('ru').value.trim(), document.getElementById('rp').value, document.getElementById('ri').value.trim()); toast('Cadastro criado! Bem-vindo(a).'); await afterLogin(); }
    else if (f === 'chpw') { await Cloud.rpc('app_change_password', { p_token: Cloud.token, p_old: document.getElementById('op').value, p_new: document.getElementById('np').value }); toast('Senha alterada.'); e.target.reset(); }
  } catch (er) { toast(er.message, 5000); }
  if (btn) btn.disabled = false;
});

async function importProgress(file) {
  try {
    if (file.size > MAX_PDF_BYTES / 2) { toast('Arquivo grande demais para ser um PDF de progresso.', 5000); return; }
    const b64 = await PdfImport.readProgressPdf(await fileBuf(file));
    if (!b64) { toast('Este PDF não foi exportado pelo app (não encontrei os dados de progresso).', 6000); return; }
    const d = await ProgressPdf.decode(b64);
    if (!d || d.v !== 1 || !Array.isArray(d.a)) throw new Error('formato');
    if (d.user && Cloud.username && d.user !== Cloud.username && !confirm('Este PDF é do usuário "' + d.user + '". Somar as respostas dele ao seu progresso?')) return;
    const have = new Set(answers.map(a => a.ts + '|' + a.qid)); let n = 0;
    const NOW = Date.now() + 86400000;
    d.a.slice(0, 200000).forEach(r => {   // valida cada linha: o PDF pode ter sido alterado ou vir de outra pessoa
      if (!Array.isArray(r)) return; const [qid, chosen, ok, ts] = r;
      if (typeof qid !== 'string' || !SAFE_ID.test(qid) || !/^[A-E]$/.test(chosen) || !Number.isFinite(ts) || ts < 1.6e12 || ts > NOW) return;
      const q = BANK.byId.get(qid), okReal = q ? chosen === q.gab : !!ok;   // se a questão existe aqui, o acerto é recalculado pelo gabarito
      if (!have.has(ts + '|' + qid)) { have.add(ts + '|' + qid); answers.push({ qid, chosen, ok: okReal, ts: Math.floor(ts), sess: 'i' + Math.floor(ts / 1800000), synced: false }); n++; }
    });
    answers.sort((x, y) => x.ts - y.ts); saveAnswers();
    if (Array.isArray(d.reports)) { d.reports.forEach(t => { if (Number.isFinite(t) && !reports.some(x => Math.abs(x - t) < 60000)) reports.push(t); }); reports.sort((a, b) => a - b); LS.set('reports', reports); }
    if (Cloud.token) Cloud.pushPending().catch(() => {});
    toast(n + ' respostas novas somadas ao seu progresso. Nível atualizado!', 5000); location.hash = '#/relatorio';
  } catch (e) { toast('Não consegui ler este PDF de progresso. Use um arquivo gerado em "Exportar meu progresso".', 6000); }
}

$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const a = el.dataset.act, v = el.dataset.v;
  switch (a) {
    case 'mix-all': startFromFilters({ ...DEF_FILTERS(), count: 0 }, 'Todas as questões (misturadas)'); break;
    case 'mix-new': startFromFilters({ ...DEF_FILTERS(), count: 0, status: 'new' }, 'Questões inéditas'); break;
    case 'mock': examMock(); break;
    case 'review-wrong': startFromFilters({ ...DEF_FILTERS(), count: 0, status: 'wrong' }, 'Revisão de erros'); break;
    case 'drop-session': session = null; saveSession(); viewHome(); break;
    case 'qty': filters.count = +v; saveFilters(); document.getElementById('qty-custom').value = ''; refreshStartBtn(); break;
    case 'tog-sim': toggleIn(filters.sims, v); saveFilters(); viewPractice(); break;
    case 'tog-disc': toggleIn(filters.discs, v); filters.assuntos = filters.assuntos.filter(k => !filters.discs.length || filters.discs.includes(k.split('||')[0])); saveFilters(); viewPractice(); break;
    case 'clear-filters': filters = DEF_FILTERS(); saveFilters(); viewPractice(); break;
    case 'go-filters': startFromFilters(filters, 'Prática filtrada'); break;
    case 'answer': doAnswer(v); break;
    case 'next': doNext(); break;
    case 'prev': if (session.idx > 0) { session.idx--; saveSession(); viewQuestion(); } break;
    case 'finish': location.hash = '#/resultado'; break;
    case 'retry-wrong': startSession(shuffle(session.qids.filter(id => session.results[id] && !session.results[id].ok)), 'Refazendo erros da sessão'); break;
    case 'drill': startFromFilters({ ...DEF_FILTERS(), count: 0, assuntos: [v], status: el.dataset.s }, 'Treino: ' + v.split('||')[1]); break;
    case 'read-pdfs': {
      const files = [...document.getElementById('file-pdf').files];
      if (!files.length) { toast('Escolha ao menos um arquivo PDF.'); break; }
      const bad = files.filter(f => !/\.pdf$/i.test(f.name)); if (bad.length) { toast('Só PDF é aceito: ' + bad[0].name); break; }
      const big = files.filter(f => f.size > MAX_PDF_BYTES); if (big.length) { toast('Arquivo grande demais (limite 30 MB): ' + big[0].name, 5000); break; }
      if (files.length > 8) { toast('Escolha no máximo 8 PDFs por vez.'); break; }
      const st = document.getElementById('read-status'); st.textContent = 'Lendo… pode levar alguns segundos.'; el.disabled = true;
      try {
        const buffers = []; for (const f of files) buffers.push({ name: f.name, buf: await fileBuf(f) });
        const r = await PdfImport.importPdfs(buffers); r.pkgs.forEach(pk => { pk.dup = dupOf(pk); pk.skip = pk.dup; });
        pending = r; if (!r.pkgs.length && !r.msgs.length) r.msgs.push('Nenhuma questão encontrada nos PDFs.');
      } catch (er) { pending = { pkgs: [], msgs: ['Não consegui ler: ' + er.message] }; }
      viewBank(); break;
    }
    case 'cancel-pkgs': pending = null; viewBank(); break;
    case 'add-pkgs': {
      const chosen = pending.pkgs.map((pk, i) => ({ pk, i })).filter(x => !x.pk.dup && !x.pk.skip);
      chosen.forEach(x => { const inp = document.querySelector(`[data-pk-name="${x.i}"]`); if (inp && inp.value.trim()) x.pk.sim.nome = inp.value.trim(); });
      const r = await importPackages(chosen.map(x => x.pk)); pending = null;
      toast(r.added ? `${r.added} simulado(s) adicionado(s) à sua conta.` + (r.offline ? ' Não consegui salvar na nuvem agora (sem internet?); fica neste aparelho e sobe sozinho depois.' : '') : 'Nada foi adicionado.'); viewBank(); break;
    }
    case 'del-cloud-sim': if (confirm('Remover este simulado da sua conta? Suas respostas continuam no histórico.')) { try { await Cloud.rpc('app_delete_sim', { p_token: Cloud.token, p_id: v }); await Cloud.pullSims(); toast('Simulado removido da sua conta.'); } catch (er) { toast(er.message, 5000); } viewBank(); } break;
    case 'del-sim': if (confirm('Remover este simulado do banco (neste aparelho)? Suas respostas continuam no histórico.')) { custom = custom.filter(p => p.sim.id !== v); LS.set('custom', custom); buildBank(); viewBank(); } break;
    case 'export-progress': {
      if (!answers.length) { toast('Você ainda não respondeu nenhuma questão.'); break; }
      toast('Gerando o PDF…');
      try { const R = computeReport(); saveSnapshot(R.generatedAt); R.history = historyRows(); R.reports = reports.slice(); const blob = await ProgressPdf.build(R, who()); download('progresso-pmsc-' + who() + '-' + new Date().toISOString().slice(0, 10) + '.pdf', blob); toast('PDF gerado em ' + fmtDT(R.generatedAt) + ' e salvo no histórico de relatórios.', 5000); if (location.hash === '#/relatorio') viewReport(); }
      catch (er) { toast('Não consegui gerar o PDF: ' + er.message, 6000); } break;
    }
    case 'save-report': { const before = reports.length; saveSnapshot(); toast(reports.length > before ? 'Relatório salvo em ' + fmtDT(reports[reports.length - 1]) + '.' : 'Já existe um relatório salvo neste minuto.'); cmpBase = null; viewReport(); break; }
    case 'cmp-base': cmpBase = +v; viewReport(); break;
    case 'reset-progress': if (confirm('Apagar TODO o seu progresso neste aparelho? (Na conta online, o que já foi enviado continua guardado.)')) { answers = []; reports = []; LS.set('reports', reports); saveAnswers(); session = null; saveSession(); toast('Progresso zerado.'); viewBank(); } break;
    case 'sync': await Cloud.sync(); toast(Cloud.status || 'Pronto.'); route(); break;
    case 'logout': await Cloud.logout(); cloudSims = []; loadState(); route(); break;
  }
});

/* ---------- inicialização ---------- */
(async function init() {
  loadState(); countdown(); route();
  if (Cloud.enabled && Cloud.token) {
    await Cloud.checkSession();
    if (Cloud.username) { loadState(); route(); await Cloud.sync(); if (!/questao/.test(location.hash)) route(); } else route();
  }
})();
})();
