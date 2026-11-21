import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ConfirmFn } from '../api';
import { t } from '../i18n';

// ---------- bottom sheet ----------

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------- confirm dialog + toast ----------

interface DialogState { title: string; message: string; action: string; resolve: (v: boolean) => void }
interface ToastAction { label: string; run: () => void }
interface OverlayCtx {
  confirm: ConfirmFn;
  toast: (m: string) => void;
  /** A toast with one button (e.g. "Deleted · Undo"), shown for ms milliseconds. */
  toastAction: (m: string, action: ToastAction, ms?: number) => void;
}
const Ctx = createContext<OverlayCtx | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; action?: ToastAction }[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback<ConfirmFn>(
    (title, message, action = t('Delete')) => new Promise<boolean>((resolve) => setDialog({ title, message, action, resolve })),
    [],
  );
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, text }]);
      setTimeout(() => dismiss(id), 3500);
    },
    [dismiss],
  );
  const toastAction = useCallback(
    (text: string, action: ToastAction, ms = 6000) => {
      const id = nextId.current++;
      // Only the newest undo toast is kept, so a run of deletes doesn't stack up the screen.
      setToasts((t) => [...t.filter((x) => !x.action), { id, text, action }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };
  const destructive = /delete|remove|erase|clear|restore|حذف|إزالة|مسح|استعادة|تصفير/i.test(dialog?.action ?? '');

  return (
    <Ctx.Provider value={{ confirm, toast, toastAction }}>
      {children}
      {dialog &&
        createPortal(
          <div className="backdrop center" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
            <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
              <h3 id="dlg-title">{dialog.title}</h3>
              <p>{dialog.message}</p>
              <div className="dialog-actions">
                <button className="btn ghost" onClick={() => close(false)}>
                  {t('Cancel')}
                </button>
                <button className={`btn ${destructive ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
                  {dialog.action}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((x) => (
            <div key={x.id} className={`toast${x.action ? ' with-action' : ''}`}>
              <span>{x.text}</span>
              {x.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    dismiss(x.id);
                    x.action!.run();
                  }}
                >
                  {x.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useOverlay() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOverlay outside provider');
  return v;
}
