import { useMemo } from 'react';
import { useStore } from '@/store';
import { buildComparison } from '@/pricing/calculator';
import { formatBRL } from '@/lib/utils';

export function ComparisonTable() {
  const order = useStore((s) => s.order);
  const suppliers = useStore((s) => s.suppliers);
  const unmatchedQueue = useStore((s) => s.unmatchedQueue);

  const result = useMemo(() => {
    if (!order || suppliers.length === 0) return null;
    return buildComparison(order, suppliers);
  }, [order, suppliers]);

  if (!order || !result || suppliers.length === 0) return null;

  const allReady = suppliers.every((s) => s.status === 'ready');

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Comparativo</h3>
      {!allReady && unmatchedQueue.length > 0 && (
        <div
          style={{
            background: '#fff8e0',
            border: '1px solid #e0b800',
            padding: 10,
            borderRadius: 6,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          ⚠️ Há {unmatchedQueue.length} item(ns) não identificado(s). O comparativo abaixo é parcial
          até que todos sejam revisados.
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            background: '#fff',
          }}
        >
          <thead>
            <tr style={{ background: '#222', color: '#fff' }}>
              <th style={th}>Produto</th>
              <th style={{ ...th, textAlign: 'right' }}>Qtd</th>
              {suppliers.map((s) => (
                <th key={s.id} style={{ ...th, textAlign: 'right', minWidth: 110 }}>
                  {s.supplierName}
                </th>
              ))}
              <th style={{ ...th, textAlign: 'left' }}>Melhor</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.product.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={td}>{row.product.descricao}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {row.product.quantidade} {row.product.unidade}
                </td>
                {suppliers.map((s) => {
                  const cell = row.cellsBySupplier[s.id];
                  const isBest = cell?.subtotal && row.bestSupplierId === s.id;
                  return (
                    <td
                      key={s.id}
                      style={{
                        ...td,
                        textAlign: 'right',
                        background: isBest ? '#d6f5d6' : 'transparent',
                        fontWeight: isBest ? 700 : 400,
                        color: !cell?.subtotal ? '#aaa' : '#000',
                      }}
                    >
                      {cell?.subtotal ? (
                        <>
                          {formatBRL(cell.subtotal)}
                          {cell.matchSource && (
                            <div style={{ fontSize: 10, color: '#666' }}>
                              {sourceLabel(cell.matchSource)}
                            </div>
                          )}
                        </>
                      ) : (
                        '— faltante —'
                      )}
                    </td>
                  );
                })}
                <td style={{ ...td, fontSize: 12 }}>
                  {row.bestSupplierId
                    ? suppliers.find((s) => s.id === row.bestSupplierId)?.supplierName
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f0f0f0', fontWeight: 700 }}>
              <td style={td} colSpan={2}>
                TOTAL
              </td>
              {suppliers.map((s) => {
                const isWinner = s.id === result.globalWinnerId;
                const missing = result.missingBySupplier[s.id];
                return (
                  <td
                    key={s.id}
                    style={{
                      ...td,
                      textAlign: 'right',
                      background: isWinner ? '#a8e8a8' : 'transparent',
                    }}
                  >
                    {formatBRL(result.totals[s.id])}
                    {missing > 0 && (
                      <div style={{ fontSize: 10, color: '#a60', fontWeight: 400 }}>
                        ({missing} faltante{missing > 1 ? 's' : ''})
                      </div>
                    )}
                  </td>
                );
              })}
              <td style={td}>
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

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 13,
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'top',
};

function sourceLabel(s: string): string {
  switch (s) {
    case 'cache':
      return '💾 cache';
    case 'fuzzy':
      return '🔤 fuzzy';
    case 'llm':
      return '🤖 LLM';
    case 'manual':
      return '✋ manual';
    default:
      return s;
  }
}
