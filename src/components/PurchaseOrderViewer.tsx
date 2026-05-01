import { useStore } from '@/store';

export function PurchaseOrderViewer() {
  const order = useStore((s) => s.order);
  if (!order) return null;

  return (
    <details style={{ marginBottom: 16, background: '#fafafa', padding: 12, borderRadius: 8 }} open>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Ordem de Compra — {order.items.length} itens
      </summary>
      <table style={{ width: '100%', marginTop: 8, fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#eee' }}>
            <th style={{ textAlign: 'left', padding: 6 }}>#</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Descrição</th>
            <th style={{ textAlign: 'right', padding: 6 }}>Qtd</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Un.</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it, i) => (
            <tr key={it.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 6 }}>{i + 1}</td>
              <td style={{ padding: 6 }}>{it.descricao}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{it.quantidade}</td>
              <td style={{ padding: 6 }}>{it.unidade}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
