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
  valorUnit: string | null;
  valorTotal: string | null;
  matchedProductId: string | null;
  matchSource: 'cache' | 'fuzzy' | 'llm' | 'manual' | null;
  matchScore: number | null;
}

export type SupplierStatus =
  | 'parsing'
  | 'processing'   // LLM em voo
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
