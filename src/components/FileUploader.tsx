import { useDropzone } from 'react-dropzone';
import { useStore } from '@/store';
import { parseOrderFile } from '@/parser/orderParser';
import { parsePdf } from '@/parser/pdfParser';
import { parseSupplierTextFile } from '@/parser/supplierTextParser';

const ORDER_ACCEPT = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
};

const NOTE_ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'text/plain': ['.txt'],
};

export function OrderUploader() {
  const { order, setOrder, setError, setActiveTab } = useStore();

  const dz = useDropzone({
    accept: ORDER_ACCEPT,
    maxFiles: 1,
    onDrop: async (files) => {
      try {
        setError(null);
        const ord = await parseOrderFile(files[0]);
        setOrder(ord);
        setActiveTab('notas');
      } catch (e) {
        setError((e as Error).message);
      }
    },
  });

  return (
    <div
      {...dz.getRootProps()}
      className={
        'dropzone' +
        (dz.isDragActive ? ' active' : '')
      }
    >
      <input {...dz.getInputProps()} />
      <h3>📋 Ordem de Compra</h3>
      {order ? (
        <div>
          <strong>{order.fileName}</strong>
          <div className="hint">
            {order.items.length} itens carregados — clique para substituir
          </div>
        </div>
      ) : (
        <div className="hint">
          Arraste ou clique para enviar <strong>.docx · .doc · .pdf · .txt</strong>
        </div>
      )}
    </div>
  );
}

export function NotesUploader() {
  const { order, addSupplier, processSupplier, setError, openReview, suppliers } =
    useStore();

  const dz = useDropzone({
    accept: NOTE_ACCEPT,
    multiple: true,
    disabled: !order,
    onDrop: async (files) => {
      setError(null);
      const startIdx = useStore.getState().suppliers.length;
      let firstAdded = false;
      for (const f of files) {
        try {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          const supplier =
            ext === 'pdf' ? await parsePdf(f) : await parseSupplierTextFile(f);
          addSupplier(supplier);
          if (!firstAdded) {
            firstAdded = true;
            openReview(startIdx);
          }
          // dispara processamento (uma request LLM por documento)
          processSupplier(supplier.id);
        } catch (e) {
          setError(`Erro em "${f.name}": ${(e as Error).message}`);
        }
      }
    },
  });

  return (
    <div
      {...dz.getRootProps()}
      className={
        'dropzone' +
        (!order ? ' disabled' : '') +
        (dz.isDragActive ? ' active' : '')
      }
    >
      <input {...dz.getInputProps()} />
      <h3>📄 Notas / Orçamentos dos Fornecedores</h3>
      <div className="hint">
        {!order ? (
          'Carregue a ordem primeiro'
        ) : suppliers.length > 0 ? (
          <>
            {suppliers.length} carregado{suppliers.length > 1 ? 's' : ''} — arraste mais ou
            clique para adicionar
          </>
        ) : (
          <>
            Arraste um ou vários: <strong>.pdf · .docx · .doc · .txt</strong> (UTF-8)
          </>
        )}
      </div>
    </div>
  );
}
