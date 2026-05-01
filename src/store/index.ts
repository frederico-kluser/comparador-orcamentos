import { create } from 'zustand';
import type { PurchaseOrder, SupplierQuote, UnmatchedItem } from '@/types';
import { matchItem, confirmManualMatch } from '@/matching/orchestrator';

interface AppState {
  order: PurchaseOrder | null;
  suppliers: SupplierQuote[];
  unmatchedQueue: UnmatchedItem[];
  globalError: string | null;

  setOrder: (order: PurchaseOrder) => void;
  resetOrder: () => void;

  addSupplier: (q: SupplierQuote) => void;
  removeSupplier: (id: string) => void;
  setSupplierStatus: (id: string, status: SupplierQuote['status']) => void;

  // Roda a cascata para todos os itens de um fornecedor.
  // Itens não-matchados vão para unmatchedQueue.
  runMatchingFor: (supplierId: string) => Promise<void>;

  // Modal: usuário confirmou / pulou um item
  resolveUnmatchedItem: (
    queueIndex: number,
    productId: string | '__none__'
  ) => Promise<void>;
  skipUnmatchedItem: (queueIndex: number) => void;

  setError: (msg: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  order: null,
  suppliers: [],
  unmatchedQueue: [],
  globalError: null,

  setOrder: (order) => set({ order, suppliers: [], unmatchedQueue: [] }),
  resetOrder: () => set({ order: null, suppliers: [], unmatchedQueue: [] }),

  addSupplier: (q) => set((s) => ({ suppliers: [...s.suppliers, q] })),
  removeSupplier: (id) =>
    set((s) => ({
      suppliers: s.suppliers.filter((x) => x.id !== id),
      unmatchedQueue: s.unmatchedQueue.filter((q) => q.supplierId !== id),
    })),
  setSupplierStatus: (id, status) =>
    set((s) => ({
      suppliers: s.suppliers.map((sup) => (sup.id === id ? { ...sup, status } : sup)),
    })),

  runMatchingFor: async (supplierId) => {
    const { order, suppliers } = get();
    if (!order) return;
    const sup = suppliers.find((s) => s.id === supplierId);
    if (!sup) return;

    set((s) => ({
      suppliers: s.suppliers.map((x) => (x.id === supplierId ? { ...x, status: 'matching' } : x)),
    }));

    const updatedItems = [...sup.items];
    const newUnmatched: UnmatchedItem[] = [];

    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];
      try {
        const outcome = await matchItem(item.rawTerm, order.items, order.hash);
        if (outcome.matched && outcome.productId) {
          updatedItems[i] = {
            ...item,
            matchedProductId: outcome.productId,
            matchSource: outcome.source ?? null,
            matchScore: outcome.score ?? null,
          };
        } else {
          newUnmatched.push({
            supplierId: sup.id,
            supplierName: sup.supplierName,
            itemId: item.id,
            rawTerm: item.rawTerm,
            quantidade: item.quantidade,
            valorUnit: item.valorUnit,
            candidates: outcome.candidates ?? [],
          });
        }
      } catch (e) {
        console.error('Erro ao matchar item', item, e);
        newUnmatched.push({
          supplierId: sup.id,
          supplierName: sup.supplierName,
          itemId: item.id,
          rawTerm: item.rawTerm,
          quantidade: item.quantidade,
          valorUnit: item.valorUnit,
          candidates: [],
        });
      }
    }

    set((s) => ({
      suppliers: s.suppliers.map((x) =>
        x.id === supplierId
          ? {
              ...x,
              items: updatedItems,
              status: newUnmatched.length > 0 ? 'awaiting_user' : 'ready',
            }
          : x
      ),
      unmatchedQueue: [...s.unmatchedQueue, ...newUnmatched],
    }));
  },

  resolveUnmatchedItem: async (queueIndex, productId) => {
    const { order, unmatchedQueue, suppliers } = get();
    if (!order) return;
    const u = unmatchedQueue[queueIndex];
    if (!u) return;

    const newSuppliers = suppliers.map((sup) => {
      if (sup.id !== u.supplierId) return sup;
      const newItems = sup.items.map((it) => {
        if (it.id !== u.itemId) return it;
        if (productId === '__none__') {
          return { ...it, matchedProductId: null, matchSource: null };
        }
        return {
          ...it,
          matchedProductId: productId,
          matchSource: 'manual' as const,
          matchScore: 1,
        };
      });
      return { ...sup, items: newItems };
    });

    // grava no cache de aprendizado
    if (productId !== '__none__') {
      const product = order.items.find((p) => p.id === productId);
      if (product) {
        await confirmManualMatch(u.rawTerm, productId, product.descricao, order.hash);
      }
    }

    const newQueue = unmatchedQueue.filter((_, i) => i !== queueIndex);

    // reavaliar status dos fornecedores
    const finalSuppliers = newSuppliers.map((sup) => {
      const stillUnmatched = newQueue.some((q) => q.supplierId === sup.id);
      if (stillUnmatched) return { ...sup, status: 'awaiting_user' as const };
      return { ...sup, status: 'ready' as const };
    });

    set({
      suppliers: finalSuppliers,
      unmatchedQueue: newQueue,
    });
  },

  skipUnmatchedItem: (queueIndex) => {
    const { unmatchedQueue, suppliers } = get();
    const u = unmatchedQueue[queueIndex];
    if (!u) return;
    const newQueue = unmatchedQueue.filter((_, i) => i !== queueIndex);
    const newSuppliers = suppliers.map((sup) => {
      const stillUnmatched = newQueue.some((q) => q.supplierId === sup.id);
      return {
        ...sup,
        status: stillUnmatched ? ('awaiting_user' as const) : ('ready' as const),
      };
    });
    set({ unmatchedQueue: newQueue, suppliers: newSuppliers });
  },

  setError: (msg) => set({ globalError: msg }),
}));
