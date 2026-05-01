# Comparador de Orçamentos — POC

POC simples: você sobe a ordem de compra em `.docx` e PDFs de orçamentos de fornecedores; o app correlaciona os produtos (com cascata `cache → fuzzy → LLM → manual`), extrai os valores via parsing tradicional do `pdfjs-dist`, calcula totais e compara.

## Rodar localmente

```bash
npm install
cp .env.example .env
# edite .env e cole sua chave OpenRouter
npm run dev
```

Abra `http://localhost:5173`.

## Como usar

1. Arraste o `.docx` da ordem de compra no quadro da esquerda.
   - O `.docx` deve ter uma **tabela** com colunas: `Item | Descrição | Quantidade | Unidade` (cabeçalho ajuda mas não é obrigatório).
2. Arraste um ou vários `.pdf` de fornecedores no quadro da direita.
3. Para cada item que o sistema não conseguiu identificar automaticamente, abre um modal: escolha qual produto da ordem corresponde — **essa escolha fica gravada no IndexedDB** e nunca mais será perguntada.
4. Veja o comparativo no final: melhor preço por linha (verde claro) e total geral por fornecedor com 🏆 no vencedor.

## Arquitetura

```
src/
├── parser/
│   ├── docxParser.ts       (mammoth.js)
│   └── pdfParser.ts        (pdfjs-dist com detecção de colunas por coordenadas)
├── matching/
│   ├── normalize.ts        (NFD + stopwords + ordenação de tokens)
│   ├── llmClient.ts        (OpenRouter direto via fetch)
│   └── orchestrator.ts     (cascata: cache → fuzzy → LLM → manual)
├── pricing/
│   └── calculator.ts       (decimal.js)
├── db/
│   └── schema.ts           (Dexie / IndexedDB)
├── store/
│   └── index.ts            (Zustand)
├── components/             (FileUploader, ComparisonTable, UnmatchedItemsModal, etc.)
└── lib/                    (utils, pdfjs-setup)
```

## Aviso de segurança

⚠️ **Esta POC chama a OpenRouter direto do client** com a chave em `VITE_OPENROUTER_API_KEY`. Isso **expõe a chave** no bundle JS — é aceitável para teste local, mas **antes de subir para a Vercel**, mover a chamada para uma Vercel Serverless Function `/api/llm-match.ts` que lê `OPENROUTER_API_KEY` (sem prefixo `VITE_`) do servidor.

## Stack

- React 18 + Vite + TypeScript
- mammoth (DOCX) · pdfjs-dist (PDF)
- Fuse.js (fuzzy match)
- Dexie.js (IndexedDB)
- Zustand (state)
- Decimal.js (cálculo monetário sem erro de ponto flutuante)
- Zod (validação da resposta do LLM)
- OpenRouter (LLM provider; modelo padrão: `google/gemini-2.5-flash-lite`)
