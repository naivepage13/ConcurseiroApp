# Estudo PMSC 2026 — app de simulados (gratuito)

App web (HTML/CSS/JS puro, sem build) que funciona no **celular e no computador**.

## O que o app faz
- **Praticar:** escolha a quantidade (10, 20 … 100, "Todas" ou digite qualquer número), simulados, disciplinas, assuntos e status (inéditas, erradas…). Dá para misturar tudo ou gerar um simulado de 60 no padrão da prova.
- **Ao errar:** mostra sua alternativa, a correta (com a citação do texto), a base legal, **por que cada alternativa errada está errada** e uma caixa **"O que estudar"** com a norma e os artigos citados.
- **Relatório:** acertos × erros, pontos fortes e fracos, "o que estudar primeiro", evolução e **histórico de relatórios com data e hora**, comparando um relatório com o outro.
- **Banco:** só aceita **PDF** (Rota Sul; ou VIP Preparatório = caderno + gabarito comentado, selecionados juntos). **Cada pessoa vê apenas os simulados que ela mesma adicionou** — nada é compartilhado entre usuários.
- **Aparência:** em **Conta**, tema claro, escuro ou automático (segue o aparelho), salvo em cada aparelho.
- **Meu progresso (PDF):** exporta um PDF com o relatório completo; o mesmo PDF pode ser importado de volta.
- **Contas:** usuário + senha (sem e-mail), cadastro só com o **código de convite**; cada pessoa só enxerga o próprio progresso e os próprios simulados (sincronizados entre os aparelhos dela). Há um **ranking** que mostra apenas o **apelido** (escolhido por cada pessoa, sem relação com o usuário de login) e quantos simulados ela já fez (nada de acertos ou erros).

> **Importante:** nenhum simulado faz parte do repositório nem é compartilhado. Cada usuário importa os **próprios PDFs** (material protegido por direitos autorais) e eles ficam **só na conta dele**. Como não há auditoria do conteúdo, ninguém vê o que os outros inseriram. Leia o [SECURITY.md](SECURITY.md).

---

## 1. Testar no computador
Dentro da pasta `site`: `python -m http.server 8000` e abrir http://localhost:8000.
Para ter as 680 questões no seu PC, copie o arquivo do banco (que fica **fora** do GitHub) para `data/bank.js`:
```
copy ..\private\bank.js data\bank.js
```
(`data/bank.js` está no `.gitignore`; nunca será enviado.) Sem ele, o app abre vazio e você adiciona PDFs em **Banco**.

## 2. Banco de dados gratuito (cadastro por usuário e senha)
1. Crie conta em https://supabase.com → **New project** (Free, região **São Paulo**). Anote a senha do banco num gerenciador de senhas — **ela não vai para o app nem para o GitHub**.
2. **SQL Editor** → cole todo o `supabase/schema.sql` → *Run*.
3. Ainda no SQL Editor, defina o **código de convite** (troque o texto; passe aos amigos por mensagem privada, nunca pelo GitHub):
   ```sql
   insert into app_private.settings(key, value)
   values ('invite_hash', extensions.crypt('TROQUE-ESTE-CODIGO', extensions.gen_salt('bf', 10)))
   on conflict (key) do update set value = excluded.value;
   ```
4. **Authentication → Sign In / Providers**: desligue **"Allow new users to sign up"** (o app não usa o login do Supabase) e deixe e-mail/outros provedores desativados.
5. **Project Settings → API**: confira que **Exposed schemas = só `public`** (o schema `app_private` não pode estar na lista).
6. **Project Settings → API Keys**: copie *Project URL* e a chave **anon / publishable** para `config.js`. **Nunca** copie a `service_role`/`secret`.
7. (Opcional) Envie os seus 680 questões para a **sua** conta, para tê-las em qualquer aparelho (só você as verá; depois de criar seu usuário no site):
   ```
   node tools/upload-bank.mjs --url https://SEU-PROJETO.supabase.co --key SUA_CHAVE_ANON --user seu_usuario --file ../private/bank.json
   ```

## 3. Subir para o GitHub com segurança
1. Na pasta `site`: `git init`. **Use o Git (ou o GitHub Desktop)** — o upload "arrastar arquivos" do site do GitHub ignora o `.gitignore`.
2. Ative a proteção automática: `git config core.hooksPath tools/hooks` (bloqueia commit com segredo/dado pessoal/arquivo proibido).
3. Rode a verificação: `node tools/check-secrets.mjs` — precisa mostrar ✅.
4. `git add .` → `git status` (confira que **não** aparecem `data/bank.js`, `private/`, PDFs, `.env`) → `git commit` → `git push`.
5. No GitHub (Settings → Code security): ligue **Secret scanning** e **Push protection**.
6. Publique: **GitHub Pages** (Settings → Pages → branch `main`, pasta `/`), ou **Netlify / Cloudflare Pages** (aplicam também o arquivo `_headers` com os cabeçalhos de segurança).
7. Mande aos amigos o link do site **e, em separado, o código de convite**. Cada um adiciona os próprios PDFs em **Banco**.

## 4. Ajustes
`config.js`: data da prova (contagem regressiva) e peso de cada disciplina. `vendor/`: bibliotecas de terceiros hospedadas junto (veja `vendor/README.md`). `tools/`: scripts (verificação de segredos, envio do banco, leitura de PDFs).
