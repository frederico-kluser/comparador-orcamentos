import { useStore } from '@/store';
import { OrderUploader, NotesUploader } from '@/components/FileUploader';
import { PurchaseOrderViewer } from '@/components/PurchaseOrderViewer';
import { SupplierQuotesGrid } from '@/components/SupplierQuotesGrid';
import { DocumentReviewCarousel } from '@/components/DocumentReviewCarousel';
import { ComparisonTable } from '@/components/ComparisonTable';
import { Tabs } from '@/components/Tabs';
import { isLLMConfigured } from '@/matching/llmDocumentClient';

export default function App() {
  const error = useStore((s) => s.globalError);
  const setError = useStore((s) => s.setError);
  const tab = useStore((s) => s.activeTab);
  const order = useStore((s) => s.order);
  const suppliers = useStore((s) => s.suppliers);
  const openReview = useStore((s) => s.openReview);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const llmOk = isLLMConfigured();
  const allReviewed =
    suppliers.length > 0 && suppliers.every((s) => s.status === 'reviewed');

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Comparador de Orçamentos</h1>
        <p className="subtitle">
          Word/Doc/Txt + PDFs/Notas → classificação por LLM, correlação por LLM, cálculo programático
        </p>
        <Tabs />
      </header>

      <main className="app-main">
        {!llmOk && (
          <div className="banner-warn">
            ⚠️ <code>VITE_DEEPSEEK_API_KEY</code> não configurada — sem LLM,
            os documentos não podem ser classificados nem correlacionados.
          </div>
        )}
        {error && (
          <div className="banner-error">
            <span>{error}</span>
            <button className="x" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}

        {tab === 'ordem' && (
          <div className="stack">
            <OrderUploader />
            <PurchaseOrderViewer />
            {order && (
              <div className="hstack">
                <button
                  className="btn btn-primary"
                  onClick={() => setActiveTab('notas')}
                >
                  Próximo: anexar notas →
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'notas' && (
          <div className="stack">
            <NotesUploader />
            <SupplierQuotesGrid />
            {suppliers.length > 0 && (
              <div className="hstack">
                <button
                  className="btn"
                  onClick={() => openReview(0)}
                >
                  Abrir revisão
                </button>
                <span className="spacer" />
                <button
                  className="btn btn-primary"
                  disabled={!allReviewed}
                  onClick={() => setActiveTab('comparacao')}
                >
                  {allReviewed
                    ? 'Ver comparação →'
                    : 'Resolva todos os itens para liberar a comparação'}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'comparacao' && <ComparisonTable />}
      </main>

      <DocumentReviewCarousel />
    </div>
  );
}
