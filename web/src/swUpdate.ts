import { useSyncExternalStore } from 'react';
import { APP_VERSION } from './version';

/**
 * Service worker updates without surprises: a new version installs in the background and waits.
 * The app shows "New version ready" and only switches when the user taps Reload
 * (then sw.js gets SKIP_WAITING, takes over, and the page reloads once).
 */
let waiting: ServiceWorker | null = null;
/** The server runs a different version than this page (e.g. a release that didn't change sw.js). */
let serverNewer = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setWaiting(w: ServiceWorker | null) {
  waiting = w;
  emit();
}

function track(reg: ServiceWorkerRegistration) {
  // Only an *update* waits; the very first install has no page to replace.
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) setWaiting(w);
    });
  });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when the user asked for the new version (not on the first install).
    if (reloading || !applying) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        track(reg);
        // Look for a new version when the app comes back to the screen, and every 30 minutes.
        const check = () => {
          reg.update().catch(() => undefined);
          checkServerVersion();
        };
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        setInterval(check, 30 * 60_000);
      })
      .catch(() => undefined);
  });
}

/** "0.6.10" is newer than "0.6.9" (compares number by number). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Asks GET /api/version which web version the server has now. */
export async function checkServerVersion() {
  try {
    const res = await fetch('/api/version', { credentials: 'same-origin' });
    if (!res.ok) return;
    const v = (await res.json()) as { web?: string };
    // Only a *newer* server version means "reload": an older one (rollback) or a mismatch can't be fixed by reloading.
    if (v.web && isNewer(v.web, APP_VERSION) && !serverNewer) {
      serverNewer = true;
      emit();
    }
  } catch {
    // offline: try again next time
  }
}

let applying = false;
/** User tapped Reload: let the waiting version take over (the page reloads on controllerchange). */
export function applyUpdate() {
  if (!waiting) return window.location.reload();
  applying = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // Safety net if the switch doesn't happen (old worker that ignores the message).
  setTimeout(() => window.location.reload(), 4000);
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => waiting !== null || serverNewer,
  );
}
