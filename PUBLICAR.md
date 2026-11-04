# Passo a passo: colocar o app online (100% gratuito) para os amigos

Você vai usar 3 serviços gratuitos: **Supabase** (contas e dados), **GitHub** (guarda o código) e **GitHub Pages** (deixa o site no ar). Tempo estimado: 30 a 40 minutos.

> **Situação atual:** a Parte 1 e o passo 1 da Parte 2 **já foram feitos** (projeto `ConcurseiroApp` em São Paulo, schema aplicado, cadastro do Supabase desligado, `config.js` preenchido). O código de convite foi entregue a você no chat (não está em nenhum arquivo). Siga direto para o passo 2 da Parte 2 e para a Parte 3. Se quiser trocar o código de convite, use o SQL do passo 4 da Parte 1.

## Parte 1 — Supabase (banco de dados)
1. Entre em https://supabase.com e clique em **Start your project**. Crie a conta (pode entrar com o GitHub).
2. **New project** → escolha a organização, dê um nome (ex.: `estudo-pmsc`), crie uma **senha do banco** e **guarde-a num gerenciador de senhas** (ela não vai em nenhum arquivo), região **South America (São Paulo)**, plano **Free**. Clique em *Create* e espere uns 2 minutos.
3. No menu da esquerda, abra o **SQL Editor** → *New query*. Abra o arquivo `supabase/schema.sql` do site, copie **tudo**, cole e clique em **Run**. Deve aparecer "Success".
4. Numa nova query, defina o **código de convite** (troque `TROQUE-ESTE-CODIGO` por uma frase sua, sem aspas dentro) e clique em **Run**:
   ```sql
   insert into app_private.settings(key, value)
   values ('invite_hash', extensions.crypt('TROQUE-ESTE-CODIGO', extensions.gen_salt('bf', 10)))
   on conflict (key) do update set value = excluded.value;
   ```
5. **Authentication** → *Sign In / Providers* (ou *Settings*): **desligue "Allow new users to sign up"**. O app não usa o login do Supabase.
6. **Project Settings → API** (ou *Data API*): confira que em *Exposed schemas* aparece só `public` (nunca `app_private`).
7. Ainda em **Project Settings → API Keys**, copie: **Project URL** (`https://xxxx.supabase.co`) e a chave **anon / publishable**. **Nunca** copie a `service_role` / `secret`.

## Parte 2 — Configurar o site no seu computador
1. Abra o arquivo `config.js` e preencha as duas linhas:
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "cole-aqui-a-chave-anon-ou-publishable",
   ```
2. Teste: na pasta `site`, rode `python -m http.server 8000` e abra http://localhost:8000. Crie o **seu usuário** (usuário, senha de 8+ caracteres e o código de convite). Em **Banco**, adicione os seus PDFs.
   - Opcional: para enviar as 680 questões que já estão no seu computador para a **sua** conta:
     `node tools/upload-bank.mjs --url https://xxxx.supabase.co --key SUA_CHAVE_ANON --user seu_usuario --file ../private/bank.json`

## Parte 3 — GitHub (guardar o código)
1. Crie conta em https://github.com. Clique em **New repository**: nome `estudo-pmsc`, deixe **Public** (o repositório não tem nenhuma questão nem segredo; o GitHub Pages grátis exige repositório público), **não** marque "Add a README". *Create*.
2. No terminal, dentro da pasta `site` (um comando por vez):
   ```
   git init
   git config core.hooksPath tools/hooks
   node tools/check-secrets.mjs
   git add .
   git status
   ```
   - O `check-secrets` precisa mostrar ✅.
   - No `git status`, **não** podem aparecer `data/bank.js`, `private`, arquivos `.pdf` ou `.env`.
3. Envie (troque `SEU-USUARIO` pelo seu nome no GitHub):
   ```
   git commit -m "Estudo PMSC"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/estudo-pmsc.git
   git push -u origin main
   ```
   Se o Git pedir login, entre com a conta do GitHub.
4. No GitHub, em **Settings → Code security**, ligue **Secret scanning** e **Push protection**.

## Parte 4 — Colocar no ar (GitHub Pages)
1. No repositório: **Settings → Pages**. Em *Build and deployment*, **Source = Deploy from a branch**, **Branch = main**, pasta **/ (root)** → *Save*.
2. Espere 1 a 3 minutos. O endereço aparece lá: `https://SEU-USUARIO.github.io/estudo-pmsc/`.
3. Abra no celular e no computador e confira: tela de login, cadastro com o código de convite, importar um PDF em **Banco**.

*(Alternativa com cabeçalhos de segurança extras: Cloudflare Pages ou Netlify conectados ao mesmo repositório; o arquivo `_headers` já está pronto. Para qualquer um deles, deixe "build command" vazio e "output directory" como `/`.)*

## Parte 5 — Convidar os amigos
1. Mande o **link do site** por um canal e, **separadamente**, o **código de convite** (por mensagem privada; nunca ponha no GitHub).
2. Cada amigo: abre o link → "Primeiro acesso?" → escolhe usuário e senha (8+) → digita o código → em **Banco**, adiciona os **próprios PDFs**. Ninguém vê os simulados nem o progresso dos outros.
3. No celular: menu do navegador → **Adicionar à tela inicial**.
4. Quando todos tiverem entrado, **feche os cadastros** (SQL Editor): `delete from app_private.settings where key = 'invite_hash';`

## Manutenção (grátis, mas fique atento)
- **Projeto pausado:** o Supabase gratuito pausa depois de cerca de 1 semana sem nenhum acesso. Se acontecer, entre no painel e clique em **Restore/Resume**. Enquanto vocês estudam toda semana, não pausa.
- **Esqueceram a senha:** sem e-mail, você redefine no SQL Editor (comando no fim do `schema.sql`).
- **Cópia de segurança:** cada pessoa deve exportar o PDF de progresso de vez em quando (Banco → Exportar meu progresso).
- **Atualizar o site depois:** mexeu em algum arquivo? `git add .` → `git commit -m "ajuste"` → `git push`; o site atualiza sozinho.

## Se algo não funcionar
| Sintoma | O que fazer |
|---|---|
| Aparece "Cadastros fechados" | Faltou o passo 4 da Parte 1 (código de convite) |
| "Código de convite incorreto" | Código digitado diferente do definido; redefina com o SQL do passo 4 |
| Página em branco | Abra o console do navegador (F12); confira se `config.js` tem aspas e vírgulas certas |
| "Configuração insegura" | Você colou a chave secreta: troque pela `anon/publishable` e gere uma nova chave secreta no Supabase |
| Site não atualiza | Aguarde 2 min e use Ctrl+F5; veja a aba *Actions* do repositório |
