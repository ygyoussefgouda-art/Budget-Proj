import { CopyPlus, MoreVertical, Pencil } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { CategoryForm, SettingsForm, useRemoveCategory } from '../components/BudgetForms';
import { useOverlay, Sheet } from '../components/Overlays';
import { BudgetAlerts, BudgetRowTile, MonthBar } from '../components/rows';
import { AddButton, Card, COLORS, DeleteButton, Empty, KV, PageHeader, SectionTitle } from '../components/ui';
import type { Category } from '../domain/calc';
import { t } from '../i18n';
import { monthLabel, useApp } from '../state';

/** The "more" menu: opens on tap, closes on a tap outside, on Escape, or after choosing. */
function MoreMenu({ open, setOpen, children }: { open: boolean; setOpen: (v: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, setOpen]);
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('More actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreVertical size={22} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

export default function Budget() {
  const { data, summary: s, fmt, month, refresh } = useApp();
  const { confirm, toast } = useOverlay();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catForm, setCatForm] = useState<{ edit?: Category } | null>(null);
  const [menu, setMenu] = useState(false);
  const removeCategory = useRemoveCategory();
  if (!data || !s) return null;
  const b = data.budget;
  const catRows = s.rows.filter((r) => r.catId !== null);
  const goalRows = s.rows.filter((r) => r.catId === null);

  const copyPrev = async () => {
    setMenu(false);
    const ok = await confirm(
      t('Copy from previous month?'),
      t('This replaces the income, plans and category budgets of {month}.', { month: monthLabel(month) }),
      t('Copy'),
    );
    if (!ok) return;
    try {
      await api(`/budget/${month}/copy-previous`, 'POST');
      await refresh();
      toast(t('Budget copied.'));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  // Empty month: copy without asking (nothing gets replaced).
  const sameAsLast = async () => {
    try {
      await api(`/budget/${month}/copy-previous`, 'POST');
      await refresh();
      toast(t('Budget copied.'));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const clearPlans = async () => {
    setMenu(false);
    const ok = await confirm(
      t('Clear category budgets?'),
      t('Every category budget for {month} will be set to 0.', { month: monthLabel(month) }),
      t('Clear'),
    );
    if (!ok) return;
    try {
      await api(`/budget/${month}/clear-plans`, 'POST');
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('Budget')}
        right={
          <MoreMenu open={menu} setOpen={setMenu}>
            <button role="menuitem" onClick={copyPrev}>
              {t('Copy from previous month')}
            </button>
            <button role="menuitem" onClick={clearPlans}>
              {t('Set category budgets to 0')}
            </button>
          </MoreMenu>
        }
      />
      <MonthBar />
      <BudgetAlerts rows={s.rows} readOnView />

      {data.canCopyPrevious && data.copyFrom && (
        <Card className="copy-card">
          <div className="row gap">
            <CopyPlus size={22} style={{ color: COLORS.accent, flex: 'none' }} aria-hidden="true" />
            <div className="grow">
              <strong className="small block">{t('{month} is empty', { month: monthLabel(month) })}</strong>
              <span className="tiny mute">
                {t('Use the same income, plans and category budgets as {from}.', { from: monthLabel(data.copyFrom) })}
              </span>
            </div>
          </div>
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={sameAsLast}>
            {t('Same as last month')}
          </button>
        </Card>
      )}

      <Card onClick={() => setSettingsOpen(true)}>
        <div className="section-title">
          <h2>{t('Income & plans')}</h2>
          <span className="edit-hint">
            <Pencil size={14} /> {t('Edit')}
          </span>
        </div>
        <KV k={t('Monthly income')} v={fmt(b.income)} />
        <KV k={t('Monthly saving plan')} v={fmt(b.savePlan)} />
        <KV k={t('Monthly loan repayment plan')} v={fmt(b.loanPlan)} />
      </Card>

      <Card>
        <SectionTitle trailing={<AddButton onClick={() => setCatForm({})} title={t('Add a spending category')} />}>
          {t('Spending categories')}
        </SectionTitle>
        {catRows.length === 0 && <Empty text={t('No categories yet. Add your first one.')} />}
        {catRows.map((r) => {
          const cat = data.categories.find((c) => c.id === r.catId);
          return (
            <div key={r.catId} className="cat-row">
              <BudgetRowTile r={r} onClick={() => setCatForm({ edit: cat })} />
              {cat && <DeleteButton label={t('Remove {name}', { name: cat.name })} onClick={() => removeCategory(cat)} />}
            </div>
          );
        })}
        {catRows.length > 0 && <p className="tiny mute">{t('Tap a category to rename it or change its budget.')}</p>}
      </Card>

      <Card>
        <SectionTitle>{t('Savings & loans')}</SectionTitle>
        {goalRows.map((r) => (
          <BudgetRowTile key={r.name} r={r} onClick={() => setSettingsOpen(true)} />
        ))}
      </Card>

      <Card>
        <KV k={t('Planned total')} v={fmt(s.plannedTotal)} />
        <KV k={t('Spent, saved & repaid')} v={fmt(s.actualTotal)} />
        <KV k={t('Unallocated income')} v={fmt(s.unallocated)} color={s.unallocated < 0 ? COLORS.red : undefined} />
        <hr />
        <KV k={t('Money left')} v={fmt(s.moneyLeft)} color={s.moneyLeft < 0 ? COLORS.red : COLORS.accent} bold />
      </Card>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={`${t('Income & plans')} · ${monthLabel(month)}`}>
        {settingsOpen && <SettingsForm onDone={() => setSettingsOpen(false)} />}
      </Sheet>
      <Sheet open={!!catForm} onClose={() => setCatForm(null)} title={catForm?.edit ? t('Edit category') : t('New category')}>
        {catForm && <CategoryForm edit={catForm.edit} onDone={() => setCatForm(null)} />}
      </Sheet>
    </div>
  );
}
