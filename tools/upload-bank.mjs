// Envia o banco de questões (private/bank.json, que NÃO vai para o GitHub) para a SUA conta na nuvem.
// Os simulados enviados ficam privados: só o usuário informado em --user os enxerga (cada pessoa adiciona os seus próprios).
// Assim o site publicado no GitHub não precisa conter nenhuma questão e você as tem em qualquer aparelho, logado.
// Uso (rode no seu computador):
//   node tools/upload-bank.mjs --url https://SEU-PROJETO.supabase.co --key SUA_CHAVE_ANON --user seu_usuario --file ../private/bank.json
// A senha é pedida no terminal (não fica gravada em lugar nenhum).
import fs from 'fs'; import readline from 'readline';
const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
const url = (opt('url') || '').replace(/\/$/, ''), key = opt('key'), user = opt('user'), file = opt('file') || '../private/bank.json';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key || !user) { console.error('Uso: node tools/upload-bank.mjs --url https://xxxx.supabase.co --key CHAVE_ANON --user usuario [--file ../private/bank.json]'); process.exit(1); }
if (/^sb_secret_/i.test(key)) { console.error('Essa é uma chave SECRETA. Use somente a chave pública (anon/publishable).'); process.exit(1); }
const ask = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.stdoutMuted = true; rl.question(q, v => { rl.close(); console.log(''); r(v); }); rl._writeToOutput = s => { if (!rl.stdoutMuted || s.includes(q)) rl.output.write(s); }; });
const rpc = async (fn, body) => { const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key }, body: JSON.stringify(body) }); const t = await r.text(); const j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error((j && j.message) || r.status); return j; };
const pass = await ask('Senha de ' + user + ': ');
const login = await rpc('app_login', { p_username: user, p_password: pass }); if (login.error) { console.error(login.error); process.exit(1); }
const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const s of bank.sims) {
  const questions = bank.questions.filter(q => q.sim === s.id).map(q => ({ ...q }));
  const texts = {}; Object.keys(bank.texts).filter(k => questions.some(q => q.texto === k)).forEach(k => { texts[k] = bank.texts[k]; });
  const pk = { sim: { id: s.id, nome: s.nome, fonte: s.fonte || '' }, texts, questions };
  try { await rpc('app_add_sim', { p_token: login.token, p_id: s.id, p_nome: s.nome, p_fonte: s.fonte || '', p_payload: pk }); console.log('✔ ' + s.nome + ' (' + questions.length + ' questões)'); }
  catch (e) { console.error('✘ ' + s.nome + ': ' + e.message); }
}
await rpc('app_logout', { p_token: login.token }); console.log('Pronto. Os simulados foram para a conta "' + user + '" e só ela os vê.');
