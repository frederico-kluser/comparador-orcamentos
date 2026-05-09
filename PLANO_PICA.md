# PLANO_PICA — Comparador de Orçamentos

> Documento de arquitetura, fluxo, tipos, matching, ranking e telas.
> **Não-código.** Roteiro a ser executado APÓS aprovação.
> Idioma: PT-BR (alinhado ao código).

---

## 0. Status executivo

A base já existe e funciona. Faltam: redesenho do prompt do matcher (problema real:
produtos distintos sendo agrupados como um só) e a Tela 3 (ranking explícito da
melhor à pior proposta). Tela 4 ganha refac de célula.

| Tela / módulo            | Status            | Arquivo principal                              |
|--------------------------|-------------------|------------------------------------------------|
| 1 — Lista mestre         | `[EXISTE]`        | `src/components/PurchaseOrderViewer.tsx`       |
| 2 — Propostas (carrossel)| `[EXISTE, polir]` | `src/components/SupplierQuotesGrid.tsx` + `DocumentReviewCarousel.tsx` |
| 3 — Ranking propostas    | `[NOVO]`          | `src/components/RankingProposals.tsx` (a criar)|
| 4 — Comparação cruzada   | `[REFAC]`         | `src/components/ComparisonTable.tsx`           |
| Worker pool 5 simultâneos| `[EXISTE]`        | `src/lib/concurrency.ts` + `src/components/FileUploader.tsx` |
| Normalização de unidades | `[EXISTE, ampliar]` | `src/matching/llmClassifyDocument.ts:26-36`  |
| **Limpeza LLM da lista mestre** | `[NOVO CRÍTICO]` | `src/matching/llmClassifyOrder.ts` (a criar)   |
| Parser da lista mestre   | `[REFAC]`         | `src/parser/orderParser.ts`                    |
| Matcher LLM              | `[REFAC CRÍTICO]` | `src/matching/llmDocumentClient.ts`            |
| Pré-filtro lexical       | `[NOVO]`          | `src/matching/preFilter.ts` (a criar)          |
| Cálculo / ranking JS     | `[EXISTE+NOVO]`   | `src/pricing/calculator.ts` + `src/pricing/ranker.ts` (a criar) |
| Cache humano (Dexie)     | `[EXISTE]`        | `src/db/schema.ts`                             |

---

## 1. Stack escolhida e justificativa

| Camada        | Tecnologia                          | Por quê                                                          |
|---------------|-------------------------------------|------------------------------------------------------------------|
| Linguagem     | TypeScript 5.6                      | Tipagem forte para `OrderItem`, `SupplierLineItem`, schemas Zod.|
| UI            | React 18.3                          | Já em uso, ecossistema grande.                                  |
| Build         | Vite 5.4                            | HMR rápido, bundle pequeno.                                     |
| Desktop       | Electron 35 + electron-builder      | DMG (mac x64+arm64) + NSIS (win) já configurados; offline-first.|
| Estado        | Zustand 5                           | Store simples, sem boilerplate de Redux/Context.                |
| LLM           | DeepSeek (OpenAI-compat)            | Barato, JSON mode, bom em PT. Streaming já implementado.        |
| Pré-filtro    | fuse.js 7                           | Já é dep do projeto. Lexical, suficiente para listas pequenas.  |
| Aritmética    | decimal.js 10                       | Sem floating-point em valores monetários.                       |
| Validação     | Zod 3                               | Schemas runtime do retorno do LLM.                              |
| Parser DOCX   | mammoth 1.8                         | Extrai texto e tabelas; lida com tabelas mal formadas.          |
| Parser PDF    | pdfjs-dist 4.7                      | Extração por colunas com posições; sem dependência nativa.      |
| Persistência  | Dexie 4 (IndexedDB)                 | Cache local de matches humanos confirmados.                     |
| Concorrência  | `runWithLimit` custom               | Worker pool de 5 com fila por slot, sem dep externa.            |

> **Sem novas dependências.** Tudo já está em `package.json`.

---

## 2. Estrutura de pastas

```
comparador-orcamentos/
├── PLANO_PICA.md                              [NOVO — este documento]
├── package.json
├── electron/
│   └── main.cjs                               [EXISTE]
├── scripts/
│   ├── build-mac.sh                           [EXISTE]
│   └── build-win.sh                           [EXISTE]
└── src/
    ├── App.tsx                                [REFAC — adicionar tab "Ranking"]
    ├── main.tsx                               [EXISTE]
    ├── types.ts                               [REFAC — novos tipos abaixo]
    ├── parser/
    │   ├── orderParser.ts                     [EXISTE]
    │   ├── pdfParser.ts                       [EXISTE]
    │   └── supplierTextParser.ts              [EXISTE]
    ├── matching/
    │   ├── llmClassifyDocument.ts             [EXISTE — usa CLASSIFY_SYSTEM_PROMPT do prompts.ts]
    │   ├── llmClassifyOrder.ts                [NOVO — limpa a lista mestre antes do parse]
    │   ├── llmDocumentClient.ts               [REFAC — usa preFilter + novo prompt + hard-fail]
    │   ├── llmStream.ts                       [EXISTE]
    │   ├── normalize.ts                       [EXISTE]
    │   ├── preFilter.ts                       [NOVO — fuse.js top-K candidatos]
    │   └── prompts.ts                         [NOVO — prompts isolados, versionáveis]
    ├── parser/
    │   ├── orderParser.ts                     [REFAC — LLM primeiro, regex fallback]
    │   ├── pdfParser.ts                       [EXISTE]
    │   └── supplierTextParser.ts              [EXISTE]
    ├── components/
    │   ├── PurchaseOrderViewer.tsx            [EXISTE — relabel "Descrição" → "Nome"]
    │   ├── FileUploader.tsx                   [EXISTE]
    │   ├── SupplierQuotesGrid.tsx             [EXISTE]
    │   ├── DocumentReviewCarousel.tsx         [EXISTE]
    │   ├── SearchableSelect.tsx               [EXISTE]
    │   ├── ComparisonTable.tsx                [REFAC — célula com unit + subtotal]
    │   ├── RankingProposals.tsx               [NOVO — Tela 3]
    │   ├── Tabs.tsx                           [EXISTE]
    │   └── Loader.tsx                         [EXISTE]
    ├── pricing/
    │   ├── calculator.ts                      [EXISTE — buildComparison]
    │   └── ranker.ts                          [NOVO — fórmula de ranking + chamada LLM justificativa]
    ├── store/
    │   └── index.ts                           [REFAC — incluir tab 'ranking', ranking cache]
    ├── db/
    │   └── schema.ts                          [EXISTE]
    └── lib/
        ├── concurrency.ts                     [EXISTE — runWithLimit]
        ├── pdfText.ts                         [EXISTE]
        ├── sanitize.ts                        [EXISTE]
        └── utils.ts                           [EXISTE]
```

