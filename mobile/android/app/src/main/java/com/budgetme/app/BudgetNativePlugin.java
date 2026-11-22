package com.budgetme.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Budget me's own native features, kept small and free of third-party code:
 *  - self-update: download the APK named in latest.json, check size + SHA-256 + package name +
 *    a higher versionCode, then hand it to Android's installer (docs/ANDROID_SELF_UPDATE.md);
 *  - fingerprint / face unlock for the app lock (the PIN stays as the fallback);
 *  - open this app's system settings (permissions that were permanently denied).
 */
@CapacitorPlugin(name = "BudgetNative")
public class BudgetNativePlugin extends Plugin {
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile boolean cancelled = false;

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private long installedVersionCode() throws PackageManager.NameNotFoundException {
        PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    }

    // ---------- version + install permission ----------

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject r = new JSObject();
            r.put("versionCode", installedVersionCode());
            r.put("versionName", pi.versionName);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read the app version.", "version", e);
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean ok = Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject r = new JSObject();
        r.put("value", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // ---------- self-update ----------

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        final String sha256 = call.getString("sha256", "");
        final Long size = call.getLong("size");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Updates are only downloaded over HTTPS.", "bad_url");
            return;
        }
        // Only from the app's own server.
        String server = getBridge().getConfig().getServerUrl();
        try {
            if (server != null && !new URL(server).getHost().equalsIgnoreCase(new URL(url).getHost())) {
                call.reject("Updates are only downloaded from this app's own server.", "bad_url");
                return;
            }
        } catch (Exception e) {
            call.reject("Bad update address.", "bad_url");
            return;
        }
        if (sha256 == null || !sha256.matches("^[0-9a-fA-F]{64}$")) {
            call.reject("The update has no valid checksum.", "bad_manifest");
            return;
        }
        cancelled = false;
        io.execute(() -> {
            File out = new File(updatesDir(), "update.apk");
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setInstanceFollowRedirects(false); // stays on our server
                String cookie = CookieManager.getInstance().getCookie(url); // signed-in session, if the server wants one
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                if (c.getResponseCode() != 200) throw new UpdateError("http", "The server didn't send the update (" + c.getResponseCode() + ").");
                long total = size != null ? size : c.getContentLengthLong();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long received = 0;
                int lastPct = -1;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (cancelled) throw new UpdateError("cancelled", "Download cancelled.");
                        fo.write(buf, 0, n);
                        md.update(buf, 0, n);
                        received += n;
                        if (total > 0 && received > total + 1024) throw new UpdateError("size", "The download is bigger than expected.");
                        int pct = total > 0 ? (int) (received * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("received", received);
                            p.put("total", total);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                if (size != null && received != size) throw new UpdateError("size", "The download was damaged. Try again.");
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
                if (!hex.toString().equalsIgnoreCase(sha256)) throw new UpdateError("checksum", "The download was damaged. Try again.");
                PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(out.getPath(), 0);
                if (info == null || !getContext().getPackageName().equals(info.packageName)) throw new UpdateError("package", "This file is not a Budget me update.");
                long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
                if (code <= installedVersionCode()) throw new UpdateError("version", "This version is already installed.");
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("versionCode", code);
                call.resolve(r);
            } catch (UpdateError e) {
                out.delete();
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                out.delete();
                call.reject("Download failed. Check your connection and storage, then try again.", "network", e);
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File f = path == null ? null : new File(path);
        try {
            if (f == null || !f.exists() || !f.getCanonicalPath().startsWith(updatesDir().getCanonicalPath() + File.separator)) {
                call.reject("Nothing to install.", "missing");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, APK_MIME);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer.", "install", e);
        }
    }

    /** Old downloads are removed when the app starts. */
    @PluginMethod
    public void cleanup(PluginCall call) {
        File[] files = updatesDir().listFiles();
        if (files != null) for (File f : files) f.delete();
        call.resolve();
    }

    // ---------- fingerprint / face unlock ----------

    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        int s = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        JSObject r = new JSObject();
        r.put("available", s == BiometricManager.BIOMETRIC_SUCCESS);
        // "none_enrolled": the phone can do it, but no fingerprint/face is set up in Android settings.
        r.put("reason", s == BiometricManager.BIOMETRIC_SUCCESS ? "ok"
            : s == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ? "none_enrolled"
            : s == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE || s == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE ? "no_hardware"
            : "unavailable");
        call.resolve(r);
    }

    @PluginMethod
    public void biometricVerify(final PluginCall call) {
        final String title = call.getString("title", "Budget me");
        final String subtitle = call.getString("subtitle", "");
        final String cancel = call.getString("cancel", "Use PIN");
        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText(cancel)
                    .setAllowedAuthenticators(AUTHENTICATORS)
                    .setConfirmationRequired(false)
                    .build();
                BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(), ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            JSObject r = new JSObject();
                            r.put("verified", true);
                            call.resolve(r);
                        }

                        @Override
                        public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                            // Cancelled, "Use PIN", too many tries...: the app falls back to the PIN pad.
                            JSObject r = new JSObject();
                            r.put("verified", false);
                            r.put("code", code);
                            r.put("message", msg.toString());
                            call.resolve(r);
                        }
                        // onAuthenticationFailed: a finger that didn't match; Android keeps the prompt open.
                    });
                prompt.authenticate(info);
            } catch (Exception e) {
                call.reject("Fingerprint unlock is not available.", "unavailable", e);
            }
        });
    }

    private static class UpdateError extends Exception {
        final String code;

        UpdateError(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
