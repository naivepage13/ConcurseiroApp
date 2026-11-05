# Segurança — o que está protegido e como

## O que é público (e por que não tem problema)
- **Código do site** (HTML/JS/CSS) e `supabase/schema.sql`: qualquer um pode ler. Não há segredo neles.
- **URL do projeto Supabase e chave `anon`/`publishable`** em `config.js`: são públicas **por desenho** (todo site que usa Supabase as expõe). A chave só permite chamar as funções `app_*`; as tabelas não são acessíveis por ela (testado: `permission denied`).

## O que NUNCA pode ir para o GitHub
| Item | Por quê | Proteção |
|---|---|---|
| Chave `service_role` / `sb_secret_...` do Supabase | Dá acesso total ao banco | `tools/check-secrets.mjs` + hook de pré-commit bloqueiam; o app se recusa a abrir se essa chave for colada no `config.js` |
| Senha do banco / URL `postgres://...` | Idem | scanner |
| **Código de convite** (para cadastro) | Quem sabe, cria conta | Só existe como *hash* no banco; passe aos amigos por mensagem privada |
| Banco de questões (`data/bank.js`, `private/`) | Material protegido por direitos autorais | `.gitignore`; as questões só existem na conta de quem as importou |
| PDFs de simulados / relatórios | Idem + dados pessoais | `.gitignore` (`*.pdf`) |

## Camadas de defesa
1. **Banco:** tabelas num schema privado (`app_private`) que a API pública não enxerga; RLS ligado; nenhuma permissão direta para a chave pública. Acesso só por funções que exigem token de sessão e devolvem apenas dados do dono.
2. **Cadastro fechado por padrão:** só com o código de convite; no máximo 20 códigos errados a cada 10 min (global); teto de 500 usuários.
3. **Login:** senha com bcrypt (custo 10); 8 erros → conta bloqueada por 10 min; mensagem única "usuário ou senha incorretos" (não revela se o usuário existe); tokens de 256 bits guardados só como hash; sessão de 60 dias, no máximo 10 aparelhos; trocar a senha encerra as outras sessões.
4. **Limites contra abuso:** respostas (1.000 por envio, 100 mil por conta, só datas plausíveis), simulados (800 KB, 400 questões, 40 por conta), ids em formato seguro.
5. **Site (XSS):** todo dado vindo da nuvem, de PDFs ou de arquivos é *sanitizado* (tipos, tamanhos, ids) **e** escapado ao desenhar a tela; política de segurança (CSP) sem scripts inline e sem `eval`; bibliotecas hospedadas no próprio site (`vendor/`), sem CDN externo; `isEvalSupported:false` no pdf.js (mitiga a CVE-2024-4367).
6. **Importar progresso (PDF):** cada linha é validada e o acerto é recalculado pelo gabarito; tamanho máximo e proteção contra arquivo "bomba de descompressão".

## Riscos que restam (aceitos, mas bom saber)
- **Simulados são privados:** cada pessoa só lê, lista e apaga os **próprios** (testado: outro usuário recebe vazio, mesmo usando o mesmo identificador). Como não há auditoria do conteúdo, nada que um usuário importa chega a outro — por isso um simulado com gabarito errado só prejudica quem o importou.
- **Ranking:** mostra, para todos, só o **apelido** de cada pessoa e **quantos simulados ela já fez** (simulado feito = todas as questões respondidas ao menos uma vez). O apelido é escolhido pela própria pessoa (2 a 24 caracteres, qualquer nome, sem relação com o usuário de login; começa como `Estudante-xxxxxx` aleatório). O **usuário de login nunca aparece para outras pessoas**, nem no ranking, nem em PDFs (o PDF de progresso usa o apelido). Não existe nenhuma contagem de acertos ou erros no ranking nem no banco. O número de simulados vem do app de cada pessoa (sem auditoria) e nunca diminui.
- Como o usuário de login não é mais exibido a ninguém, só quem já souber o nome de login de alguém (por exemplo, porque a própria pessoa contou) consegue travar a conta dele por 10 min errando a senha de propósito (inconveniente, não vazamento). Peça aos amigos que não divulguem o usuário de login. Destrave pelo SQL: `update app_private.users set fails=0, locked_until=null where username='fulano';`
- Sem e-mail não há "esqueci a senha": o administrador redefine pelo SQL.
- O token de sessão fica no navegador do aparelho (como em qualquer site). Em computador compartilhado, use **Conta > Sair**.
- O GitHub Pages não permite cabeçalhos HTTP de segurança; a CSP do `index.html` cobre o essencial. Em Netlify/Cloudflare Pages o arquivo `_headers` aplica todos.

## Se algo vazar
1. **Chave secreta/senha do banco:** no Supabase, gere nova chave/senha **imediatamente** (apagar do GitHub não basta: o histórico guarda).
2. **Código de convite:** troque pelo SQL (`insert ... on conflict do update`, veja `schema.sql`) e avise os amigos.
3. **Conta invadida:** redefina a senha e encerre as sessões (SQL no `schema.sql`).
