# Comparador de Orçamentos — POC

Suba a **ordem de compra** (`.docx`, `.doc` ou `.txt`) e as **notas/orçamentos** dos fornecedores (`.pdf`, `.docx`, `.doc` ou `.txt`); o app **classifica via LLM** (descrição + quantidade + unidade humanizada + valores + flag de promoção), correlaciona com a ordem (cache de matches humanos → LLM em batch → revisão manual), e calcula totais com Decimal.js para a comparação final.

**Filosofia**: programação só faz I/O bruto e aritmética; LLM cuida de toda a interpretação semântica (colunas variáveis por fornecedor, abreviações de unidade `BR/PC/UN/MT/RL/CEN/PCT/CX`, identificação de produto).

## Rodar localmente

```bash
npm install
cp .env.example .env
# edite .env e cole sua chave OpenRouter (https://openrouter.ai/keys)
npm run dev
```

Abra `http://localhost:5173`.

## Como usar

App single-page com 3 áreas (sem scroll vertical longo, navegação por abas):

1. **Aba Ordem** — anexe a ordem de compra em `.docx`, `.doc`, `.pdf` ou `.txt` (UTF-8). Parsing programático:
   - tabela `[Item, Descrição, Quantidade, Unidade]` no `.docx`,
   - texto plano nos formatos "10 un - descrição" ou "descrição - 10 un",
   - PDF com texto extraível (não-imagem).
2. **Aba Notas** — anexe um ou mais arquivos de fornecedores em `.pdf`, `.docx`, `.doc` ou `.txt`.
   - Para cada documento, abre um **modal com slider** (carrossel entre os documentos).
   - Loader mostra duas etapas: "Classificando colunas e unidades com a LLM…" e depois "Correlacionando produtos com a ordem (LLM em batch)…".
   - Quando termina:
     - **Collapse aberto "📋 Itens classificados"** — tabela completa do que a LLM extraiu (`# / Produto / Qtd + unidade humanizada / Valor unit.`), com total geral e marcador `(P)` para promoções.
     - **Collapse aberto "Não identificados"** — cada item tem um **select com filtro/busca** entre todos os produtos da ordem.
     - **Collapse fechado "Identificados"** — matches automáticos via cache (humano) ou LLM.
3. **Aba Comparação** — só desbloqueia depois que **todos** os itens de **todos** os documentos estiverem resolvidos. Mostra melhor preço por linha (verde) e total geral por fornecedor.

## Pipeline por documento

Para cada `.pdf/.docx/.doc/.txt` de fornecedor:

1. **Programação** extrai texto bruto (pdfjs / mammoth / TextDecoder UTF-8).
2. **LLM** (1 request) classifica: descrição, quantidade, `unidadeAbrev` (como veio: `BR`, `PC`, `MT`…) e `unidadeHumana` (`barras`, `peças`, `metros`…), valores normalizados em ponto decimal, flag `isPromocao`, nome do fornecedor.
3. **Cache** (IndexedDB) é consultado APENAS para matches já confirmados por humano (`source='human'`).
4. **LLM** (1 request por documento) correlaciona os itens restantes com o catálogo da ordem.
5. **Revisão manual** no carrossel para itens com baixa confiança.
6. **Programação (Decimal.js)** calcula subtotais, totais por fornecedor e elege o vencedor.

> Não há mais `fuzzy match`: toda decisão automática vai para a LLM. Cache existe só como memória de aprendizado humano.

## UTF-8

Arquivos `.txt` e `.doc` são lidos com `TextDecoder('utf-8')` explícito. O corpo da request HTTP para a LLM também envia `Content-Type: application/json; charset=utf-8` para preservar acentuação no prompt.

## Arquitetura

