// Tipos compartilhados em todo o app

export interface OrderItem {
  id: string;
  descricao: string;
  descricaoNormalizada: string;
  quantidade: number;
  unidade: string;
}

export interface PurchaseOrder {
  id: string;
  hash: string;
  items: OrderItem[];
  fileName: string;
  createdAt: number;
}

export interface SupplierLineItem {
  id: string;
  rawTerm: string;
  quantidade: number | null;
  unidadeAbrev: string | null;   // como veio no PDF: "BR", "PC", "UN", "MT", "RL", "PCT", "CEN"
  unidadeHumana: string | null;  // pt-BR plural: "barras", "peças", "unidades", "metros", "rolos"
  isPromocao: boolean;
  valorUnit: string | null;
  valorTotal: string | null;
  matchedProductId: string | null;
  matchSource: 'cache' | 'llm' | 'manual' | 'skipped' | null;
  matchScore: number | null;
}

export type SupplierStatus =
  | 'parsing'        // lendo arquivo
  | 'classifying'    // LLM extraindo a tabela do documento
  | 'processing'     // LLM correlacionando itens com a ordem
  | 'awaiting_review'
  | 'reviewed'
  | 'error';

export interface SupplierQuote {
  id: string;
  fileName: string;
  supplierName: string;
  status: SupplierStatus;
  items: SupplierLineItem[];
  errorMessage?: string;
}

export type AppTab = 'ordem' | 'notas' | 'comparacao' | 'ranking';

/**
 * Saída estruturada do matcher (Stage 2 — extração CoT antes da decisão).
 * Ver PLANO_PICA.md §3.2.
 */
export interface MatchSpecs {
  categoria: string | null;
  material: string | null;
  dimensao_principal: string | null;
  dimensao_secundaria: string | null;
  tensao_nominal: string | null;
  corrente_nominal: string | null;
  numero_polos: string | null;
  acabamento: string | null;
  cor: string | null;
  marca: string | null;
  norma_abnt: string | null;
  ncm: string | null;
  unidade_comercial: string | null;
}

export type MatchDecision = 'match' | 'no_match' | 'uncertain';

export interface MatcherDecision {
  itemId: string;
  candidate_id: string | null;
  decision: MatchDecision;
  confidence: number;
  specs_proposta: MatchSpecs;
  specs_master: MatchSpecs | null;
  mismatched_specs: string[];
  reasoning: string;
}

/**
 * Uma posição do ranking de propostas (Tela 3).
 * Total e deltas são strings (Decimal serializado) para preservar precisão.
 */
export interface RankedProposal {
  rank: number;
  supplierId: string;
  supplierName: string;
  total: string;
  itens_cobertos: number;
  itens_total_master: number;
  cobertura: number;
  delta_vs_melhor: string;
  delta_vs_melhor_pct: number;
  justificativa_ia: string;
}
