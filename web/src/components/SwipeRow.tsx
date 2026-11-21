import { Pencil, Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { SWIPE_TRIGGER, swipeAction } from '../domain/gestures';
import { t } from '../i18n';

const MAX = 140;

const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms); // light haptic tap where the phone supports it
  } catch {
    /* not supported */
  }
};

/**
 * A list row you can swipe: one way to delete, the other way to edit. Only touch/mouse drags:
 * the row's own buttons stay for keyboard and screen-reader users. Vertical scrolling is untouched.
 */
export function SwipeRow({ children, onDelete, onEdit, className = '' }: { children: ReactNode; onDelete: () => void; onEdit: () => void; className?: string }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; lock: 'h' | 'v' | null } | null>(null);
  const armed = useRef(false);
  const moved = useRef(false);
  const rtl = () => document.documentElement.dir === 'rtl';

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, lock: null };
    moved.current = false;
    armed.current = false;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy)) {
        s.lock = 'h';
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } else if (Math.abs(ddy) > 10) {
        start.current = null; // a scroll, not a swipe
        return;
      } else return;
    }
    moved.current = true;
    const v = Math.max(-MAX, Math.min(MAX, ddx));
    setDx(v);
    const over = Math.abs(v) >= SWIPE_TRIGGER;
    if (over !== armed.current) {
      armed.current = over;
      if (over) buzz(10);
    }
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || s.lock !== 'h') return;
    const action = swipeAction(dx, rtl());
    setDx(0);
    if (action) {
      buzz(15);
      if (action === 'delete') onDelete();
      else onEdit();
    }
  };

  const dir = dx === 0 ? '' : swipeAction(dx < 0 ? -MAX : MAX, rtl());
  return (
    <div className={`swipe ${dir ? `is-${dir}` : ''}`}>
      <div className="swipe-under" aria-hidden="true">
        <span className="swipe-edit">
          <Pencil size={18} /> {t('Edit')}
        </span>
        <span className="swipe-delete">
          <Trash2 size={18} /> {t('Delete')}
        </span>
      </div>
      <div
        className={`swipe-front ${className}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => {
          // A swipe that ends on the row must not also count as a tap on it.
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
