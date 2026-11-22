import { useSyncExternalStore } from 'react';
import { BudgetNative, isNative } from './native';

/** What GET /api/app/android/latest returns (docs/ANDROID_SELF_UPDATE.md). */
export interface AndroidRelease {
  versionCode: number;
  versionName: string;
  minVersionCode: number;
  mandatory: boolean;
  size: number;
  sha256: string;
  releasedAt?: string;
  notes: { en: string[]; ar: string[] };
  downloadUrl: string;
}

export type UpdateNeed = 'none' | 'optional' | 'required';

/**
 * Is there something to install, and must it be installed before the app can be used?
 * Required when this app is older than the release's minVersionCode, the server's
 * minNativeVersionCode (GET /api/version), or the release is marked mandatory.
 */
export function updateNeed(installed: number, r: AndroidRelease | null, serverMin = 0): UpdateNeed {
  if (!r || r.versionCode <= installed) return installed < serverMin ? 'required' : 'none';
  if (r.mandatory || installed < r.minVersionCode || installed < serverMin) return 'required';
  return 'optional';
}

/** Check at most every 6 hours on launch (Settings → "Check for updates" always checks). */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const dueForCheck = (last: number, now: number) => !last || now - last >= CHECK_EVERY_MS || now < last;

const LAST_CHECK = 'bm-update-last-check';
const readLast = () => {
  try {
    return Number(localStorage.getItem(LAST_CHECK) ?? 0);
  } catch {
    return 0;
  }
};

export interface UpdateState {
  status: 'idle' | 'checking' | 'ready' | 'needs-permission' | 'downloading' | 'installing' | 'error';
  need: UpdateNeed;
  release: AndroidRelease | null;
  installed: { versionCode: number; versionName: string } | null;
  progress: number; // 0..1, while downloading
  error: string | null;
  lastCheck: number;
}

let state: UpdateState = { status: 'idle', need: 'none', release: null, installed: null, progress: 0, error: null, lastCheck: readLast() };
const listeners = new Set<() => void>();
const set = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Asks the server for the newest Android app. force = ignore the 6-hour pause. */
export async function checkForUpdate(force = false): Promise<void> {
  if (!isNative()) return;
  const now = Date.now();
  if (!force && !dueForCheck(state.lastCheck, now) && state.release) return;
  set({ status: 'checking', error: null });
  try {
    const installed = state.installed ?? (await BudgetNative.getInstalledVersion());
    const [rel, ver] = await Promise.all([
      fetch('/api/app/android/latest', { credentials: 'same-origin' }),
      fetch('/api/version', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    const release = rel.ok ? ((await rel.json()) as AndroidRelease) : null;
    const serverMin = Number((ver as { minNativeVersionCode?: number }).minNativeVersionCode ?? 0);
    try {
      localStorage.setItem(LAST_CHECK, String(now));
    } catch {
      /* private mode */
    }
    set({ status: 'idle', installed, release, need: updateNeed(installed.versionCode, release, serverMin), lastCheck: now });
  } catch {
    set({ status: 'error', error: 'offline' });
  }
}

/**
 * Update button: make sure the app may install updates ("Install unknown apps" for Masrofy),
 * download with progress, check it (the native side verifies size, SHA-256, package and version),
 * then open Android's installer. Data, sign-in and PIN stay: same package, same signing key.
 */
export async function startUpdate(): Promise<void> {
  const r = state.release;
  if (!r || !isNative()) return;
  if (!(await BudgetNative.canInstall()).value) {
    set({ status: 'needs-permission' });
    await BudgetNative.openInstallSettings();
    return; // continueAfterPermission() runs when the app comes back
  }
  set({ status: 'downloading', progress: 0, error: null });
  const sub = await BudgetNative.addListener('downloadProgress', (p) => set({ progress: p.total > 0 ? p.received / p.total : 0 }));
  try {
    const url = new URL(r.downloadUrl, window.location.origin).href;
    const file = await BudgetNative.download({ url, sha256: r.sha256, size: r.size });
    set({ status: 'installing', progress: 1 });
    await BudgetNative.install({ path: file.path });
    set({ status: 'ready' });
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'network';
    set({ status: 'error', error: code === 'cancelled' ? null : code });
  } finally {
    await sub.remove();
  }
}

/** Back from Android settings: if installing is now allowed, carry on with the update. */
export async function continueAfterPermission(): Promise<void> {
  if (state.status !== 'needs-permission') return;
  if ((await BudgetNative.canInstall()).value) await startUpdate();
  else set({ status: 'idle' });
}

export const cancelUpdate = () => void BudgetNative.cancelDownload().catch(() => undefined);
