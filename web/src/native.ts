import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Everything that only works inside the Android app goes through here, so the same web build runs
 * in a normal browser (where isNative() is false and none of this is called) and in the APK.
 * Plugins are reached by name (no extra plugin packages in the web app); the APK ships the plugins.
 */
export const isNative = () => Capacitor.isNativePlatform();
export const isAndroid = () => Capacitor.getPlatform() === 'android';

type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

// ---------- Budget me's own plugin (mobile/android/.../BudgetNativePlugin.java) ----------
interface BudgetNativePlugin {
  getInstalledVersion(): Promise<{ versionCode: number; versionName: string }>;
  canInstall(): Promise<{ value: boolean }>;
  openInstallSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  download(o: { url: string; sha256: string; size: number }): Promise<{ path: string; versionCode: number }>;
  cancelDownload(): Promise<void>;
  install(o: { path: string }): Promise<void>;
  cleanup(): Promise<void>;
  biometricStatus(): Promise<{ available: boolean; reason: 'ok' | 'none_enrolled' | 'no_hardware' | 'unavailable' }>;
  biometricVerify(o: { title: string; subtitle?: string; cancel?: string }): Promise<{ verified: boolean; code?: number; message?: string }>;
  /** Home-screen widget text (1.2.0+; older app versions don't have it). */
  updateWidget(o: { title: string; value: string; sub: string; add: string }): Promise<void>;
  addListener(event: 'downloadProgress', fn: (p: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}
export const BudgetNative = registerPlugin<BudgetNativePlugin>('BudgetNative');

// ---------- Capacitor plugins bundled in the APK (only the methods we use) ----------
interface CameraPlugin {
  getPhoto(o: { quality: number; resultType: 'base64'; source: 'CAMERA' | 'PHOTOS' | 'PROMPT'; width?: number; correctOrientation?: boolean; saveToGallery?: boolean }): Promise<{ base64String?: string; format: string }>;
  checkPermissions(): Promise<{ camera: PermissionState; photos: PermissionState }>;
  requestPermissions(o?: { permissions: ('camera' | 'photos')[] }): Promise<{ camera: PermissionState; photos: PermissionState }>;
}
export const Camera = registerPlugin<CameraPlugin>('Camera');

export interface LocalNotification { id: number; title: string; body: string; schedule?: { at: Date; allowWhileIdle?: boolean }; extra?: Record<string, unknown> }
interface LocalNotificationsPlugin {
  schedule(o: { notifications: LocalNotification[] }): Promise<unknown>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  checkPermissions(): Promise<{ display: PermissionState }>;
  requestPermissions(): Promise<{ display: PermissionState }>;
  addListener(event: 'localNotificationActionPerformed', fn: (a: { notification: { extra?: Record<string, unknown> } }) => void): Promise<PluginListenerHandle>;
}
export const LocalNotifications = registerPlugin<LocalNotificationsPlugin>('LocalNotifications');

interface HapticsPlugin {
  impact(o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void>;
}
const Haptics = registerPlugin<HapticsPlugin>('Haptics');

interface AppPlugin {
  addListener(event: 'backButton', fn: (e: { canGoBack: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'appUrlOpen', fn: (e: { url: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'resume', fn: () => void): Promise<PluginListenerHandle>;
  exitApp(): Promise<void>;
  minimizeApp(): Promise<void>;
}
export const App = registerPlugin<AppPlugin>('App');

interface FilesystemPlugin {
  writeFile(o: { path: string; data: string; directory: 'DOCUMENTS' | 'CACHE'; recursive?: boolean }): Promise<{ uri: string }>;
}
const Filesystem = registerPlugin<FilesystemPlugin>('Filesystem');
interface SharePlugin {
  share(o: { title?: string; text?: string; files?: string[]; dialogTitle?: string }): Promise<unknown>;
}
const Share = registerPlugin<SharePlugin>('Share');

// ---------- small helpers used around the app ----------

/** A short buzz (swipe to delete/edit). Native haptics in the app, vibrate() in the browser. */
export function haptic(style: 'LIGHT' | 'MEDIUM' = 'LIGHT') {
  if (isNative()) void Haptics.impact({ style }).catch(() => undefined);
  else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(style === 'LIGHT' ? 12 : 25);
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * Save a file the user asked for (export, backup). In the app: into the cache and open the share
 * sheet (save to Files, Drive, WhatsApp...). In the browser: a normal download.
 */
export async function saveFile(blob: Blob, filename: string) {
  if (isNative()) {
    const { uri } = await Filesystem.writeFile({ path: `exports/${filename}`, data: await toBase64(blob), directory: 'CACHE', recursive: true });
    await Share.share({ title: filename, files: [uri], dialogTitle: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Take or pick a receipt photo in the app; returns a File ready for the normal upload, or null if cancelled. */
export async function nativeReceiptPhoto(source: 'CAMERA' | 'PHOTOS'): Promise<File | null> {
  try {
    const p = await Camera.getPhoto({ quality: 80, resultType: 'base64', source, width: 1600, correctOrientation: true, saveToGallery: false });
    if (!p.base64String) return null;
    const bytes = Uint8Array.from(atob(p.base64String), (c) => c.charCodeAt(0));
    const type = p.format === 'png' ? 'image/png' : p.format === 'webp' ? 'image/webp' : 'image/jpeg';
    return new File([bytes], `receipt.${p.format || 'jpg'}`, { type });
  } catch {
    return null; // cancelled or no permission
  }
}
