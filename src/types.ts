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
  hash: string; // hash da lista para o cache de matches
  items: OrderItem[];
  fileName: string;
  createdAt: number;
}

export interface SupplierLineItem {
  id: string;
  rawTerm: string;
  quantidade: number | null;
  valorUnit: string | null; // string para preservar precisão (Decimal-friendly)
  valorTotal: string | null;
  // resultado do matching
  matchedProductId: string | null;
  matchSource: 'cache' | 'fuzzy' | 'llm' | 'manual' | null;
  matchScore: number | null;
}

export interface SupplierQuote {
  id: string;
  fileName: string;
  supplierName: string;
  status: 'parsing' | 'matching' | 'awaiting_user' | 'ready' | 'error';
  items: SupplierLineItem[];
  errorMessage?: string;
}

export interface UnmatchedItem {
  supplierId: string;
  supplierName: string;
  itemId: string;
  rawTerm: string;
  quantidade: number | null;
  valorUnit: string | null;
  // candidatos sugeridos (top-N do Fuse)
  candidates: { id: string; descricao: string; score: number }[];
}
