import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { haptic } from '../native';

/** How far to pull (px) before letting go refreshes. */
export const PULL_TRIGGER = 70;

/**
 * Pull down at the top of a page to load everything again (like most phone apps). Touch only;
 * ignored while a sheet or dialog is open, while scrolled down, or for sideways swipes.
 */
export default function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const run = useRef(onRefresh);
  run.current = onRefresh;
  const busyRef = useRef(false);

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let dist = 0;
    const blocked = () => !!document.querySelector('[aria-modal="true"]'); // a sheet, dialog, lock screen...
    const onStart = (e: TouchEvent) => {
      start = window.scrollY <= 0 && !busyRef.current && !blocked() && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = Math.abs(e.touches[0].clientX - start.x);
      if (dx > Math.abs(dy) || window.scrollY > 0) {
        start = null; // a sideways swipe (rows) or the page scrolled: not a pull
        setPull(0);
        return;
      }
      dist = dy;
      setPull(dy > 0 ? Math.min(dy, 130) : 0);
    };
    const onEnd = async () => {
      if (!start) return;
      start = null;
      setPull(0);
      if (dist < PULL_TRIGGER) return;
      busyRef.current = true;
      setBusy(true);
      haptic();
      try {
        await run.current();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (!pull && !busy) return null;
  const ready = pull >= PULL_TRIGGER;
  return (
    <div
      className={`ptr ${busy ? 'spinning' : ''}`}
      role="status"
      aria-label={busy ? t('Refreshing') : ready ? t('Let go to refresh') : t('Pull down to refresh')}
      style={{ opacity: busy ? 1 : Math.min(1, pull / PULL_TRIGGER), transform: `translateY(${busy ? 24 : pull / 2.2}px)` }}
    >
      <RefreshCw size={18} style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
    </div>
  );
}
