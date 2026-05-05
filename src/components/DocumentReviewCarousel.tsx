import { useEffect } from 'react';
import Decimal from 'decimal.js';
import { useStore } from '@/store';
import type { SupplierLineItem, SupplierQuote } from '@/types';
import { formatBRL } from '@/lib/utils';
import { Loader } from '@/components/Loader';
import { SearchableSelect } from '@/components/SearchableSelect';

const STATUS_BADGE: Record<string, string> = {
  parsing: 'Parseando…',
  classifying: 'Classificando com LLM…',
  processing: 'Correlacionando com LLM…',
  awaiting_review: 'Aguardando revisão',
  reviewed: 'Revisado',
  error: 'Erro',
};

export function DocumentReviewCarousel() {
  const open = useStore((s) => s.reviewOpen);
  const close = useStore((s) => s.closeReview);
  const setIndex = useStore((s) => s.setReviewIndex);
  const idx = useStore((s) => s.reviewIndex);
  const suppliers = useStore((s) => s.suppliers);
  const order = useStore((s) => s.order);
  const resolveItem = useStore((s) => s.resolveItem);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const allReviewed = suppliers.length > 0 && suppliers.every((s) => s.status === 'reviewed');
  const current = suppliers[idx];

  // Esc fecha; setas alternam slide
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, idx - 1));
      else if (e.key === 'ArrowRight') setIndex(Math.min(suppliers.length - 1, idx + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, suppliers.length, setIndex, close]);

  if (!open || !order || !current) return null;

  const goCompare = () => {
    close();
    setActiveTab('comparacao');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3 className="modal-title">📄 {current.supplierName}</h3>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {current.fileName} · slide {idx + 1} de {suppliers.length}
            </div>
          </div>
          <button className="btn-ghost" onClick={close} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <SlideContent supplier={current} />
        </div>

        <div className="modal-foot">
          <button
            className="btn"
            disabled={idx === 0}
            onClick={() => setIndex(Math.max(0, idx - 1))}
          >
            ← Anterior
          </button>

          <div className="slider-dots">
            {suppliers.map((s, i) => {
              const cls =
                s.status === 'reviewed'
                  ? 'dot dot-ok'
                  : s.status === 'awaiting_review'
                  ? 'dot dot-warn'
                  : 'dot';
              return (
                <button
                  key={s.id}
                  className={cls + (i === idx ? ' active' : '')}
                  onClick={() => setIndex(i)}
                  aria-label={`Ir para ${s.supplierName}`}
                  title={s.supplierName}
                />
              );
            })}
          </div>

          {idx < suppliers.length - 1 ? (
            <button
              className="btn btn-primary"
              onClick={() => setIndex(idx + 1)}
            >
              Próximo →
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!allReviewed}
              onClick={goCompare}
              title={
                allReviewed
                  ? 'Todos resolvidos — abrir comparação'
                  : 'Resolva todos os itens não identificados de cada documento'
              }
            >
              {allReviewed ? 'Ver comparação →' : 'Faltam itens…'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- conteúdo por slide ---- */

function SlideContent({ supplier }: { supplier: SupplierQuote }) {
  const order = useStore((s) => s.order)!;
  const resolveItem = useStore((s) => s.resolveItem);

  if (
    supplier.status === 'parsing' ||
    supplier.status === 'classifying' ||
    supplier.status === 'processing'
  ) {
    const label =
      supplier.status === 'parsing'
        ? 'Lendo o arquivo…'
        : supplier.status === 'classifying'
        ? 'Classificando colunas e unidades com a LLM…'
        : 'Correlacionando produtos com a ordem (LLM em batch)…';
    return <Loader large label={label} />;
  }

  if (supplier.status === 'error') {
    return (
      <div className="banner-error" style={{ marginBottom: 0 }}>
        <span>{supplier.errorMessage || 'Erro ao processar este documento.'}</span>
      </div>
    );
  }

  const identified = supplier.items.filter((i) => i.matchedProductId);
  const unidentified = supplier.items.filter((i) => !i.matchedProductId);

  return (
    <div className="stack">
      <div className="hstack" style={{ flexWrap: 'wrap' }}>
        <span className={`badge ${supplier.status}`}>
          {STATUS_BADGE[supplier.status]}
        </span>
        <span className="muted">
          {identified.length}/{supplier.items.length} identificados
        </span>
      </div>

      {/* Itens classificados — visão completa do que a LLM extraiu */}
      {supplier.items.length > 0 && (
        <ClassifiedItemsCollapse supplier={supplier} />
      )}

      {/* Não identificados — aberto */}
      {unidentified.length > 0 && (
        <details className="collapse warn" open>
          <summary>
            ⚠️ Não identificados ({unidentified.length}) — escolha o produto correspondente
          </summary>
          <div className="collapse-body">
            {unidentified.map((it) => (
              <div key={it.id} className="ss-row">
                <div className="ss-info">
                  <div className="term">
                    {it.rawTerm}
                    {it.isPromocao && (
                      <span style={{ marginLeft: 6, color: 'var(--c-warn)', fontWeight: 600 }}>
                        (P)
                      </span>
                    )}
                  </div>
                  <div className="meta">
                    {it.quantidade != null && (
                      <>
                        Qtd: {it.quantidade}
                        {it.unidadeHumana ? ' ' + it.unidadeHumana : ''} ·{' '}
                      </>
                    )}
                    {it.valorUnit && <>V. unit.: {formatBRL(it.valorUnit)}</>}
                  </div>
                </div>
                <SearchableSelect
                  catalog={order.items}
                  selectedId={null}
                  onChange={(productId) =>
                    resolveItem(supplier.id, it.id, productId)
                  }
                />
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Identificados — fechado */}
      {identified.length > 0 && (
        <details className={'collapse' + (unidentified.length === 0 ? ' ok' : '')}>
          <summary>
            ✅ Identificados ({identified.length}) — por cache humano ou LLM
          </summary>
          <div className="collapse-body">
            {identified.map((it) => (
              <IdentifiedRow
                key={it.id}
                item={it}
                supplierId={supplier.id}
              />
            ))}
          </div>
        </details>
      )}

      {supplier.items.length === 0 && (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
          Nenhum item extraído deste documento.
        </div>
      )}
    </div>
  );
}

function ClassifiedItemsCollapse({ supplier }: { supplier: SupplierQuote }) {
  const total = supplier.items.reduce((acc, it) => {
    if (!it.valorTotal) return acc;
    try {
      return acc.plus(new Decimal(it.valorTotal));
    } catch {
      return acc;
    }
  }, new Decimal(0));
  const hasPromo = supplier.items.some((it) => it.isPromocao);

  return (
    <details className="collapse" open>
      <summary>
        📋 Itens classificados ({supplier.items.length}) — total {formatBRL(total)}
      </summary>
      <div className="collapse-body" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th>Produto</th>
              <th className="right">Qtd</th>
              <th className="right">Valor unit. (R$)</th>
            </tr>
          </thead>
          <tbody>
            {supplier.items.map((it, i) => {
              const qty =
                (it.quantidade ?? '—') +
                (it.unidadeHumana ? ' ' + it.unidadeHumana : '');
              return (
                <tr key={it.id}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    {it.rawTerm}
                    {it.isPromocao && (
                      <span
                        style={{ marginLeft: 6, color: 'var(--c-warn)', fontWeight: 600 }}
                        title="Promoção"
                      >
                        (P)
                      </span>
                    )}
                  </td>
                  <td className="right">{qty}</td>
                  <td className="right">
                    {it.valorUnit
                      ? new Decimal(it.valorUnit).toFixed(2).replace('.', ',')
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--c-border)', fontWeight: 700 }}>
              <td colSpan={3}>Total Geral</td>
              <td className="right">{formatBRL(total)}</td>
            </tr>
          </tfoot>
        </table>
        {hasPromo && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            (P) = produtos com preço promocional
          </div>
        )}
      </div>
    </details>
  );
}

function IdentifiedRow({
  item,
  supplierId,
}: {
  item: SupplierLineItem;
  supplierId: string;
}) {
  const order = useStore((s) => s.order)!;
  const resolveItem = useStore((s) => s.resolveItem);
  const product = order.items.find((p) => p.id === item.matchedProductId);
  if (!product) return null;

  return (
    <div className="id-row">
      <div>
        <div style={{ fontWeight: 600 }}>{product.descricao}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          ↳ termo no orçamento: <code>{item.rawTerm}</code>
        </div>
      </div>
      <div className="src">{sourceLabel(item.matchSource)}</div>
      <div className="hstack" style={{ gap: 6 }}>
        <span className="price">
          {item.valorUnit ? formatBRL(item.valorUnit) : '—'}
        </span>
        <button
          className="btn-ghost"
          onClick={() => resolveItem(supplierId, item.id, '__none__')}
          title="Marcar como não identificado"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

function sourceLabel(s: SupplierLineItem['matchSource']): string {
  switch (s) {
    case 'cache': return '💾 cache (humano)';
    case 'llm': return '🤖 LLM';
    case 'manual': return '✋ manual';
    default: return '';
  }
}
