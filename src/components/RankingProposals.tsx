import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store';
import { rankProposals, generateRankingJustifications } from '@/pricing/ranker';
import type { RankedProposal } from '@/types';
import { formatBRL } from '@/lib/utils';

/**
 * Tela 3 — Ranking de Propostas (cards verticais).
 * Cálculo em JS puro; IA só preenche a justificativa textual.
 * Ver PLANO_PICA.md §7.3.
 */

export function RankingProposals() {
  const order = useStore((s) => s.order);
  const suppliers = useStore((s) => s.suppliers);

  const baseRanking = useMemo(() => {
    if (!order || suppliers.length === 0) return [];
    return rankProposals(order, suppliers);
  }, [order, suppliers]);

  const [ranking, setRanking] = useState<RankedProposal[]>(baseRanking);
  const [loadingJustify, setLoadingJustify] = useState(false);
  const [justifyError, setJustifyError] = useState<string | null>(null);

  // hash para detectar mudança real no ranking (evitar reprocessar à toa)
  const rankingHash = useMemo(
    () => baseRanking.map((r) => `${r.supplierId}:${r.total}:${r.cobertura}`).join('|'),
    [baseRanking]
  );

  useEffect(() => {
    setRanking(baseRanking);
  }, [baseRanking]);

  useEffect(() => {
    let cancelled = false;
    if (baseRanking.length === 0) return;
    setLoadingJustify(true);
    setJustifyError(null);
    generateRankingJustifications(baseRanking)
      .then((justs) => {
        if (cancelled) return;
        setRanking((prev) =>
          prev.map((r, i) => ({ ...r, justificativa_ia: justs[i] ?? '' }))
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setJustifyError((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingJustify(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rankingHash]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order || suppliers.length === 0) {
    return (
      <div className="muted" style={{ padding: 24 }}>
        Carregue a ordem e os orçamentos para ver o ranking.
      </div>
    );
  }

  const allReviewed = suppliers.every((s) => s.status === 'reviewed');

  const handleRecalc = () => {
    const fresh = order ? rankProposals(order, suppliers) : [];
    setRanking(fresh);
    setLoadingJustify(true);
    setJustifyError(null);
    generateRankingJustifications(fresh)
      .then((justs) => {
        setRanking((prev) =>
          prev.map((r, i) => ({ ...r, justificativa_ia: justs[i] ?? '' }))
        );
      })
      .catch((e: unknown) => setJustifyError((e as Error).message))
      .finally(() => setLoadingJustify(false));
  };

  return (
    <div className="stack">
      {!allReviewed && (
        <div className="banner-warn">
          ⚠️ Há itens não revisados. O ranking abaixo pode estar incompleto.
        </div>
      )}

      <div className="hstack" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Ranking de Propostas</h2>
        <span className="spacer" />
        <button className="btn" onClick={handleRecalc} disabled={loadingJustify}>
          {loadingJustify ? 'recalculando…' : '↻ recalcular'}
        </button>
      </div>

      {justifyError && (
        <div className="banner-warn">
          ⚠️ Erro na justificativa: {justifyError}. Mostrando texto-padrão.
        </div>
      )}

      <div className="stack" style={{ gap: 12 }}>
        {ranking.map((r) => (
          <RankingCard key={r.supplierId} item={r} />
        ))}
      </div>
    </div>
  );
}

function RankingCard({ item }: { item: RankedProposal }) {
  const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`;
  const coberturaPct = (item.cobertura * 100).toFixed(0) + '%';
  const deltaPct = (item.delta_vs_melhor_pct * 100).toFixed(1).replace('.', ',') + '%';

  return (
    <div
      className="card"
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 16,
        background: item.rank === 1 ? 'var(--c-best-bg, #f0fdf4)' : 'var(--c-bg)',
      }}
    >
      <div className="hstack" style={{ alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{medal}</span>
        <h3 style={{ margin: 0 }}>{item.supplierName}</h3>
      </div>

      <div className="hstack" style={{ marginTop: 8, gap: 24, flexWrap: 'wrap' }}>
        <Metric label="Total" value={formatBRL(item.total)} strong />
        <Metric
          label="Cobertura"
          value={`${item.itens_cobertos}/${item.itens_total_master} (${coberturaPct})`}
        />
        {item.rank === 1 ? (
          <Metric label="Delta vs. melhor" value="— (referência)" />
        ) : (
          <Metric
            label="Delta vs. melhor"
            value={`+ ${formatBRL(item.delta_vs_melhor)} (+${deltaPct})`}
            warn
          />
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px dashed var(--c-border)',
          color: 'var(--c-text)',
          lineHeight: 1.5,
        }}
      >
        {item.justificativa_ia || <span className="muted">Carregando justificativa…</span>}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  strong,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div
        style={{
          fontWeight: strong ? 700 : 500,
          fontSize: strong ? 18 : 14,
          color: warn ? 'var(--c-warn)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
