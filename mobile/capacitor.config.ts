import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Remote URL mode: the app shows the live site from the VPS, so every web deploy updates the app's
 * screens at once. A new APK is only needed for native changes (plugins, permissions, icon).
 * BUDGET_ME_URL is the production HTTPS address, set when building (never commit a private host).
 */
const url = process.env.BUDGET_ME_URL;
if (url && !url.startsWith('https://')) throw new Error('BUDGET_ME_URL must be an https:// address');
const host = url ? new URL(url).host : undefined;

const config: CapacitorConfig = {
  // The update identity of the app: never change it after the first install (owner's choice, 2026-11-21).
  appId: 'com.budgetme.app',
  appName: 'Budget me',
  // Fallback page shown when the server can't be reached on a cold start (see www/index.html).
  webDir: 'www',
  server: url
    ? {
        url,
        cleartext: false,
        // Only our own site may open inside the app; other links go to the browser.
        allowNavigation: host ? [host] : [],
        errorPath: 'index.html',
      }
    : undefined,
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#0b0c1f', showSpinner: false },
    LocalNotifications: { smallIcon: 'ic_stat_budget', iconColor: '#d29a5c' },
  },
};

export default config;
