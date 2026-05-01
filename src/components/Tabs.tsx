import type { AppTab } from '@/types';
import { useStore } from '@/store';

interface TabSpec {
  id: AppTab;
  label: string;
  badge?: string;
  badgeKind?: 'normal' | 'warn';
  disabled?: boolean;
}

export function Tabs() {
  const active = useStore((s) => s.activeTab);
  const setTab = useStore((s) => s.setActiveTab);
  const order = useStore((s) => s.order);
  const suppliers = useStore((s) => s.suppliers);

  const pendingReview = suppliers.filter(
    (s) => s.status === 'awaiting_review' || s.status === 'processing' || s.status === 'parsing'
  ).length;
  const allReviewed = suppliers.length > 0 && suppliers.every((s) => s.status === 'reviewed');

  const tabs: TabSpec[] = [
    { id: 'ordem', label: '1. Ordem' },
    {
      id: 'notas',
      label: '2. Notas',
      disabled: !order,
      badge: suppliers.length ? String(suppliers.length) : undefined,
      badgeKind: pendingReview > 0 ? 'warn' : 'normal',
    },
    {
      id: 'comparacao',
      label: '3. Comparação',
      disabled: !allReviewed,
    },
  ];

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={'tab-btn' + (active === t.id ? ' active' : '')}
          disabled={t.disabled}
          onClick={() => !t.disabled && setTab(t.id)}
        >
          {t.label}
          {t.badge && (
            <span className={'tab-badge' + (t.badgeKind === 'warn' ? ' warn' : '')}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
