import { useCallback } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../state';
import { useOverlay } from './Overlays';

/**
 * Delete right away, then offer "Undo" for a few seconds (no "Are you sure?" first).
 * Used for expenses, savings entries, loan entries, whole savings goals and whole people in Loans.
 * The server keeps the deleted item (with its receipt or entries) in a trash for a short time so
 * Undo can bring it back. `message` replaces the plain "Deleted". Returns true when the delete went through.
 */
export function useUndoDelete() {
  const { refresh } = useApp();
  const { toast, toastAction } = useOverlay();

  return useCallback(
    async (path: string, message?: string): Promise<boolean> => {
      let undoId: number;
      try {
        undoId = (await api<{ undo: number }>(path, 'DELETE')).undo;
      } catch (e) {
        toast((e as Error).message);
        return false;
      }
      await refresh();
      toastAction(message ?? t('Deleted'), {
        label: t('Undo'),
        run: async () => {
          try {
            await api(`/undo/${undoId}`, 'POST');
            await refresh();
            toast(t('Brought back.'));
          } catch (e) {
            toast((e as Error).message);
          }
        },
      });
      return true;
    },
    [refresh, toast, toastAction],
  );
}
