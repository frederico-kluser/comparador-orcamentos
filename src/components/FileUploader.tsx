import { useDropzone } from 'react-dropzone';
import { useStore } from '@/store';
import { parseDocx } from '@/parser/docxParser';
import { parsePdf } from '@/parser/pdfParser';

export function FileUploader() {
  const { order, setOrder, addSupplier, runMatchingFor, setError } = useStore();

  const docxDz = useDropzone({
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    onDrop: async (files) => {
      try {
        setError(null);
        const order = await parseDocx(files[0]);
        setOrder(order);
      } catch (e) {
        setError((e as Error).message);
      }
    },
  });

  const pdfDz = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: !order,
    onDrop: async (files) => {
      setError(null);
      for (const f of files) {
        try {
          const supplier = await parsePdf(f);
          addSupplier(supplier);
          // dispara cascata em background
          runMatchingFor(supplier.id);
        } catch (e) {
          setError(`Erro em "${f.name}": ${(e as Error).message}`);
        }
      }
    },
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
      <div
        {...docxDz.getRootProps()}
        style={{
          border: '2px dashed #888',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          background: docxDz.isDragActive ? '#eef' : '#f6f6f8',
          cursor: 'pointer',
        }}
      >
        <input {...docxDz.getInputProps()} />
        <h3 style={{ margin: '0 0 8px' }}>📋 Ordem de Compra (.docx)</h3>
        {order ? (
          <div>
            <strong>{order.fileName}</strong>
            <div style={{ fontSize: 12, color: '#666' }}>
              {order.items.length} itens carregados — clique para substituir
            </div>
          </div>
        ) : (
          <div style={{ color: '#666' }}>Arraste ou clique para enviar o .docx</div>
        )}
      </div>

      <div
        {...pdfDz.getRootProps()}
        style={{
          border: '2px dashed #888',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          background: !order ? '#eee' : pdfDz.isDragActive ? '#efe' : '#f6f6f8',
          cursor: order ? 'pointer' : 'not-allowed',
          opacity: order ? 1 : 0.5,
        }}
      >
        <input {...pdfDz.getInputProps()} />
        <h3 style={{ margin: '0 0 8px' }}>📄 Orçamentos (.pdf — múltiplos)</h3>
        <div style={{ color: '#666' }}>
          {order
            ? 'Arraste um ou vários PDFs de fornecedores'
            : 'Carregue a ordem primeiro'}
        </div>
      </div>
    </div>
  );
}
