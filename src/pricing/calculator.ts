import Decimal from 'decimal.js';
import type { OrderItem, PurchaseOrder, SupplierQuote } from '@/types';

export interface ComparisonCell {
  supplierId: string;
  supplierItemId: string | null;
  rawTerm: string | null;
  valorUnit: Decimal | null;
  subtotal: Decimal | null;
  matchSource: string | null;
}

export interface ComparisonRow {
  product: OrderItem;
  cellsBySupplier: Record<string, ComparisonCell | null>;
  bestSupplierId: string | null;
  bestSubtotal: Decimal | null;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  totals: Record<string, Decimal>; // supplierId -> total
  globalWinnerId: string | null;
  missingBySupplier: Record<string, number>; // qtos itens cada fornecedor não cobre
}

export function buildComparison(
  order: PurchaseOrder,
  suppliers: SupplierQuote[]
): ComparisonResult {
  const rows: ComparisonRow[] = order.items.map((p) => ({
    product: p,
    cellsBySupplier: Object.fromEntries(suppliers.map((s) => [s.id, null])),
    bestSupplierId: null,
    bestSubtotal: null,
  }));

  // preenche células
  for (const sup of suppliers) {
    for (const item of sup.items) {
      if (!item.matchedProductId) continue;
      const row = rows.find((r) => r.product.id === item.matchedProductId);
      if (!row) continue;

      const valorUnit = item.valorUnit ? new Decimal(item.valorUnit) : null;
      // usamos a quantidade da ORDEM, não a do PDF (foco: qual fornecedor é mais barato para o que QUEREMOS)
      const qty = new Decimal(row.product.quantidade);
      const subtotal = valorUnit ? valorUnit.times(qty) : null;

      row.cellsBySupplier[sup.id] = {
        supplierId: sup.id,
        supplierItemId: item.id,
        rawTerm: item.rawTerm,
        valorUnit,
        subtotal,
        matchSource: item.matchSource,
      };
    }
  }

  // calcula melhor por linha
  for (const row of rows) {
    let bestId: string | null = null;
    let bestVal: Decimal | null = null;
    for (const supId of Object.keys(row.cellsBySupplier)) {
      const cell = row.cellsBySupplier[supId];
      if (!cell?.subtotal) continue;
      if (!bestVal || cell.subtotal.lt(bestVal)) {
        bestVal = cell.subtotal;
        bestId = supId;
      }
    }
    row.bestSupplierId = bestId;
    row.bestSubtotal = bestVal;
  }

  // totais
  const totals: Record<string, Decimal> = {};
  const missingBySupplier: Record<string, number> = {};
  for (const sup of suppliers) {
    let total = new Decimal(0);
    let missing = 0;
    for (const row of rows) {
      const cell = row.cellsBySupplier[sup.id];
      if (cell?.subtotal) {
        total = total.plus(cell.subtotal);
      } else {
        missing++;
      }
    }
    totals[sup.id] = total;
    missingBySupplier[sup.id] = missing;
  }

  // vencedor global = menor total ENTRE OS QUE COBREM TUDO
  // se ninguém cobre tudo, escolhe o de menor "total + estimativa de faltantes"
  // POC: simplificamos para "menor total entre os que cobrem tudo, ou menor total simples se ninguém cobre"
  let globalWinnerId: string | null = null;
  let bestTotal: Decimal | null = null;
  // 1ª passada: só os que cobrem tudo
  for (const sup of suppliers) {
    if (missingBySupplier[sup.id] > 0) continue;
    const total = totals[sup.id];
    if (!bestTotal || total.lt(bestTotal)) {
      bestTotal = total;
      globalWinnerId = sup.id;
    }
  }
  // 2ª passada: se ninguém cobre tudo, pega o de menor total entre os com mais cobertura
  if (!globalWinnerId && suppliers.length > 0) {
    const minMissing = Math.min(...suppliers.map((s) => missingBySupplier[s.id]));
    for (const sup of suppliers) {
      if (missingBySupplier[sup.id] !== minMissing) continue;
      const total = totals[sup.id];
      if (!bestTotal || total.lt(bestTotal)) {
        bestTotal = total;
        globalWinnerId = sup.id;
      }
    }
  }

  return { rows, totals, globalWinnerId, missingBySupplier };
}