```
src/
├── parser/
│   ├── orderParser.ts             (.docx / .doc / .txt / .pdf → ordem de compra — programático)
│   ├── supplierTextParser.ts      (.docx / .doc / .txt → texto bruto + classifyDocumentLLM)
│   └── pdfParser.ts               (pdfjs-dist → texto bruto + classifyDocumentLLM)
├── matching/
│   ├── normalize.ts               (chave do cache)
│   ├── llmClassifyDocument.ts     (LLM: classificação por documento — colunas/unidades/valores)
│   └── llmDocumentClient.ts       (LLM: correlação em batch — uma request por documento)
├── pricing/calculator.ts          (decimal.js — totais, vencedor)
├── db/schema.ts                   (Dexie / IndexedDB cache de matches humanos)
├── store/index.ts                 (Zustand — estado, abas, carrossel)
├── lib/
│   ├── textIO.ts                  (UTF-8, fallback .doc binário)
│   ├── pdfText.ts                 (extração de linhas do PDF)
│   ├── pdfjs-setup.ts
│   ├── textSanitize.ts
│   └── utils.ts
├── components/
│   ├── Tabs.tsx
│   ├── FileUploader.tsx           (Order + Notes; placeholder 'classifying')
│   ├── PurchaseOrderViewer.tsx
│   ├── SupplierQuotesGrid.tsx
│   ├── DocumentReviewCarousel.tsx (modal com slider, vista de itens classificados)
│   ├── SearchableSelect.tsx       (select com filtro)
│   ├── ComparisonTable.tsx
│   └── Loader.tsx
└── styles.css                     (responsivo, mobile-first)
```

## Build de instaladores (Electron)

O app empacota como Electron via `electron-builder`. Os instaladores saem em `./release/`.

```bash
# macOS (.dmg + .zip, x64 e arm64)
./scripts/build-mac.sh
# ou:
npm run dist:mac

# Windows (NSIS .exe instalador + .exe portable, x64)
./scripts/build-win.sh
# ou:
npm run dist:win

# Tudo de uma vez (precisa rodar em mac com Wine, ou em CI multi-OS)
npm run dist:all
```

**Notas**:
- **macOS**: build nativo precisa de macOS host. No Linux gera DMG não-assinado (Gatekeeper rejeita) — útil só para testes. Para distribuir, rodar em Mac com `CSC_LINK`/`CSC_KEY_PASSWORD` para assinar/notarizar.
- **Windows no Linux**: `electron-builder` usa Wine internamente. Instale com `sudo apt install wine wine64` antes.
- O instalador NSIS abre wizard com escolha de pasta, atalho desktop e atalho no menu Iniciar.
- Versão portable do Windows não precisa de instalação — roda direto do `.exe`.

## Aviso de segurança

⚠️ **Esta POC chama o OpenRouter direto do client** com a chave em `VITE_OPENROUTER_API_KEY`. Isso **expõe a chave** no bundle JS — aceitável para teste local, mas antes de subir para a Vercel, mover as chamadas LLM (`classifyOrderLLM`, `classifyDocumentLLM`, `callDocumentMatchLLM`, `generateRankingJustifications`) para Vercel Serverless Functions lendo `OPENROUTER_API_KEY` do servidor.

## Stack

- React 18 + Vite + TypeScript
- mammoth (DOCX) · pdfjs-dist (PDF) · SheetJS Community (XLSX/XLS) · TextDecoder (TXT/CSV/DOC)
- Dexie.js (IndexedDB cache de matches humanos)
- Zustand (state)
- Decimal.js (cálculo monetário)
- Zod (validação das respostas LLM)
- fuse.js (pré-filtro lexical pra reduzir candidatos do matcher)
- OpenRouter (gateway OpenAI-compatible, streaming SSE, prompt caching automático)
  - Modelo único: `VITE_OPENROUTER_MODEL` (default `google/gemini-3-flash-preview` — Gemini 3 Flash Preview, contexto 1,05M tokens, reasoning embutido)
  - Esforço de reasoning configurável por caller via `reasoning.effort`:
    - matcher: `medium` (CoT pra extração de specs antes de decidir)
    - classify (proposta + master): `low` (extração estruturada)
    - ranking-justify: `minimal` (só formata texto a partir de números prontos)
  - Documentos longos (>100k chars) são processados em CHUNKS paralelos com overlap pra garantir que TODO o conteúdo passe pela LLM, sem cortar o meio.
