import { useStore } from '@/store';
import { formatBRL } from '@/lib/utils';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  parsing: { label: '⏳ Parseando…', color: '#666' },
  matching: { label: '🔄 Identificando produtos…', color: '#06f' },
  awaiting_user: { label: '⚠️ Itens para revisar', color: '#c80' },
  ready: { label: '✅ Pronto', color: '#0a0' },
  error: { label: '❌ Erro', color: '#c00' },
};

export function SupplierQuotesGrid() {
  const suppliers = useStore((s) => s.suppliers);
  const order = useStore((s) => s.order);
  const removeSupplier = useStore((s) => s.removeSupplier);
  if (suppliers.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <h3>Fornecedores ({suppliers.length})</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {suppliers.map((sup) => {
          const status = STATUS_LABEL[sup.status] || STATUS_LABEL.parsing;
          const matchedCount = sup.items.filter((it) => it.matchedProductId).length;
          const totalItems = sup.items.length;

          // total parcial (o que já matchou)
          let totalDecimal = 0;
          for (const it of sup.items) {
            if (it.matchedProductId && it.valorUnit && order) {
              const product = order.items.find((p) => p.id === it.matchedProductId);
              if (product) {
                totalDecimal += parseFloat(it.valorUnit) * product.quantidade;
              }
            }
          }

          return (
            <div
              key={sup.id}
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 14 }}>{sup.supplierName}</strong>
                <button
                  onClick={() => removeSupplier(sup.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00' }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>{sup.fileName}</div>
              <div style={{ color: status.color, fontSize: 13, marginBottom: 4 }}>{status.label}</div>
              <div style={{ fontSize: 12 }}>
                {matchedCount}/{totalItems} itens identificados
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Total parcial: <strong>{formatBRL(totalDecimal)}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