---

## 3. Tipos / schemas

### 3.1 Já existentes (verbatim, `src/types.ts` e `src/db/schema.ts`)

```ts
// OrderItem — uma linha da Lista Mestre
export interface OrderItem {
  id: string;
  descricao: string;             // exibido como "Nome" na UI da Tela 1
  descricaoNormalizada: string;  // versão sem stopwords/acentos para matching
  quantidade: number;
  unidade: string;               // forma humana já normalizada
}

// SupplierLineItem — uma linha extraída de uma proposta
export interface SupplierLineItem {
  id: string;
  rawTerm: string;
  quantidade: number | null;
  unidadeAbrev: string | null;   // "BR", "PC", "UN", "MT", "RL", "PCT", "CEN", ...
  unidadeHumana: string | null;  // "barras", "peças", "unidades", "metros", ...
  isPromocao: boolean;
  valorUnit: string | null;      // string para preservar Decimal-friendliness
  valorTotal: string | null;
  matchedProductId: string | null;
  matchSource: 'cache' | 'llm' | 'manual' | 'skipped' | null;
  matchScore: number | null;
}

// LearnedMatch — cache local Dexie de matches humanos confirmados
interface LearnedMatch {
  id?: number;
  normalized_supplier_term: string;
  raw_supplier_term: string;
  product_list_hash: string;
  canonical_product_id: string;
  canonical_product_name: string;
  confidence: number;
  source: 'human' | 'llm' | 'fuzzy';
  confirmed_count: number;
  created_at: number;
  last_used_at: number;
}
```

### 3.2 Novos (`[NOVO]`)

```ts
// MatchSpecs — saída estruturada do CoT do matcher (Stage 1)
export interface MatchSpecs {
  categoria: string | null;          // "cabo", "eletroduto", "uniduti", "parafuso"...
  material: string | null;           // "PVC", "alumínio", "cobre", "nylon"...
  dimensao_principal: string | null; // bitola/diâmetro: "2,5 mm²", "1/2\"", "25 mm"
  dimensao_secundaria: string | null;// comprimento: "100 m", "3 m", "20x20x10"
  tensao_nominal: string | null;     // "450/750 V", "0,6/1 kV"
  corrente_nominal: string | null;   // "10 A", "32 A"
  numero_polos: string | null;       // "1P", "2P", "3F+N", "3x4"
  acabamento: string | null;         // "rígido", "flexível", "longo", "curto",
                                     // "reto", "com tampa", "tipo agulha"
  cor: string | null;                // "preto", "verde", "azul", "amarelo"
  marca: string | null;              // "NEXANS", "MEGATRON", "3M"
  norma_abnt: string | null;         // "NBR NM 247-3", "NBR 13249", "NBR 15465"
  ncm: string | null;                // "8544.49.00"
  unidade_comercial: string | null;  // "BR", "RL", "M", "PC"
}

// MatcherDecision — saída final do matcher (Stage 2)
export interface MatcherDecision {
  decision: 'match' | 'no_match' | 'uncertain';
  candidate_id: string | null;       // id do OrderItem escolhido (ou null)
  confidence: number;                // 0..1
  specs_proposta: MatchSpecs;
  specs_master: MatchSpecs | null;
  mismatched_specs: string[];        // chaves de MatchSpecs que divergem
  reasoning: string;                 // ≤ 3 frases
}

// RankedProposal — uma linha do ranking (Tela 3)
export interface RankedProposal {
  rank: number;                      // 1, 2, 3...
  supplierId: string;
  supplierName: string;
  total: string;                     // Decimal serializado
  itens_cobertos: number;
  itens_total_master: number;
  cobertura: number;                 // 0..1
  delta_vs_melhor: string;           // Decimal serializado (R$)
  delta_vs_melhor_pct: number;       // 0..1 (1.0 = +100%)
  justificativa_ia: string;          // texto livre, gerado pela IA
}
```

### 3.3 Mapping de unidades (ampliar `src/matching/llmClassifyDocument.ts:26-36`)

| Abrev | Forma humana plural | Singular |
|-------|--------------------|----------|
| BR    | barras             | barra    |
| PC    | peças              | peça     |
| UN    | unidades           | unidade  |
| MT    | metros             | metro    |
| M     | metros             | metro    |
| RL    | rolos              | rolo     |
| PCT   | pacotes            | pacote   |
| CEN   | centos             | peça     |
| CX    | caixas             | caixa    |
| KG    | quilos             | quilo    |
| PAR   | pares              | par      |
| L     | litros             | litro    |
| JG    | jogos              | jogo     |
| KIT   | kits               | kit      |
| M²    | metros quadrados   | metro²   |

> Tabela atual já cobre BR/PC/UN/MT/RL/PCT/CEN/CX/KG/PAR/L. Adicionar: M, JG, KIT, M².

---

## 4. Fluxo de processamento

### 4.1 Sequência ponta-a-ponta

