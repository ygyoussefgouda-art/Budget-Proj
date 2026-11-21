# Android app: distribution, download link and self-update

Budget me is a **personal app that is not on Google Play**. The signed APK is hosted on the owner's
Linux VPS next to the web app and database. This document is the spec for how the APK is built,
published, downloaded, and how an installed app updates itself.

---

## 1. Two update layers

| Layer | What changes | How it reaches the phone |
|---|---|---|
| **Web layer** (React UI, API) | 95% of changes | The APK loads the live site (`server.url`). A normal Docker deploy updates every phone the next time the app opens; the service-worker "New version, Reload" toast handles open sessions. **No APK needed.** |
| **Native layer** (Capacitor shell, plugins, permissions, icon, `AndroidManifest.xml`) | rare | New signed APK on the VPS → the app offers the update → Android installer. |

The web layer must check compatibility with the native layer: `GET /api/version` returns
`minNativeVersionCode`. If the installed APK is older, the web UI shows a blocking
"Update the app to continue" screen with the update button (section 4).

## 2. Files on the VPS

Served by the reverse proxy (or by the app container from a mounted read-only volume):

```
/opt/budget-me/downloads/android/
  latest.json
  budget-me-0.6.0.apk
  budget-me-0.5.9.apk        # keep the last 3 for rollback
```

Mount into the app container read-only, for example in `docker-compose.yml`:

```yaml
    volumes:
      - ./downloads:/app/downloads:ro
```

### `latest.json`

```json
{
  "appId": "me.budget.app",
  "versionCode": 12,
  "versionName": "0.6.0",
  "minVersionCode": 10,
  "mandatory": false,
  "apk": "budget-me-0.6.0.apk",
  "size": 8421376,
  "sha256": "3f1c...e9",
  "releasedAt": "2026-12-01T10:00:00Z",
  "notes": {
    "en": ["Camera receipts", "Budget alerts as notifications"],
    "ar": ["صور الإيصالات بالكاميرا", "تنبيهات الميزانية كإشعارات"]
  }
}
```

- `versionCode`: integer, strictly increasing (Android refuses a lower one).
- `minVersionCode`: installed apps below this **must** update (the app shows a blocking screen).
- `mandatory: true` makes this specific update blocking even above `minVersionCode`.
- `sha256`: hex SHA-256 of the APK file, checked on the phone before installing.

## 3. Server endpoints (new, in `server/src/appRelease.ts`)

| Route | Auth | Returns |
|---|---|---|
| `GET /api/app/android/latest` | none | `latest.json` without internal fields, plus `downloadUrl` |
| `GET /api/app/android/apk/:file` | **signed-in session** (default) | the APK, `Content-Type: application/vnd.android.package-archive`, `Content-Disposition: attachment`, `Cache-Control: no-store`. `:file` must match `^budget-me-\d+\.\d+\.\d+\.apk$` and exist in the folder (no path traversal) |
| `GET /download/android?k=<token>` *(optional)* | secret token from `.env` (`APK_DOWNLOAD_TOKEN`) | 302 to the latest APK. For the **first install** on a new phone, when the user can't sign in from the browser yet. Rate-limited. Token can be rotated in `.env`. |

Notes:
- Add these routes **before** `requireAuth` only for the public ones.
- The CSP and `Cache-Control: no-store` rules in `server/src/app.ts` stay as they are.
- nginx: `client_max_body_size` is irrelevant for downloads; make sure `proxy_buffering` doesn't truncate large files (default is fine).
- Add API tests: manifest shape, auth required on the APK route, rejects `../` names, 404 on missing file.

## 4. In-app update flow (native only)

Add a small **local Capacitor plugin written in Kotlin** inside `mobile/android/app/src/main/java/.../ApkUpdaterPlugin.kt`
(about 150 lines; keeps third-party code out of the update path). Methods:

| Method | Does |
|---|---|
| `getInstalledVersion()` | `{ versionCode, versionName }` from `PackageManager` |
| `canInstall()` | `packageManager.canRequestPackageInstalls()` |
| `openInstallSettings()` | opens `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` with `package:<appId>` |
| `download({ url, sha256, size })` | downloads to `cacheDir/updates/` with progress events, attaches the WebView session cookie (`CookieManager.getInstance().getCookie(url)`), verifies size + SHA-256, verifies with `getPackageArchiveInfo` that `packageName == appId` and `versionCode > installed`, deletes the file on any mismatch |
| `install({ path })` | launches the system installer through a `FileProvider` URI (`ACTION_VIEW`, `application/vnd.android.package-archive`, `FLAG_GRANT_READ_URI_PERMISSION`) or a `PackageInstaller` session |
| `cleanup()` | deletes old files in `cacheDir/updates/` (call on launch) |

