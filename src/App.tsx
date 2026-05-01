import { useStore } from '@/store';
import { FileUploader } from '@/components/FileUploader';
import { PurchaseOrderViewer } from '@/components/PurchaseOrderViewer';
import { SupplierQuotesGrid } from '@/components/SupplierQuotesGrid';
import { UnmatchedItemsModal } from '@/components/UnmatchedItemsModal';
import { ComparisonTable } from '@/components/ComparisonTable';
import { isLLMConfigured } from '@/matching/llmClient';

export default function App() {
  const error = useStore((s) => s.globalError);
  const setError = useStore((s) => s.setError);
  const llmOk = isLLMConfigured();

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 24,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#222',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Comparador de Orçamentos</h1>
        <p style={{ color: '#666', margin: '4px 0' }}>
          POC — Word + PDFs → comparação automática com matching híbrido (cache → fuzzy → LLM →
          manual)
        </p>
        {!llmOk && (
          <div
            style={{
              background: '#fff8e0',
              border: '1px solid #e0b800',
              padding: 8,
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            ⚠️ Chave da OpenRouter não configurada. O LLM ficará desabilitado — apenas
            cache + fuzzy + revisão manual estarão ativos. Configure{' '}
            <code>VITE_OPENROUTER_API_KEY</code> no arquivo <code>.env</code>.
          </div>
        )}
      </header>

      {error && (
        <div
          style={{
            background: '#ffe5e5',
            border: '1px solid #c00',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: '#900' }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      <FileUploader />
      <PurchaseOrderViewer />
      <SupplierQuotesGrid />
      <ComparisonTable />
      <UnmatchedItemsModal />
    </div>
  );
}
