# Bibliotecas de terceiros (hospedadas junto com o site)

O app não carrega nenhum script de CDN externo: as bibliotecas ficam aqui, com versão fixa, para que ninguém consiga trocar o código delas por um malicioso.

| Arquivo | Origem (npm) | Versão | SHA-256 |
|---|---|---|---|
| pdf.min.js | pdfjs-dist | 3.11.174 | 5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946 |
| pdf.worker.min.js | pdfjs-dist | 3.11.174 | feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b |
| jspdf.umd.min.js | jspdf | 4.2.1 | e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54 |

Observações de segurança:
- pdf.js 3.11.174 tem a falha CVE-2024-4367 (execução de código via fonte maliciosa em PDF) quando `isEvalSupported` está ligado. O app abre os PDFs com `isEvalSupported: false` e a política de segurança (CSP) do `index.html` não permite `eval`, então a falha não é explorável aqui.
- Para atualizar: `npm i pdfjs-dist jspdf` numa pasta temporária, copie os arquivos de `build/` e `dist/` e atualize esta tabela.
