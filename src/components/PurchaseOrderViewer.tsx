import { useStore } from '@/store';

export function PurchaseOrderViewer() {
  const order = useStore((s) => s.order);
  if (!order) return null;

  return (
    <details className="collapse" open>
      <summary>
        Itens da ordem ({order.items.length})
      </summary>
      <div className="collapse-body" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Descrição</th>
                <th className="right">Qtd</th>
                <th>Un.</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => (
                <tr key={it.id}>
                  <td>{i + 1}</td>
                  <td>{it.descricao}</td>
                  <td className="right">{it.quantidade}</td>
                  <td>{it.unidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
