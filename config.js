// Configuração do app.
// Sem Supabase configurado, o app funciona 100% local (um só usuário, progresso salvo no aparelho).
// Com as duas linhas abaixo preenchidas, o app passa a exigir cadastro por usuário + senha (sem e-mail),
// salva o progresso E os simulados de cada pessoa separadamente — nada é compartilhado entre usuários (veja README.md).
//
// ATENÇÃO — SEGURANÇA: use aqui SOMENTE a chave PÚBLICA ("anon" ou "publishable"). NUNCA cole a chave "service_role"
// nem "sb_secret_..." nem a senha do banco: este arquivo vai para o GitHub e fica visível a qualquer visitante.
// (Se você colar uma chave secreta por engano, o app se recusa a abrir e o verificador tools/check-secrets.mjs bloqueia o commit.)
window.APP_CONFIG = {
  SUPABASE_URL: "https://anxzqtrcmlysejaeaxpu.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFueHpxdHJjbWx5c2VqYWVheHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MjYxMjgsImV4cCI6MjEwOTQwMjEyOH0.vQUElpgpfXYQz1CclLC2tpZeH9535jT1GHI9bmH1syg",  // chave PÚBLICA (anon); pode ficar no GitHub
  EXAM_DATE: "2026-12-13",   // data da prova (AAAA-MM-DD) para a contagem regressiva
  EXAM_STRUCTURE: {           // quantidade de questões por disciplina na prova (peso no relatório)
    "Língua Portuguesa": 8, "Informática": 5, "Direito Constitucional": 8,
    "Direito Penal Comum": 6, "Direito Processual Penal Comum": 6, "Direito Penal Militar": 6,
    "Legislação Especial": 6, "Legislação de Trânsito": 5, "Legislação Institucional": 10
  }
};
