// Verifica se há segredos, dados pessoais ou arquivos proibidos antes de subir para o GitHub.
// Uso:  node tools/check-secrets.mjs            (varre a pasta do site)
//       node tools/check-secrets.mjs --staged   (só os arquivos preparados no git; usado pelo hook de pré-commit)
import fs from 'fs'; import path from 'path'; import { execSync } from 'child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const staged = process.argv.includes('--staged');

const FORBIDDEN_FILES = [/(^|\/)data\/bank\.(js|json)$/, /(^|\/)private\//, /\.pdf$/i, /(^|\/)\.env(\..*)?$/, /\.(pem|key|p12|pfx)$/i, /(^|\/)node_modules\//, /(^|\/)loadtest\//];
const SKIP_CONTENT = [/^vendor\//, /\.(png|jpg|jpeg|gif|ico|woff2?)$/i, /^package-lock\.json$/];
const RULES = [
  ['Chave SECRETA do Supabase (sb_secret_)', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['Chave de serviço do Supabase (JWT service_role)', null],        // tratada abaixo (decodifica o JWT)
  ['URL de conexão de banco contendo usuário e senha', /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@/i],
  ['Chave privada', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['Token do GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Chave da AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['Chave de API do Google', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Chave sk- (OpenAI/Anthropic/Stripe)', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Senha escrita no código', /(?:password|senha|passwd|secret)\s*[:=]\s*['"][^'"\s]{6,}['"]/i],
  ['CPF', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ['E-mail', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}\b/],
  ['Caminho do seu computador (revela seu usuário)', /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/home\/[a-z0-9_-]+\/|\/Users\/[A-Za-z0-9_-]+\/)/],
];
const ALLOWED_EMAILS = /(@types\/|example\.com|@pmsc\.invalid)/;

function listFiles() {
  if (staged) return execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd: root }).toString().split('\n').filter(Boolean);
  const out = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); const rel = path.relative(root, p).replace(/\\/g, '/'); if (e.name === '.git') continue; if (e.isDirectory()) walk(p); else out.push(rel); } })(root); return out;
}
const problems = [];
const gitignore = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
if (!/data\/bank\.js/.test(gitignore) || !/\*\.pdf/.test(gitignore)) problems.push(['.gitignore', 'O .gitignore precisa listar data/bank.js e *.pdf']);

for (const rel of listFiles()) {
  const ignoredLocally = !staged && (/^data\/bank\.(js|json)$/.test(rel) || /^private\//.test(rel) || /^node_modules\//.test(rel) || /^_test\//.test(rel)); // existe no seu PC, mas o .gitignore impede o envio
  if (FORBIDDEN_FILES.some(r => r.test(rel))) { if (!ignoredLocally) problems.push([rel, 'Arquivo que não pode ir para o GitHub']); continue; }
  if (SKIP_CONTENT.some(r => r.test(rel))) continue;
  const full = path.join(root, rel); let txt; try { const st = fs.statSync(full); if (st.size > 3e6) continue; txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
  if (/\0/.test(txt.slice(0, 2000))) continue;
  for (const [name, re] of RULES) {
    if (!re) continue; const m = txt.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (m) { const hits = m.filter(x => name !== 'E-mail' || !ALLOWED_EMAILS.test(x)); if (hits.length) problems.push([rel, name + ' → ' + hits[0].slice(0, 40) + (hits[0].length > 40 ? '…' : '')]); }
  }
  for (const j of txt.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g) || []) {   // JWTs: a "anon" é pública; a "service_role" NUNCA
    try { const pl = JSON.parse(Buffer.from(j.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); if (pl.role === 'service_role') problems.push([rel, 'Chave de SERVIÇO do Supabase (service_role) — vazou!']); } catch { /* não é JWT */ }
  }
}
if (problems.length) { console.error('\n❌ ENCONTREI PROBLEMAS — NÃO SUBA PARA O GITHUB ATÉ RESOLVER:\n'); problems.forEach(([f, m]) => console.error('  • ' + f + '\n      ' + m)); console.error('\nSe uma chave real já foi enviada ao GitHub, considere-a vazada: gere outra no painel do serviço.\n'); process.exit(1); }
console.log('✅ Nenhum segredo, dado pessoal ou arquivo proibido encontrado.' + (staged ? ' (arquivos preparados para commit)' : ''));
