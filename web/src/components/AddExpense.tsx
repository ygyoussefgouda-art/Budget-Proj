import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { ExpenseForm } from '../pages/Expenses';
import { Sheet } from './Overlays';

/**
 * 2.4.0 (critique: "Quick add" and "Add expense" were two different sheets, and the centre + jumped to
 * Home): one Add expense sheet for the whole app, opened in place on whatever tab is showing.
 */
const Ctx = createContext<() => void>(() => {});

export function AddExpenseProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Add expense')}>
        {open && <ExpenseForm quick onDone={() => setOpen(false)} />}
      </Sheet>
    </Ctx.Provider>
  );
}

/** Opens the Add expense sheet. */
export const useAddExpense = () => useContext(Ctx);