```
LISTA MESTRE (uma vez por sessão):
┌──────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│ Upload .docx/    │───▶│ extractTextAnd     │───▶│ classifyOrderLLM   │
│ .pdf/.txt        │    │ Fallback (mammoth/ │    │ (limpa cabeçalhos, │
│                  │    │  pdfjs)            │    │  preserva nomes)   │
└──────────────────┘    └────────────────────┘    └─────────┬──────────┘
                                  │                         │
                                  │  fallback regex          │ items canônicos
                                  ▼  (se LLM falhar)         ▼
                              ┌─────────────────────────────────┐
                              │     PurchaseOrder (master)       │
                              └────────────────┬─────────────────┘
                                               │
PROPOSTAS (worker pool, até 5 simultâneas):    │
┌─────────────────┐    ┌────────────────────┐  │  ┌──────────────────┐
│ Upload (drop)   │───▶│ parsePdf /         │──▶│  │ classifyDocument │
│ .docx / .pdf    │    │ parseSupplierText  │  │  │ LLM (Stage 1)    │
└─────────────────┘    └────────────────────┘  │  └────────┬─────────┘
                                               │           │
        ┌──────────────────┐    ┌──────────────┴───┐    ┌──┴───────────────┐
        │ DocumentReview   │◀───│ hardFail postproc│◀───│ callDocumentMatch│
        │ Carousel         │    │ (JS, cinto +     │    │ LLM (Stage 2,    │
        │ (revisão manual) │    │  suspensório)    │    │  novo prompt)    │
        └────────┬─────────┘    └──────────────────┘    └─────────▲────────┘
                 │                                                │
                 │              ┌──────────────────┐              │
                 │              │ preFilter        │──────────────┘
                 │              │ (fuse.js top-10) │
                 │              └─────────▲────────┘
                 │                        │ master items canônicos
                 │                  unmatched items
                 ▼
        ┌──────────────────┐    ┌────────────────┐    ┌────────────────┐
        │ buildComparison  │───▶│ rankProposals  │───▶│ RankingProposals│
        │ (Tela 4)         │    │ (JS puro)      │    │ + justificativa │
        │                  │    │                │    │ IA (Tela 3)     │
        └──────────────────┘    └────────────────┘    └────────────────┘
```

### 4.2 Worker pool — diagrama (5 slots, fila FIFO)

```
                Fila de propostas (uploaded files)
                ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
                │P1│P2│P3│P4│P5│P6│P7│P8│P9│..│
                └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
                  ▲   ▲   ▲   ▲   ▲
                  │   │   │   │   │     puxa próxima
                  │   │   │   │   │     quando slot libera
       ┌──────────┴───┴───┴───┴───┴──────────┐
       │   Slot 1 ──▶ classifying  ──▶ processing  ──▶ awaiting_review │
       │   Slot 2 ──▶ classifying  ──▶ processing  ──▶ awaiting_review │
       │   Slot 3 ──▶ processing   ──▶ awaiting_review                 │
       │   Slot 4 ──▶ classifying                                      │
       │   Slot 5 ──▶ awaiting_review                                  │
       └───────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
       Promise.all global resolve quando TODOS os slots terminarem.
       Estado em Zustand: suppliers[i].status (re-render reativo).
```

Implementação base: `src/lib/concurrency.ts:10` (`runWithLimit`) + `MAX_PARALLEL_NOTES = 5`
em `src/components/FileUploader.tsx:8`. Cada slot consome do índice global incrementado
atomicamente (`nextIdx++`); um slot só pega o próximo após terminar o pipeline completo
(`parse + classify + match`) do item atual.

---

## 5. Estratégia de matching automático e fallback manual

### 5.0 Passo 0 — Limpeza LLM da LISTA MESTRE (NOVO crítico)

