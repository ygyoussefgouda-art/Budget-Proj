import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ConfirmFn } from '../api';
import { t } from '../i18n';

// ---------- focus handling shared by sheets and dialogs ----------

/** Open layers, newest last: only the top one reacts to Escape and Tab. */
const layers: symbol[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard and screen-reader friendly layer: moves focus inside when it opens, keeps Tab inside,
 * Escape closes only the top layer, and focus goes back to where it was when it closes.
 */
function useLayer(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const me = Symbol('layer');
    layers.push(me);
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus the element marked autoFocus, else the first field/button, else the layer itself.
    // (A field that used React's autoFocus already has focus: leave it there.)
    if (!el?.contains(document.activeElement)) {
      // Focus the layer itself (not the first input: that would pop up the phone keyboard).
      (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (layers[layers.length - 1] !== me || !el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        escape.current();
      } else if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const [a, z] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      layers.splice(layers.indexOf(me), 1);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

// ---------- bottom sheet ----------

/** Pulled down this far (px), or flicked faster than this (px/ms), the sheet closes. */
const SHEET_CLOSE_PX = 90;
const SHEET_CLOSE_SPEED = 0.6;

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, open, onClose);
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, [open]);

  // 2.4.1 (owner: "I can't pull the tab"): the handle and title drag the sheet down, like a phone's own
  // sheets. It follows the finger; far enough or a quick flick closes it, otherwise it springs back.
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number; moved: boolean; onHandle: boolean } | null>(null);
  useEffect(() => {
    if (!open) setDy(0);
  }, [open]);
  const onDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { y: e.clientY, t: performance.now(), moved: false, onHandle: !!(e.target as HTMLElement).closest('.sheet-handle') };
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep following the finger outside the handle
    } catch {
      /* not a real pointer (tests): moves still arrive while over the handle */
    }
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dist = e.clientY - d.y;
    if (Math.abs(dist) > 4) d.moved = true;
    setDy(Math.max(0, dist));
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dist = Math.max(0, e.clientY - d.y);
    const speed = dist / Math.max(1, performance.now() - d.t);
    // A tap (no movement) on the handle closes as well.
    if (dist > SHEET_CLOSE_PX || (d.moved && speed > SHEET_CLOSE_SPEED) || (!d.moved && d.onHandle)) onClose();
    else setDy(0);
  };
  const onCancel = () => {
    drag.current = null;
    setDy(0);
  };

  if (!open) return null;
  const dragging = drag.current !== null;
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={dy ? { opacity: Math.max(0.35, 1 - dy / 400) } : undefined}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={dy || dragging ? { transform: `translateY(${dy}px)`, transition: dragging ? 'none' : undefined } : undefined}
      >
        <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
          {/* The handle is the sheet's visible, labelled close control: tap, drag down, or Enter. */}
          <button
            type="button"
            className="sheet-handle"
            aria-label={t('Close')}
            // Pointer taps are handled above; this is the keyboard (Enter / Space).
            onClick={(e) => {
              if (e.detail === 0) onClose();
            }}
          />
          <h2 className="sheet-title">{title}</h2>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------- confirm dialog + toast ----------

interface DialogState {
  title: string;
  message: string;
  action: string;
  /** Ask for the account password too (big, irreversible actions). */
  password?: boolean;
  /** 2.6.0: a safe step offered inside the dialog (e.g. "Download backup first"); runs without closing it. */
  extra?: DialogExtra;
  resolve: (v: string | false) => void;
}
export interface DialogExtra { label: string; icon?: ReactNode; run: () => void | Promise<void> }
interface ToastAction { label: string; run: () => void }
/** Like confirm, but the user must also type their password. Resolves to the password, or null if cancelled. */
export type ConfirmPasswordFn = (title: string, message: string, action: string, extra?: DialogExtra) => Promise<string | null>;
interface OverlayCtx {
  confirm: ConfirmFn;
  confirmPassword: ConfirmPasswordFn;
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
    (title, message, action = t('Delete')) =>
      new Promise<boolean>((resolve) => setDialog({ title, message, action, resolve: (v) => resolve(v !== false) })),
    [],
  );
  const confirmPassword = useCallback<ConfirmPasswordFn>(
    (title, message, action, extra) =>
      new Promise<string | null>((resolve) => setDialog({ title, message, action, password: true, extra, resolve: (v) => resolve(v === false ? null : v) })),
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

  const close = (v: string | false) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ confirm, confirmPassword, toast, toastAction }}>
      {children}
      {dialog && createPortal(<Dialog d={dialog} close={close} />, document.body)}
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

function Dialog({ d, close }: { d: DialogState; close: (v: string | false) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [password, setPassword] = useState('');
  const [extraBusy, setExtraBusy] = useState(false);
  const runExtra = async () => {
    setExtraBusy(true);
    try {
      await d.extra?.run();
    } finally {
      setExtraBusy(false);
    }
  };
  useLayer(ref, true, () => close(false));
  const destructive = /delete|remove|erase|clear|restore|حذف|إزالة|مسح|امسح|استعادة|استرجع|تصفير/i.test(d.action);
  return (
    <div className="backdrop center" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <form
        ref={ref as unknown as RefObject<HTMLFormElement>}
        className="dialog"
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-msg"
        onSubmit={(e) => {
          e.preventDefault();
          if (d.password && !password) return;
          close(d.password ? password : 'ok');
        }}
      >
        <h3 id="dlg-title">{d.title}</h3>
        <p id="dlg-msg">{d.message}</p>
        {d.extra && (
          <button type="button" className="btn tonal block dialog-extra" disabled={extraBusy} onClick={runExtra}>
            {d.extra.icon} {d.extra.label}
          </button>
        )}
        {d.password && (
          <label className="field">
            <span className="field-label">{t('Your password')}</span>
            <input
              className="input"
              dir="ltr"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-autofocus
            />
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={() => close(false)}>
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className={`btn ${destructive ? 'danger' : 'primary'}`}
            disabled={d.password && !password}
            {...(d.password ? {} : { 'data-autofocus': true })}
          >
            {d.action}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useOverlay() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOverlay outside provider');
  return v;
}
