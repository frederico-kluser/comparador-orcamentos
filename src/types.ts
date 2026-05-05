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
  matchSource: 'cache' | 'llm' | 'manual' | null;
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

export type AppTab = 'ordem' | 'notas' | 'comparacao';