Manifest additions: `REQUEST_INSTALL_PACKAGES` permission and a `<provider androidx.core.content.FileProvider>`
whose paths XML exposes only `cache-path name="updates" path="updates/"`.

### Web side (`web/src/update.ts` + Settings UI)

1. On app start (native only, at most once per 6 h, and on Settings → **Check for updates**):
   `GET /api/app/android/latest` → compare `versionCode` with `getInstalledVersion()`.
2. Newer available → show a card/toast: "Version 0.6.0 is available" + notes in the current language + **Update**.
   If installed `< minVersionCode` or `mandatory` → full-screen blocking dialog (only **Update** is offered).
3. **Update** pressed:
   - `canInstall()` false → explain "Allow Budget me to install updates" → `openInstallSettings()` → re-check on resume.
   - `download()` with a progress bar (cancel allowed when not mandatory).
   - `install()` → Android shows its own "Do you want to update this app?" dialog. Data, sign-in cookie and PIN are kept because the package name and signing key are the same.
4. Failure messages (EN + AR): no connection, checksum mismatch ("download was damaged, try again"),
   not enough storage, install cancelled.
5. Settings → **About** shows: app version (native `versionName` + web version), last update check time.

### Non-native (browser) side: the download link

- Settings card **"Get the Android app"** (hidden when `isNative()`), and a small link on the sign-in screen.
- Shows version, size, release date and a 3-step guide:
  1. Tap **Download**.
  2. Open the file; if Android asks, allow your browser to install unknown apps.
  3. Open Budget me and sign in. The app then asks for the permissions it needs.
- Optionally show a QR code of the download URL on desktop (generated client-side, no external service).

## 5. Release process

Script `mobile/scripts/release.sh` (also used by CI):

1. Bump `versionCode` (+1) and `versionName` in `mobile/android/app/build.gradle` (or read from `mobile/version.json`).
2. `./gradlew assembleRelease` with signing config from `keystore.properties` / env vars.
3. `apksigner verify --print-certs` (sanity check that the expected certificate signed it).
4. `sha256sum` + file size → write `latest.json`.
5. Upload APK first, then `latest.json` (so the manifest never points to a missing file):
   `rsync`/`scp` to `/opt/budget-me/downloads/android/`.
6. Delete APKs older than the last 3.
7. Git tag `android-v<versionName>`; add a line to `PROGRESS.md` / release notes.

GitHub Actions job `android-release` (on tag `android-v*` or manual dispatch):
`setup-java@v4 (21)` → Android SDK → `npm ci` in `mobile/` → `npx cap sync android` → decode keystore from
the `ANDROID_KEYSTORE_BASE64` secret → build → steps 3–6 over SSH with the `VPS_DEPLOY_KEY` secret.
Upload the APK as a workflow artifact too.

Rollback: re-point `latest.json` to an older APK **only** if its `versionCode` is raised (Android won't
downgrade). Usually ship a new fixed build instead.

## 6. Signing key (critical)

- Create once: `keytool -genkeypair -v -keystore budget-me-release.jks -alias budgetme -keyalg RSA -keysize 4096 -validity 10000`.
- Store the `.jks` + passwords in the owner's password manager **and** an offline backup. Never commit it
  (`*.jks`, `*.keystore`, `keystore.properties` in `.gitignore`).
- Every update must be signed with this key. If it is lost, phones must uninstall (losing local data such as
  the PIN and offline queue) and install a new app.
- Record the certificate SHA-256 fingerprint in `MEMORY.md` (the fingerprint is not secret) so CI can verify it.

## 7. Security notes

- HTTPS only; `cleartext: false`; `allowNavigation` only the production host.
- The phone verifies SHA-256 from the manifest and Android verifies the signature matches the installed app,
  so a tampered APK cannot replace the real one.
- The APK route requires a session (or the rotating secret token), so the APK isn't a public download.
- Never put secrets in the APK: it only contains the server URL.

## 8. Tests

- Server: endpoint tests (section 3).
- Web: unit tests for version comparison, "check at most every 6 h", mandatory logic.
- Manual device checklist (record results in `PROGRESS.md`):
  - [ ] Fresh install from the browser download link on Android 10, 13 and 15 (or emulators).
  - [ ] Update from N to N+1 keeps sign-in, PIN, offline queue.
  - [ ] Mandatory update blocks the app; non-mandatory can be dismissed.
  - [ ] "Install unknown apps" denied → clear message → allow → install continues.
  - [ ] Corrupted APK (wrong sha256 in manifest) is rejected and deleted.
  - [ ] Arabic (RTL) texts on all update screens.
