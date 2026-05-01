import { useState, useMemo } from 'react';
import { useStore } from '@/store';
import { formatBRL } from '@/lib/utils';
import { normalizar } from '@/matching/normalize';

export function UnmatchedItemsModal() {
  const queue = useStore((s) => s.unmatchedQueue);
  const order = useStore((s) => s.order);
  const resolve = useStore((s) => s.resolveUnmatchedItem);
  const skip = useStore((s) => s.skipUnmatchedItem);

  const [filter, setFilter] = useState('');

  const current = queue[0];

  // Lista filtrada — combina busca textual com candidatos sugeridos no topo
  const filteredOptions = useMemo(() => {
    if (!order || !current) return { sugeridos: [], outros: [] };
    const filterNorm = normalizar(filter);

    const candidateIds = new Set(current.candidates.map((c) => c.id));
    const candidates = current.candidates
      .map((c) => order.items.find((p) => p.id === c.id))
      .filter(Boolean) as typeof order.items;

    const others = order.items.filter((p) => !candidateIds.has(p.id));

    const matchesFilter = (descNorm: string) =>
      !filterNorm || filterNorm.split(' ').every((tok) => descNorm.includes(tok));

    const filteredCands = candidates.filter((p) => matchesFilter(p.descricaoNormalizada));
    const filteredOthers = others.filter((p) => matchesFilter(p.descricaoNormalizada));

    return { sugeridos: filteredCands, outros: filteredOthers };
  }, [order, current, filter]);

  if (!current || !order) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: '#fff',
          width: 'min(640px, 92vw)',
          maxHeight: '85vh',
          borderRadius: 10,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>Identificar produto</h2>
          <span style={{ fontSize: 12, color: '#666' }}>
            {queue.length} pendente{queue.length > 1 ? 's' : ''}
          </span>
        </div>

        <div
          style={{
            background: '#f6f6f8',
            padding: 12,
            borderRadius: 6,
            margin: '12px 0',
            fontSize: 14,
          }}
        >
          <div>
            <strong>Fornecedor:</strong> {current.supplierName}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Termo no orçamento:</strong>{' '}
            <code style={{ background: '#fff', padding: '2px 6px' }}>{current.rawTerm}</code>
          </div>
          {(current.quantidade || current.valorUnit) && (
            <div style={{ marginTop: 4, fontSize: 13, color: '#444' }}>
              {current.quantidade != null && <>Qtd: {current.quantidade} · </>}
              {current.valorUnit && <>Valor unit.: {formatBRL(current.valorUnit)}</>}
            </div>
          )}
        </div>

        <input
          autoFocus
          placeholder="Buscar produto da ordem…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
            marginBottom: 8,
          }}
        />

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 12 }}>
          {filteredOptions && filteredOptions.sugeridos.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', margin: '4px 0' }}>
                💡 Sugestões automáticas
              </div>
              {filteredOptions.sugeridos.map((p) => (
                <button
                  key={p.id}
                  onClick={() => resolve(0, p.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: 10,
                    margin: '4px 0',
                    background: '#eef6ff',
                    border: '1px solid #bcd',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <strong>{p.descricao}</strong>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {p.quantidade} {p.unidade}
                  </div>
                </button>
              ))}
            </>
          )}

          {filteredOptions && filteredOptions.outros.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', margin: '12px 0 4px' }}>
                Todos os produtos
              </div>
              {filteredOptions.outros.map((p) => (
                <button
                  key={p.id}
                  onClick={() => resolve(0, p.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: 10,
                    margin: '4px 0',
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <strong>{p.descricao}</strong>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {p.quantidade} {p.unidade}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            onClick={() => resolve(0, '__none__')}
            style={{
              padding: '8px 14px',
              background: '#fff',
              border: '1px solid #c00',
              color: '#c00',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Não corresponde a nada
          </button>
          <button
            onClick={() => skip(0)}
            style={{
              padding: '8px 14px',
              background: '#fff',
              border: '1px solid #888',
              color: '#444',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Pular por enquanto
          </button>
        </div>
      </div>
    </div>
  );
}
