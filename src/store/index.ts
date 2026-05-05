import { create } from 'zustand';
import type {
  AppTab,
  PurchaseOrder,
  SupplierLineItem,
  SupplierQuote,
} from '@/types';
import { normalizar } from '@/matching/normalize';
import { findCachedMatch, saveLearnedMatch } from '@/db/schema';
import {
  callDocumentMatchLLM,
  isLLMConfigured,
  LLM_AUTO_CONFIDENCE_THRESHOLD,
} from '@/matching/llmDocumentClient';

interface AppState {
  order: PurchaseOrder | null;
  suppliers: SupplierQuote[];

  activeTab: AppTab;
  reviewOpen: boolean;
  reviewIndex: number;

  globalError: string | null;

  // ações
  setOrder: (o: PurchaseOrder) => void;
  resetOrder: () => void;

  addSupplier: (q: SupplierQuote) => void;
  removeSupplier: (id: string) => void;
  setSupplierStatus: (
    id: string,
    status: SupplierQuote['status'],
    errorMessage?: string
  ) => void;

  /** Lê cache de matches humanos e, em uma única request, chama o LLM para os faltantes. */
  processSupplier: (supplierId: string) => Promise<void>;

  /** Resolve manualmente um item específico de um fornecedor. */
  resolveItem: (
    supplierId: string,
    itemId: string,
    productId: string | '__none__'
  ) => Promise<void>;

  setActiveTab: (t: AppTab) => void;
  openReview: (idx?: number) => void;
  closeReview: () => void;
  setReviewIndex: (i: number) => void;

  setError: (msg: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  order: null,
  suppliers: [],

  activeTab: 'ordem',
  reviewOpen: false,
  reviewIndex: 0,

  globalError: null,

  setOrder: (order) => set({ order, suppliers: [] }),
  resetOrder: () => set({ order: null, suppliers: [], reviewOpen: false }),

  addSupplier: (q) => set((s) => ({ suppliers: [...s.suppliers, q] })),
  removeSupplier: (id) =>
    set((s) => {
      const next = s.suppliers.filter((x) => x.id !== id);
      const newIdx = Math.min(s.reviewIndex, Math.max(0, next.length - 1));
      return {
        suppliers: next,
        reviewIndex: newIdx,
        reviewOpen: s.reviewOpen && next.length > 0,
      };
    }),
  setSupplierStatus: (id, status, errorMessage) =>
    set((s) => ({
      suppliers: s.suppliers.map((sup) =>
        sup.id === id ? { ...sup, status, errorMessage } : sup
      ),
    })),

  processSupplier: async (supplierId) => {
    const { order, suppliers } = get();
    if (!order) return;
    const sup = suppliers.find((x) => x.id === supplierId);
    if (!sup) return;

    set((s) => ({
      suppliers: s.suppliers.map((x) =>
        x.id === supplierId ? { ...x, status: 'processing' } : x
      ),
    }));

    const updatedItems: SupplierLineItem[] = [...sup.items];
    const stillUnmatched: { id: string; rawTerm: string }[] = [];

    // 1) Cache APENAS de matches confirmados pelo humano (source='human').
    //    Sem fuzzy: toda decisão automática vai para a LLM.
    for (let i = 0; i < updatedItems.length; i++) {
      const it = updatedItems[i];
      const norm = normalizar(it.rawTerm);
      if (!norm) {
        stillUnmatched.push({ id: it.id, rawTerm: it.rawTerm });
        continue;
      }

      const cached = await findCachedMatch(norm, order.hash, true);
      if (cached && cached.confirmed_count >= 1) {
        const stillExists = order.items.some((c) => c.id === cached.canonical_product_id);
        if (stillExists) {
          updatedItems[i] = {
            ...it,
            matchedProductId: cached.canonical_product_id,
            matchSource: 'cache',
            matchScore: cached.confidence,
          };
          continue;
        }
      }

      stillUnmatched.push({ id: it.id, rawTerm: it.rawTerm });
    }

    // 2) LLM em UMA request por documento (apenas para os ainda não identificados)
    if (stillUnmatched.length > 0 && isLLMConfigured()) {
      try {
        const resp = await callDocumentMatchLLM(
          stillUnmatched,
          order.items.map((p) => ({ id: p.id, descricao: p.descricao }))
        );

        for (const m of resp.matches) {
          if (!m.productId) continue;
          if (m.confidence < LLM_AUTO_CONFIDENCE_THRESHOLD) continue;

          const idx = updatedItems.findIndex((x) => x.id === m.itemId);
          if (idx < 0) continue;
          updatedItems[idx] = {
            ...updatedItems[idx],
            matchedProductId: m.productId,
            matchSource: 'llm',
            matchScore: m.confidence,
          };
          // não cacheamos LLM matches: cache é exclusivo de matches humanos confirmados.
        }
      } catch (e) {
        console.warn('LLM falhou para o documento, indo para revisão manual:', e);
      }
    }

    const remainingUnmatched = updatedItems.filter((x) => !x.matchedProductId).length;
    set((s) => ({
      suppliers: s.suppliers.map((x) =>
        x.id === supplierId
          ? {
              ...x,
              items: updatedItems,
              status: remainingUnmatched > 0 ? 'awaiting_review' : 'reviewed',
            }
          : x
      ),
    }));
  },

  resolveItem: async (supplierId, itemId, productId) => {
    const { order, suppliers } = get();
    if (!order) return;

    const sup = suppliers.find((x) => x.id === supplierId);
    if (!sup) return;
    const item = sup.items.find((x) => x.id === itemId);
    if (!item) return;

    let cachedProduct: { id: string; descricao: string } | null = null;
    if (productId !== '__none__') {
      const p = order.items.find((x) => x.id === productId);
      if (p) cachedProduct = { id: p.id, descricao: p.descricao };
    }

    const newItems = sup.items.map((it) => {
      if (it.id !== itemId) return it;
      if (productId === '__none__') {
        return { ...it, matchedProductId: null, matchSource: null, matchScore: null };
      }
      return {
        ...it,
        matchedProductId: productId,
        matchSource: 'manual' as const,
        matchScore: 1,
      };
    });

    const remaining = newItems.filter((x) => !x.matchedProductId).length;
    set((s) => ({
      suppliers: s.suppliers.map((x) =>
        x.id === supplierId
          ? {
              ...x,
              items: newItems,
              status: remaining > 0 ? 'awaiting_review' : 'reviewed',
            }
          : x
      ),
    }));

    if (cachedProduct) {
      await saveLearnedMatch({
        normalized_supplier_term: normalizar(item.rawTerm),
        raw_supplier_term: item.rawTerm,
        product_list_hash: order.hash,
        canonical_product_id: cachedProduct.id,
        canonical_product_name: cachedProduct.descricao,
        confidence: 1,
        source: 'human',
        confirmed_count: 1,
        created_at: Date.now(),
        last_used_at: Date.now(),
      });
    }
  },

  setActiveTab: (t) => set({ activeTab: t }),
  openReview: (idx) =>
    set((s) => ({
      reviewOpen: true,
      reviewIndex: typeof idx === 'number' ? idx : s.reviewIndex,
    })),
  closeReview: () => set({ reviewOpen: false }),
  setReviewIndex: (i) => set({ reviewIndex: i }),

  setError: (msg) => set({ globalError: msg }),
}));