Antes de qualquer matching, a lista mestre precisa estar canônica e sem ruído.
O `lista.docx` real do usuário tem cabeçalhos de seção em CAPS ("CABOS
ALIMENTADORES PAINÉIS:", "INFRA-ESTRUTURA SALA DE BOMBAS RECALQUE:"), linhas
de contexto do projeto ("BOMBA RECALQUE (6X)/DRENAGEM (2X)/CASCATA (2X)") e
HTML entities (`&quot;`) — o regex anterior estava transformando cabeçalhos
em itens, corrompendo a base.

Fluxo (`src/parser/orderParser.ts` REFAC):
1. \`extractTextAndFallback(file)\` extrai texto bruto via mammoth/pdfjs/UTF-8
   e, em paralelo, computa items por regex/tabela (fallback).
2. Se LLM configurada: \`classifyOrderLLM(rawText, fileName)\` (em
   \`src/matching/llmClassifyOrder.ts\`, NOVO) devolve a lista limpa.
3. Se LLM falhar OU vier vazia: usa fallback regex.

Prompt (\`CLASSIFY_ORDER_SYSTEM_PROMPT\` em \`prompts.ts\`):
- PRESERVA nome literalmente (apenas trim + decode entities).
- NORMALIZA unidade para forma humana plural/singular.
- IGNORA cabeçalhos de seção em CAPS terminados em ":" e linhas de contexto.
- MANTÉM duplicatas (são pedidos de seções diferentes — case real desta base).
- Faz MERGE de descrições quebradas em 2 linhas.

### 5.1 Pipeline em 4 passos

| # | Passo                    | Onde                                | Custo / latência          |
|---|--------------------------|-------------------------------------|---------------------------|
| 1 | Cache humano             | Dexie (`findCachedMatch` em `store`)| ms, local                 |
| 2 | Pré-filtro lexical       | `src/matching/preFilter.ts` (NOVO)  | ms, local (fuse.js)       |
| 3 | LLM reranker (Stage 2)   | `src/matching/llmDocumentClient.ts` | s, DeepSeek               |
| 4 | Hard-fail postproc       | JS imediatamente após Stage 2       | ms                        |

#### 5.1.1 Cache humano (já existe)
Lê `LearnedMatch` da IndexedDB com `source='human'`. Hit → usa direto, pula LLM.

#### 5.1.2 Pré-filtro lexical (novo)
```ts
// preFilter.ts (esboço)
export function topKCandidates(
  proposalTerm: string,
  master: OrderItem[],
  k = 10
): OrderItem[] {
  const fuse = new Fuse(master, {
    keys: [
      { name: 'descricao', weight: 0.4 },
      { name: 'descricaoNormalizada', weight: 0.6 },
    ],
    threshold: 0.6,           // solto: prioriza recall
    ignoreLocation: true,
    includeScore: true,
  });
  return fuse.search(proposalTerm).slice(0, k).map(r => r.item);
}
```
Objetivo: reduzir o contexto enviado ao LLM. NÃO decide; só reduz candidatos.

#### 5.1.3 LLM reranker — **prompt completo (verbatim)**

Arquivo destino: `src/matching/prompts.ts` (NOVO).

```text
# SYSTEM PROMPT — MATCHER PT-BR (NBR / construção elétrica)

Você é um especialista em materiais elétricos e de construção brasileiros.
Você conhece a terminologia ABNT/NBR, sabe que dimensões em polegadas
(1/2", 3/4", 1", 1 1/2", 2") e em milímetros (25 mm, 32 mm) NÃO se misturam
livremente, e entende que bitolas de cabo (1,5 mm², 2,5 mm², 4 mm², 6 mm²,
10 mm², 16 mm²) determinam corrente máxima e NÃO são intercambiáveis.

Sua tarefa: dado um termo de proposta de fornecedor e até 10 candidatos da
lista mestre, decidir se HÁ um match — ou rejeitar com `no_match`.

## REGRAS DURAS — VOCÊ DEVE SEGUIR ANTES DE DECIDIR

1. EXTRAÇÃO ANTES DA DECISÃO. Primeiro extraia `specs_proposta` E
   `specs_master` como JSON estruturado. SÓ DEPOIS decida.

2. HARD-FAIL POR DIVERGÊNCIA. Se qualquer um destes campos divergir entre
   proposta e master, a decisão DEVE ser `no_match`, mesmo que os nomes
   pareçam idênticos:
   - dimensao_principal
   - dimensao_secundaria
   - tensao_nominal
   - corrente_nominal
   - numero_polos
   - categoria
   - material
   - acabamento
   - cor (apenas para CABOS — em outras categorias é cosmético)

3. NORMALIZAÇÃO ACEITA SEM HARD-FAIL:
   - Abreviações: "ELETROD RIG" = "eletroduto rígido", "CB FLEX" = "cabo
     flexível", "BUA" = "bucha", "DISJ" = "disjuntor".
   - Acentos / case: "alumínio" = "ALUMINIO" = "aluminio".
   - Variantes de pontuação: "2,5 mm" = "2.5 mm" = "2,5MM".
   - Polegadas: 1/2" = 1/2 = 1/2 polegada (mas NÃO = 12,7 mm sem confirmação).

4. UNIDADES COMERCIAIS NÃO DETERMINAM IDENTIDADE. "BR" (barra de 3 m) e "M"
   (metro) descrevem como o produto é vendido, não o que ele é. Cabe no
   campo `unidade_comercial`, mas NÃO entra em `mismatched_specs`.

5. MARCA E NORMA SÃO SOFT POR PADRÃO, MAS SOBEM A HARD QUANDO PRESENTES NA
   MASTER. Se a master diz "NEXANS" e a proposta não cita marca, é uncertain
   (não no_match). Se a proposta cita marca DIFERENTE, é no_match.

## GLOSSÁRIO BR (consulte sempre)

ABREVIAÇÕES COMUNS DE DESCRIÇÃO
  ELETROD, ELETROD RIG, ELETROD FLEX, CB, CB FLEX, CABO FLEX, CB CONC,
  BUA, BUC, BCH, DISJ, DPS, INTERR, INT, TOM, TOM 2P+T, LAMP, LMP, LUM,
  CONJ, CV (curva), CXX (caixa), CONDLT (condulete), TERM (terminal),
  AB (abraçadeira), PARAF (parafuso), ARRU (arruela), POR (porca).

UNIDADES COMERCIAIS
  BR  = barra (eletroduto rígido: 3 m por barra)
  RL  = rolo (cabo flexível: tipicamente 100 m por rolo)
  M   = metro (granel)
  MT  = metro (granel, sinônimo de M)
  PC  = peça (sinônimo de PÇ, UN)
  PÇ  = peça
  UN  = unidade
  CX  = caixa
  PCT = pacote
  CEN = cento (na Tela 1 humanizamos como "peça")
  KG  = quilo
  PAR = par
  L   = litro
  JG  = jogo
  KIT = kit

NORMAS RELEVANTES
  NBR NM 247-3   — cabos isolados PVC 450/750 V (substitui NBR 6148)
  NBR 13249      — cabos flexíveis PP até 750 V
  NBR 15465      — eletroduto rígido PVC (substitui NBR 6150)
  NBR 13057      — eletroduto flexível corrugado
  NBR 5410       — instalações elétricas BT (norma de aplicação)

## SCHEMA DE SAÍDA (JSON estrito, sem texto fora do JSON)

{
  "specs_proposta": {
    "categoria": "...", "material": "...",
    "dimensao_principal": "...", "dimensao_secundaria": "...",
    "tensao_nominal": "...", "corrente_nominal": "...",
    "numero_polos": "...", "acabamento": "...",
    "cor": "...", "marca": "...", "norma_abnt": "...", "ncm": "...",
    "unidade_comercial": "..."
  },
  "specs_master": { ... mesma forma, ou null se decision != match },
  "decision": "match" | "no_match" | "uncertain",
  "candidate_id": "<id do master escolhido ou null>",
  "confidence": 0.0,
  "mismatched_specs": ["dimensao_principal", "cor", ...],
  "reasoning": "≤ 3 frases curtas. Cite a spec que decidiu."
}

REGRA: se `mismatched_specs` contém algum de
  {dimensao_principal, dimensao_secundaria, tensao_nominal,
   corrente_nominal, numero_polos, categoria, material, acabamento}
  OU contém `cor` E categoria == "cabo",
ENTÃO `decision` DEVE ser `no_match`.

## FEW-SHOT (estude antes de responder)

### POSITIVO 1 — sinônimo + abreviação
proposta: "CB FLEX 2,5MM 100M AZ 750V SIL"
candidatos master: ["Cabo flexível 2,5 mm² 100 m azul 750 V — id=om_42"]
saída:
{
  "specs_proposta": {
    "categoria":"cabo","material":"cobre",
    "dimensao_principal":"2,5 mm²","dimensao_secundaria":"100 m",
    "tensao_nominal":"750 V","corrente_nominal":null,"numero_polos":null,
    "acabamento":"flexível","cor":"azul","marca":"SIL","norma_abnt":null,
    "ncm":null,"unidade_comercial":"RL"
  },
  "specs_master": {
    "categoria":"cabo","material":"cobre",
    "dimensao_principal":"2,5 mm²","dimensao_secundaria":"100 m",
    "tensao_nominal":"750 V","corrente_nominal":null,"numero_polos":null,
    "acabamento":"flexível","cor":"azul","marca":null,"norma_abnt":null,
    "ncm":null,"unidade_comercial":null
  },
  "decision":"match","candidate_id":"om_42","confidence":0.97,
  "mismatched_specs":[],
  "reasoning":"Specs críticas idênticas; diferença é só grafia ('CB FLEX' = 'cabo flexível') e marca SIL não-discriminante (não citada na master)."
}

### POSITIVO 2 — variação de polegadas equivalentes
proposta: "ELETROD RIG PVC 3/4 PR 3M"
candidatos master: ["Eletroduto PVC 3/4\" preto — id=om_07"]
saída: match com confidence 0.95, mismatched_specs vazio.

### NEGATIVO HARD 1 — bitola diferente (CASO REAL DESTA BASE)
proposta: "CABO FLEX 2,5MM 100M PT 750V"
candidatos master: ["Cabo flexível 4 mm² 100 m preto 750 V — id=om_19",
                    "Cabo flexível 2,5 mm² 100 m verde 750 V — id=om_20"]
saída:
{
  "specs_proposta": {
    "categoria":"cabo","material":"cobre",
    "dimensao_principal":"2,5 mm²","dimensao_secundaria":"100 m",
    "tensao_nominal":"750 V","corrente_nominal":null,"numero_polos":null,
    "acabamento":"flexível","cor":"preto","marca":null,"norma_abnt":null,
    "ncm":null,"unidade_comercial":"RL"
  },
  "specs_master": null,
  "decision":"no_match","candidate_id":null,"confidence":0.99,
  "mismatched_specs":["dimensao_principal","cor"],
  "reasoning":"Candidato om_19 tem 4 mm² (≠ 2,5 mm²); candidato om_20 é verde (≠ preto). Bitola é hard-fail (corrente máx muda); cor em cabo também."
}

### NEGATIVO HARD 2 — acabamento diferente
proposta: "UNIDUTI 1 1/2 ALUM"
candidatos master: ["Uniduti cônico longo 1 1/2 alumínio — id=om_31",
                    "Uniduti cônico curto 1 1/2 alumínio — id=om_32",
                    "Uniduti reto 1 1/2 alumínio — id=om_33"]
saída:
{
  "decision":"uncertain","candidate_id":null,"confidence":0.40,
  "mismatched_specs":["acabamento"],
  "reasoning":"Proposta omite acabamento (longo/curto/reto). Existem 3 candidatos plausíveis com acabamento diferente — hard-fail por ausência de spec."
}

# RESPONDA APENAS COM O JSON. Sem comentários, sem markdown, sem texto fora.
```

#### 5.1.4 Hard-fail postproc (JS)
```ts
const HARD_FIELDS = new Set([
  'dimensao_principal','dimensao_secundaria','tensao_nominal',
  'corrente_nominal','numero_polos','categoria','material','acabamento',
]);
function enforceHardFail(d: MatcherDecision): MatcherDecision {
  const hits = d.mismatched_specs.filter(s => HARD_FIELDS.has(s));
  const corHit = d.mismatched_specs.includes('cor')
              && d.specs_proposta.categoria === 'cabo';
  if ((hits.length || corHit) && d.decision === 'match') {
    return { ...d, decision: 'no_match', candidate_id: null, confidence: 0 };
  }
  return d;
}
```
Cinto + suspensório: o LLM já é instruído, mas o JS revalida.

### 5.2 Threshold e fallback manual

- `LLM_AUTO_CONFIDENCE = 0.85` (já existe em `llmDocumentClient.ts:37`).
- `decision !== 'match'` OU `confidence < 0.85` → vai para a aba "Não identificados"
  do `DocumentReviewCarousel` para o usuário resolver via `SearchableSelect` ou
  marcar como "⏭ Pular" (`matchSource = 'skipped'` — fica fora do ranking).
- Cada confirmação manual grava `LearnedMatch` com `source='human'` no Dexie:
  futuras propostas com o MESMO termo normalizado pulam o LLM.

### 5.3 Casos reais cobertos (de `~/Documents/Tamires/lista.docx`)

| # | Colisão na base atual                                                                              | Hard-fail por                                  |
|---|-----------------------------------------------------------------------------------------------------|------------------------------------------------|
| 1 | "Eletroduto PVC 1 1/2 preto" × "Eletroduto PVC 1\" preto" × "Eletroduto PVC 2\" preto"             | `dimensao_principal`                           |
| 2 | "Uniduti cônico longo 1 1/2 alumínio" × "...curto..." × "Uniduti reto 1 1/2 alumínio"              | `acabamento`                                   |
| 3 | "Cabo 4mm 750V preto" × "Cabo 4mm 750V verde"                                                       | `cor` (categoria=cabo eleva a hard)            |
| 4 | "Cabo 10mm 750V preto" × "Cabo 4mm 750V preto"                                                      | `dimensao_principal`                           |
| 5 | "Cabo 3x4mm VFD HEPR-SHF1 0,6/1KV NEXANS" × "Cabo 3x4mm" genérico                                  | `tensao_nominal` + `marca` (presente na master)|
| 6 | "Condulete múltiplo X 1 1/2 com tampa" × "Condulete múltiplo X 1 1/2" sem tampa                    | `acabamento` (`com tampa`)                     |
| 7 | "Terminal de emenda de compressão para cabo 4mm" × "Terminal de compressão para cabo 4mm tipo agulha"| `acabamento` (`tipo agulha`)                  |
| 8 | "Fita Hellerman 300mm preta" × "Fita isolante 3M 33+" × "Fita isolante Azul"                       | `categoria` + `dimensao_principal` + `marca`   |
| 9 | "Caixa de Passagem PVC (20x20x10)" × "Caixa de Passagem PVC (15x15x10)"                            | `dimensao_secundaria`                          |
|10 | "Parafuso cabeça lentilha 1/4 x 1/2" × "Bucha S8 com parafuso cabeça philips"                      | `categoria` + `acabamento` (lentilha vs philips)|

> **Nota**: a lista mestre tem `Cabo 4mm 750V preto` em 2 linhas com quantidades
> diferentes (51 m e 35 m). Confirmar com a usuária se são pedidos distintos
> (e devem permanecer 2 linhas) ou erro de digitação. Listado em "Riscos".

---

## 6. Fórmula de ranking (JS puro — IA NÃO calcula)

### 6.1 Pseudocódigo
```
para cada fornecedor S em order.suppliers:
  cobertos_S = S.items.filter(i =>
    i.matchedProductId != null && i.matchSource != 'skipped')

  para cada item i em cobertos_S:
    qtd_master = order.items.find(o => o.id == i.matchedProductId).quantidade
    subtotal_i = Decimal(i.valorUnit) × Decimal(qtd_master)

  total_S    = soma(subtotal_i)                       // Decimal
  cobertura_S = cobertos_S.length / order.items.length // 0..1

ordenar fornecedores ASC por total_S            // menor = melhor
desempate (mesmo total_S): maior cobertura_S
em caso de empate completo: ordem alfabética do nome do fornecedor

para cada S no ranking:
  delta_vs_melhor_S     = total_S - min(total)              // R$
  delta_vs_melhor_pct_S = delta_vs_melhor_S / min(total)    // %
  rank_S                = posição (1, 2, 3, ...)
```

### 6.2 IA — papel restrito
A IA recebe os números **prontos** e gera APENAS um parágrafo de justificativa
(≤ 3 frases) por fornecedor. Prompt:

```text
Você recebe métricas JÁ CALCULADAS de propostas de orçamento. Sua tarefa é
ESCREVER uma justificativa textual curta para o ranking. Você NÃO recalcula,
NÃO soma, NÃO propõe número diferente do recebido. Se citar um número, use
EXATAMENTE o que veio na entrada.

Entrada:
{
  "propostas": [
    { "rank": 1, "supplier": "UNO Comércio", "total": "R$ 12.345,67",
      "cobertura": "94%", "delta_vs_melhor": "R$ 0,00",
      "itens_cobertos": 47, "itens_total": 50 },
    ...
  ]
}

Saída: array JSON com 1 string por fornecedor (mesma ordem da entrada).
Cada string é o parágrafo de justificativa. Nada além disso.
```

Validação JS pós-LLM: regex confere que cada `R$` mencionado existe na entrada
exata. Se a IA inventou um número, descarta a justificativa e usa template:
`"Posição {rank} com {cobertura} de cobertura e total de {total}."`

### 6.3 Reaproveitamento
`buildComparison` em `src/pricing/calculator.ts` já calcula subtotal por célula
e total por fornecedor. `ranker.ts` (NOVO) reusa `buildComparison` e adiciona:
ordenação, deltas, chamada da IA, validação.

---

## 7. Wireframes textuais (4 telas)

### 7.1 Tela 1 — Lista Mestre `[EXISTE]`
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [ Lista Mestre ]  [ Propostas ]  [ Ranking ]  [ Comparação ]            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Lista Mestre — 50 itens carregados                  [↻ trocar arquivo] │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Nome                                       │ Quantidade │ Unidade │   │
│  ├──────────────────────────────────────────────────────────────────┤   │
│  │ Eletrocalha 100x100 perfurada #20 (3m)     │      6     │ barra   │   │
│  │ Parafuso cabeça lentilha 1/4 x 1/2 c/porca │    200     │ peça    │   │
│  │ Cabo 10mm 750V preto                       │     42     │ metro   │   │
│  │ Cabo 4mm 750V preto                        │     51     │ metro   │   │
│  │ Cabo 4mm 750V preto                        │     35     │ metro   │   │
│  │ Cabo 4mm 750V verde                        │     17     │ metro   │   │
│  │ Cabo 3x4mm VFD HEPR-SHF1 0,6/1KV NEXANS    │    140     │ metro   │   │
│  │ Eletroduto PVC 1\" preto                    │      2     │ barra   │   │
│  │ Eletroduto PVC 1 1/2 preto                 │      4     │ barra   │   │
│  │ Eletroduto PVC 2\" preto                    │      3     │ barra   │   │
│  │ Uniduti cônico longo 1 1/2 alumínio        │     32     │ peça    │   │
│  │ Uniduti cônico curto 1 1/2 alumínio        │      6     │ peça    │   │
│  │ Uniduti reto 1 1/2 alumínio                │     12     │ peça    │   │
│  │ ...                                        │            │         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                       [ Avançar →    ]  │
└──────────────────────────────────────────────────────────────────────────┘
```
- Coluna 1 chama-se "Nome" (era "Descrição"); campo no tipo continua `descricao`.
- Linhas com mesmo nome aparecem como vêm da master (ver risco).

### 7.2 Tela 2 — Propostas `[EXISTE, polir]`
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Propostas (3 fornecedores)         [+ Adicionar PDF/DOCX]  [→ Ranking]  │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  Worker pool: 5    │
│  │ UNO Comércio │ │ Santil Comer.│ │ Planeta Elet.│  ●●●●○ (4 ativos) │
│  │ ✓ revisado   │ │ ⏳ revisão   │ │ ⏳ classific. │                    │
│  │ 47/50 itens  │ │ pendente     │ │ pendente     │                    │
│  │ R$ 12.345    │ │ 3 não-id.    │ │ —            │                    │
│  └──────────────┘ └──────────────┘ └──────────────┘                    │
├──────────────────────────────────────────────────────────────────────────┤
│  Carrossel de revisão (clique no card pra abrir):                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Santil Comercial — proposta_2.pdf                                │   │
│  │                                                                  │   │
│  │ ▼ Não identificados (3)                                          │   │
│  │ ┌─────────────────────────────────────────────────────────────┐  │   │
│  │ │ ELETROD PVC 1 1/2 PR 3M  qtd 2 BR  R$ 18,50/un  R$ 37,00    │  │   │
│  │ │ Match: [ Buscar na lista mestre... 🔍 ]    [✓ Conf.] [⏭ Pular]│ │   │
│  │ └─────────────────────────────────────────────────────────────┘  │   │
│  │                                                                  │   │
│  │ ▶ Identificados (44)        [colapsado]                          │   │
│  │ ▶ Pulados (3)               [colapsado]                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```
- Worker pool com indicador visual (●●●●○) de slots em uso.
- "⏭ Pular" e busca já existem em `DocumentReviewCarousel`.

### 7.3 Tela 3 — Ranking de Propostas `[NOVO]`
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Ranking de Propostas                                  [↻ recalcular]    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ 🥇  UNO Comércio                                                │     │
│  │     Total: R$ 12.345,67   Cobertura: 47/50 (94%)                │     │
│  │     Delta vs. melhor: — (referência)                            │     │
│  │     ──────────────────────────────────────────                  │     │
│  │     Proposta com menor custo total e cobertura quase completa.  │     │
│  │     3 itens não atendidos pelo fornecedor.                      │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ 🥈  Santil Comercial                                            │     │
│  │     Total: R$ 13.890,12   Cobertura: 49/50 (98%)                │     │
│  │     Delta vs. melhor: + R$ 1.544,45  (+12,5%)                   │     │
│  │     ──────────────────────────────────────────                  │     │
│  │     Maior cobertura do grupo, mas R$ 1.544 mais cara que o      │     │
│  │     vencedor; vale considerar se o item faltante na #1 inviabi- │     │
│  │     liza a obra.                                                │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ 🥉  Planeta Elétricos                                           │     │
│  │     Total: R$ 15.230,55   Cobertura: 45/50 (90%)                │     │
│  │     Delta vs. melhor: + R$ 2.884,88  (+23,4%)                   │     │
│  │     ──────────────────────────────────────────                  │     │
│  │     Maior preço e menor cobertura entre os três; descartável    │     │
│  │     salvo prazo/condição comercial vantajosa.                   │     │
│  └────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────┘
```
- Cards verticais; classificação 1=🥇 2=🥈 3=🥉 4+=número.
- Justificativa-IA sob cada card (parágrafo curto, ≤ 3 frases).
- Botão "↻ recalcular" reexecuta JS + refaz justificativa-IA.

### 7.4 Tela 4 — Comparação Cruzada `[REFAC]`
```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Comparação manual — preço unitário e subtotal por fornecedor                       │
├────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  ┌──────────────────────────┬────────────┬────────────┬────────────┬────────────┐ │
│  │ Item da lista mestre     │ Qtd · Un   │ UNO        │ Santil     │ Planeta    │ │
│  ├──────────────────────────┼────────────┼────────────┼────────────┼────────────┤ │
│  │ Cabo 10mm 750V preto     │ 42 · m     │ R$ 14,90/m │ R$ 16,20/m │ R$ 15,50/m │ │
│  │                          │            │  R$ 625,80 │  R$ 680,40 │  R$ 651,00 │ │
│  │                          │            │  ━━━━━━━━━ │            │            │ │
│  ├──────────────────────────┼────────────┼────────────┼────────────┼────────────┤ │
│  │ Cabo 4mm 750V preto      │ 51 · m     │ R$  6,40/m │ R$  7,00/m │     —      │ │
│  │                          │            │  R$ 326,40 │  R$ 357,00 │            │ │
│  │                          │            │  ━━━━━━━━━ │            │            │ │
│  ├──────────────────────────┼────────────┼────────────┼────────────┼────────────┤ │
│  │ Eletroduto PVC 1 1/2 PR  │  4 · barra │ R$ 32,00   │ R$ 31,50   │ R$ 33,00   │ │
│  │                          │            │  R$ 128,00 │  R$ 126,00 │  R$ 132,00 │ │
│  │                          │            │            │  ━━━━━━━━━ │            │ │
│  ├──────────────────────────┼────────────┼────────────┼────────────┼────────────┤ │
│  │ ...                      │            │            │            │            │ │
│  ├──────────────────────────┼────────────┼────────────┼────────────┼────────────┤ │
│  │ TOTAL                    │            │ R$ 12.345 🏆│ R$ 13.890 │ R$ 15.230  │ │
│  │ Cobertura                │            │   47 / 50  │   49 / 50  │   45 / 50  │ │
│  └──────────────────────────┴────────────┴────────────┴────────────┴────────────┘ │
│                                                                                    │
│  ━━━ vencedor da linha (verde) · 🏆 menor total geral · — fornecedor não cobre   │
└────────────────────────────────────────────────────────────────────────────────────┘
```
- Cada célula tem 2 linhas: `R$ X / un` + `R$ Y` (subtotal extrapolado para a qtd master).
- Vencedor por linha em verde (`━━━` no ASCII, classe CSS `.winner` no real).
- Rodapé: total da coluna + cobertura "47 / 50" + 🏆 do menor.

---

## 8. Riscos e pontos abertos

### 8.1 Riscos técnicos
| Risco                                                     | Mitigação                                                       |
|-----------------------------------------------------------|-----------------------------------------------------------------|
| API key DeepSeek embutida no bundle (já flagged no README)| Cogitar serverless proxy; documentar limitação para distribuição|
| Threshold 0.85 fixo                                        | Expor como setting (slider 0.5 — 0.95)                          |
| fuse.js cortar candidato bom                              | Threshold inicial 0.6 (solto, prioriza recall); ajustar por dados reais |
| LLM ainda colapsar mesmo com novo prompt                  | Hard-fail JS pós-processo é cinto + suspensório                 |
| Justificativa-IA inventando número                         | Validação regex; fallback template se inventou                  |
| DeepSeek sem embedding nativo                              | Pré-filtro lexical é suficiente para listas atuais; futuro: e5  |
| Tela 3 chama LLM toda vez                                 | Cache da justificativa por hash(rankingState) em Zustand        |
| `cor` como hard-fail só em cabos                          | Lista de categorias onde `cor` é load-bearing pode crescer      |
| Persistência IndexedDB sem export/import                  | Adicionar botão "Exportar/Importar matches aprendidos" (futuro) |

### 8.2 Pontos abertos a confirmar com a usuária
1. **Linhas duplicadas na lista mestre** (`Cabo 4mm 750V preto` × 2 com qtds 51 m
   e 35 m): são pedidos distintos (mantém 2 linhas, soma na comparação) ou erro
   de digitação na origem (deveria ser 1 linha com 86 m)?
2. **Cabo cor preto vs verde**: hoje a usuária trata como produtos diferentes
   (são, eletricamente). Confirmar que a Tela 4 deve mostrar 2 linhas separadas
   e NUNCA juntar pelo mesmo nome-base.
3. **Marca como hard-fail**: na master existe "Cabo ... NEXANS". Se a proposta
   trouxer "Cabo ... PRYSMIAN" com mesmas specs, deve ser `no_match` ou
   `uncertain`? (Plano atual: `no_match` — marcas distintas explicitamente.)
4. **Rankear apenas com cobertura completa?** Hoje plano: ranking inclui todos
   os fornecedores, mesmo com cobertura parcial. Alternativa: ocultar abaixo
   de X% de cobertura. Confirmar.
5. **Modelos DeepSeek** (`deepseek-v4-flash` / `-pro` no `.env.example`): são
   placeholders ou nomes reais? (DeepSeek público hoje: `deepseek-chat`,
   `deepseek-reasoner`.)

### 8.3 Out of scope desta iteração
- Implementar embeddings semânticos (futuro, para listas mestres > 200 itens).
- Servidor / proxy de API.
- i18n (atual: PT-BR fixo).
- Testes automatizados (E2E + unitários).
- Export/import do cache Dexie.

---

## 9. Plano de implementação (após aprovação deste documento)

| # | Tarefa                                                                            | Arquivo(s)                                              | Dependência |
|---|-----------------------------------------------------------------------------------|---------------------------------------------------------|-------------|
| 1 | Extrair prompts em arquivo dedicado                                               | `src/matching/prompts.ts` (NOVO)                        | —           |
| 2 | Implementar pré-filtro fuse.js                                                    | `src/matching/preFilter.ts` (NOVO)                      | —           |
| 3 | Refatorar matcher: usar preFilter + novo prompt + hard-fail JS                    | `src/matching/llmDocumentClient.ts`                     | 1, 2        |
| 4 | Ampliar mapping de unidades (M, JG, KIT, M²)                                      | `src/matching/llmClassifyDocument.ts`                   | —           |
| 5 | Criar tipos novos (`MatchSpecs`, `MatcherDecision`, `RankedProposal`)             | `src/types.ts`                                          | —           |
| 6 | Criar ranker (fórmula JS + chamada IA para justificativa)                         | `src/pricing/ranker.ts` (NOVO)                          | 5           |
| 7 | Criar componente Tela 3                                                           | `src/components/RankingProposals.tsx` (NOVO)            | 6           |
| 8 | Adicionar tab "Ranking" no shell                                                  | `src/App.tsx`, `src/store/index.ts`                     | 7           |
| 9 | Refac Tela 4: célula com unit + subtotal                                          | `src/components/ComparisonTable.tsx`                    | —           |
|10 | Relabel "Descrição" → "Nome" na Tela 1 (UI only)                                  | `src/components/PurchaseOrderViewer.tsx`                | —           |
|11 | Validar com `lista.docx` + `proposta_1/2/3.pdf`: matcher não colapsa, ranking OK  | manual                                                  | 1–10        |

---

## 10. Verificação ponta-a-ponta

1. Carregar `~/Documents/Tamires/lista.docx` na Tela 1 → ver 50 itens normalizados
   com colunas "Nome / Quantidade / Unidade".
2. Carregar `proposta_1.pdf`, `proposta_2.pdf`, `proposta_3.pdf` na Tela 2 →
   worker pool processa até 5 simultâneos; cards mostram progresso.
3. Inspecionar a aba "Identificados" de cada carrossel: verificar que NENHUMA
   das 10 colisões da §5.3 foi conflada (devem aparecer em "Não identificados"
   se a proposta não trouxer specs suficientes; ou identificadas corretamente
   se trouxer).
4. Resolver manualmente os "Não identificados" → ir para Tela 3.
5. Ranking: 3 cards ordenados por menor total. Conferir que `delta_vs_melhor`
   bate com `total - min(total)`. Justificativa da IA não cita números
   diferentes dos exibidos.
6. Tela 4: cada célula mostra `R$ X / un` + `R$ Y` (subtotal). Vencedor por
   linha em verde. Rodapé com total e 🏆 no menor.
