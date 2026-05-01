import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrderItem } from '@/types';
import { normalizar } from '@/matching/normalize';

interface SearchableSelectProps {
  catalog: OrderItem[];
  selectedId: string | null;
  /** IDs sugeridos (ranking de fuzzy/llm) — aparecem destacados no topo */
  suggestedIds?: string[];
  placeholder?: string;
  onChange: (productId: string | '__none__') => void;
}

export function SearchableSelect({
  catalog,
  selectedId,
  suggestedIds = [],
  placeholder = 'Digite para filtrar produto da ordem…',
  onChange,
}: SearchableSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = catalog.find((c) => c.id === selectedId) ?? null;

  const { sugeridos, outros } = useMemo(() => {
    const qNorm = normalizar(query);
    const tokens = qNorm.split(' ').filter(Boolean);
    const matches = (p: OrderItem) =>
      !tokens.length || tokens.every((tok) => p.descricaoNormalizada.includes(tok));

    const sugSet = new Set(suggestedIds);
    const sug = catalog.filter((p) => sugSet.has(p.id) && matches(p));
    const out = catalog.filter((p) => !sugSet.has(p.id) && matches(p));
    return { sugeridos: sug, outros: out };
  }, [catalog, suggestedIds, query]);

  const flat = useMemo(() => [...sugeridos, ...outros], [sugeridos, outros]);

  useEffect(() => setHighlight(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && flat[highlight]) {
        e.preventDefault();
        choose(flat[highlight].id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="ss-control" ref={wrapRef}>
      <input
        className="ss-input"
        placeholder={selected ? selected.descricao : placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {selected && !query && (
        <button
          type="button"
          className="ss-clear"
          onClick={() => onChange('__none__')}
          title="Remover atribuição"
        >
          Limpar atribuição "{selected.descricao}"
        </button>
      )}
      {open && (
        <div className="ss-popover" role="listbox">
          {sugeridos.length > 0 && (
            <>
              <div className="ss-section-label">Sugestões automáticas</div>
              {sugeridos.map((p, i) => (
                <Option
                  key={p.id}
                  product={p}
                  highlighted={i === highlight}
                  onClick={() => choose(p.id)}
                />
              ))}
            </>
          )}
          {outros.length > 0 && (
            <>
              <div className="ss-section-label">Todos os produtos</div>
              {outros.map((p, i) => (
                <Option
                  key={p.id}
                  product={p}
                  highlighted={sugeridos.length + i === highlight}
                  onClick={() => choose(p.id)}
                />
              ))}
            </>
          )}
          {flat.length === 0 && (
            <div className="ss-empty">Nenhum produto da ordem corresponde a "{query}"</div>
          )}
        </div>
      )}
    </div>
  );
}

function Option({
  product,
  highlighted,
  onClick,
}: {
  product: OrderItem;
  highlighted: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={'ss-option' + (highlighted ? ' highlighted' : '')}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <div>{product.descricao}</div>
      <div className="opt-meta">
        {product.quantidade} {product.unidade}
      </div>
    </div>
  );
}
