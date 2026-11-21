import { useCallback } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../state';
import { useOverlay } from './Overlays';

/**
 * Delete right away, then offer "Undo" for a few seconds (no "Are you sure?" first).
 * Used for single entries: expenses, savings entries and loan entries. The server keeps the
 * deleted item (with its receipt) in a trash for a short time so Undo can bring it back.
 * Returns true when the delete went through.
 */
export function useUndoDelete() {
  const { refresh } = useApp();
  const { toast, toastAction } = useOverlay();

  return useCallback(
    async (path: string): Promise<boolean> => {
      let undoId: number;
      try {
        undoId = (await api<{ undo: number }>(path, 'DELETE')).undo;
      } catch (e) {
        toast((e as Error).message);
        return false;
      }
      await refresh();
      toastAction(t('Deleted'), {
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
