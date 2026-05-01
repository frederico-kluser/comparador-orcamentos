import { useStore } from '@/store';

const STATUS_LABEL: Record<string, string> = {
  parsing: 'Parseando…',
  processing: 'Processando LLM…',
  awaiting_review: 'Aguardando revisão',
  reviewed: 'Revisado',
  error: 'Erro',
};

export function SupplierQuotesGrid() {
  const suppliers = useStore((s) => s.suppliers);
  const removeSupplier = useStore((s) => s.removeSupplier);
  const openReview = useStore((s) => s.openReview);

  if (suppliers.length === 0) return null;

  return (
    <div className="suppliers-grid">
      {suppliers.map((sup, idx) => {
        const matched = sup.items.filter((i) => i.matchedProductId).length;
        const total = sup.items.length;
        const isLoading = sup.status === 'parsing' || sup.status === 'processing';

        return (
          <div key={sup.id} className="card supplier-card">
            <div className="top">
              <div style={{ minWidth: 0 }}>
                <div className="name" title={sup.supplierName}>
                  {sup.supplierName}
                </div>
                <div className="meta" title={sup.fileName}>
                  {sup.fileName}
                </div>
              </div>
              <button
                className="btn-ghost"
                onClick={() => removeSupplier(sup.id)}
                aria-label="Remover"
              >
                ✕
              </button>
            </div>
            <div className="hstack" style={{ gap: 8 }}>
              <span className={`badge ${sup.status}`}>
                {isLoading && <span className="spinner" />}
                {STATUS_LABEL[sup.status] || sup.status}
              </span>
              <span className="muted">
                {matched}/{total} itens
              </span>
            </div>
            {sup.errorMessage && (
              <div className="muted" style={{ color: 'var(--c-danger)' }}>
                {sup.errorMessage}
              </div>
            )}
            <button
              className="btn"
              onClick={() => openReview(idx)}
              disabled={sup.status === 'parsing'}
              style={{ marginTop: 4 }}
            >
              {sup.status === 'reviewed' ? 'Ver detalhes' : 'Revisar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
