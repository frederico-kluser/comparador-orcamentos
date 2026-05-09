import { useMemo } from 'react';
import { useStore } from '@/store';
import { buildComparison } from '@/pricing/calculator';
import { formatBRL } from '@/lib/utils';

export function ComparisonTable() {
  const order = useStore((s) => s.order);
  const suppliers = useStore((s) => s.suppliers);

  const result = useMemo(() => {
    if (!order || suppliers.length === 0) return null;
    return buildComparison(order, suppliers);
  }, [order, suppliers]);

  if (!order || !result || suppliers.length === 0) {
    return (
      <div className="muted" style={{ padding: 24 }}>
        Carregue a ordem e os orçamentos para ver a comparação.
      </div>
    );
  }

  const allReviewed = suppliers.every((s) => s.status === 'reviewed');

  return (
    <div>
      {!allReviewed && (
        <div className="banner-warn">
          ⚠️ Há itens não revisados. Volte na aba "Notas" e termine a revisão.
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="right">Qtd</th>
              {suppliers.map((s) => (
                <th key={s.id} className="right">
                  {s.supplierName}
                </th>
              ))}
              <th>Melhor</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.product.id}>
                <td>{row.product.descricao}</td>
                <td className="right">
                  {row.product.quantidade} {row.product.unidade}
                </td>
                {suppliers.map((s) => {
                  const cell = row.cellsBySupplier[s.id];
                  const isBest = cell?.subtotal && row.bestSupplierId === s.id;
                  return (
                    <td
                      key={s.id}
                      className={'right' + (isBest ? ' best' : '')}
                      style={{ color: !cell?.subtotal ? 'var(--c-muted)' : undefined }}
                    >
                      {cell?.subtotal && cell.valorUnit ? (
                        <>
                          <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>
                            {formatBRL(cell.valorUnit)}/{row.product.unidade}
                          </div>
                          <div style={{ fontWeight: 600 }}>{formatBRL(cell.subtotal)}</div>
                          {cell.matchSource && (
                            <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>
                              {sourceLabel(cell.matchSource)}
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
                <td style={{ fontSize: 12 }}>
                  {row.bestSupplierId
                    ? suppliers.find((s) => s.id === row.bestSupplierId)?.supplierName
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--c-border)', fontWeight: 700 }}>
              <td colSpan={2}>TOTAL</td>
              {suppliers.map((s) => {
                const isWinner = s.id === result.globalWinnerId;
                const missing = result.missingBySupplier[s.id];
                return (
                  <td key={s.id} className={'right' + (isWinner ? ' best' : '')}>
                    {formatBRL(result.totals[s.id])}
                    {missing > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--c-warn)', fontWeight: 400 }}>
                        ({missing} faltante{missing > 1 ? 's' : ''})
                      </div>
                    )}
                  </td>
                );
              })}
              <td>
                {result.globalWinnerId
                  ? '🏆 ' +
                    suppliers.find((s) => s.id === result.globalWinnerId)?.supplierName
                  : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'cache': return '💾 cache (humano)';
    case 'llm': return '🤖 LLM';
    case 'manual': return '✋ manual';
    case 'skipped': return '⏭ pulado';
    default: return s;
  }
}
