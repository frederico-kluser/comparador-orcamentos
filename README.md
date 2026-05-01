# Comparador de Orçamentos — POC

Suba a **ordem de compra** (`.docx`, `.doc` ou `.txt`) e as **notas/orçamentos** dos fornecedores (`.pdf`, `.docx`, `.doc` ou `.txt`); o app correlaciona os produtos (cascata `cache → fuzzy → LLM em batch → manual`), extrai valores, calcula totais e compara.

## Rodar localmente

```bash
npm install
cp .env.example .env
# edite .env e cole sua chave OpenRouter
npm run dev
```

Abra `http://localhost:5173`.

## Como usar

App single-page com 3 áreas (sem scroll vertical longo, navegação por abas):

1. **Aba Ordem** — anexe a ordem de compra em `.docx`, `.doc` ou `.txt` (UTF-8). O app entende:
   - tabela `[Item, Descrição, Quantidade, Unidade]` no `.docx`,
   - texto plano nos formatos "10 un - descrição" ou "descrição - 10 un".
2. **Aba Notas** — anexe um ou mais arquivos de fornecedores em `.pdf`, `.docx`, `.doc` ou `.txt`.
   - Para cada documento, abre um **modal com slider** (carrossel entre os documentos).
   - Enquanto a LLM não responde, mostra um **loader**.
   - Quando termina:
     - **Collapse fechado "Identificados"** — itens que sabemos por comparação direta (cache/fuzzy) ou via LLM.
     - **Collapse aberto "Não identificados"** — cada item tem um **select com filtro/busca** entre todos os produtos da ordem; sugestões automáticas aparecem destacadas no topo.
3. **Aba Comparação** — só desbloqueia depois que **todos** os itens de **todos** os documentos estiverem resolvidos. Mostra melhor preço por linha (verde) e total geral por fornecedor.

## LLM em batch — uma request por documento

O matching automático segue a cascata:

1. **Cache (IndexedDB)** — matches confirmados anteriormente.
2. **Fuzzy (Fuse.js)** — comparação direta, local.
3. **LLM em uma única request por documento** — todos os termos não identificados de um fornecedor são enviados juntos para `deepseek/deepseek-v4-pro` (configurável em `VITE_OPENROUTER_MODEL`) via OpenRouter.
4. **Manual** — itens que sobram vão para o select com filtro no carrossel.

## UTF-8

Arquivos `.txt` e `.doc` são lidos com `TextDecoder('utf-8')` explícito. O corpo da request HTTP para a LLM também envia `Content-Type: application/json; charset=utf-8` para preservar acentuação no prompt.

## Arquitetura

```
src/
├── parser/
│   ├── orderParser.ts          (.docx / .doc / .txt → ordem de compra)
│   ├── supplierTextParser.ts   (.docx / .doc / .txt → orçamento de fornecedor)
│   └── pdfParser.ts            (pdfjs-dist com detecção de colunas)
├── matching/
│   ├── normalize.ts
│   └── llmDocumentClient.ts    (OpenRouter — uma request por documento)
├── pricing/calculator.ts       (decimal.js)
├── db/schema.ts                (Dexie / IndexedDB cache)
├── store/index.ts              (Zustand — estado, abas, carrossel)
├── lib/
│   ├── textIO.ts               (UTF-8, fallback .doc binário)
│   ├── pdfjs-setup.ts
│   └── utils.ts
├── components/
│   ├── Tabs.tsx
│   ├── FileUploader.tsx        (Order + Notes)
│   ├── PurchaseOrderViewer.tsx
│   ├── SupplierQuotesGrid.tsx
│   ├── DocumentReviewCarousel.tsx (modal com slider, loader, collapses)
│   ├── SearchableSelect.tsx    (select com filtro)
│   ├── ComparisonTable.tsx
│   └── Loader.tsx
└── styles.css                  (responsivo, mobile-first)
```

## Aviso de segurança

⚠️ **Esta POC chama a OpenRouter direto do client** com a chave em `VITE_OPENROUTER_API_KEY`. Isso **expõe a chave** no bundle JS — aceitável para teste local, mas antes de subir para a Vercel, mover a chamada para uma Vercel Serverless Function `/api/llm-match.ts` lendo `OPENROUTER_API_KEY` do servidor.

## Stack

- React 18 + Vite + TypeScript
- mammoth (DOCX) · pdfjs-dist (PDF) · TextDecoder (TXT/DOC)
- Fuse.js (fuzzy match)
- Dexie.js (IndexedDB cache)
- Zustand (state)
- Decimal.js (cálculo monetário)
- Zod (validação da resposta do LLM)
- OpenRouter — modelo padrão `deepseek/deepseek-v4-pro`
