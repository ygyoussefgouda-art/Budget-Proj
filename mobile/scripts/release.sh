#!/usr/bin/env sh
# Build, sign, check and publish a new Android app (docs/ANDROID_SELF_UPDATE.md §5).
# Used by GitHub Actions (.github/workflows/android.yml) and on any machine with JDK 21 + Android SDK.
#
#   BUDGET_ME_URL=https://budget.example.com \
#   ANDROID_KEYSTORE_PATH=... ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_ALIAS=budgetme ANDROID_KEY_PASSWORD=... \
#   [EXPECTED_CERT_SHA256=AB:CD:...]  [VPS=deploy@your-vps  VPS_DIR=/opt/masrofy/downloads/android] \
#   [MANDATORY=false MIN_VERSION_CODE=0 NOTES_EN="Camera receipts|Fingerprint unlock" NOTES_AR="...|..."] \
#   sh mobile/scripts/release.sh 0.7.0
#
# It raises versionCode in mobile/version.json (commit that file afterwards), unless KEEP_VERSION_CODE=true
# (CI: raise it in the commit you tag).
set -eu
cd "$(dirname "$0")/.."

VERSION_NAME="${1:?usage: release.sh <versionName, e.g. 0.7.0>}"
echo "$VERSION_NAME" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "versionName must look like 1.2.3"; exit 1; }
: "${BUDGET_ME_URL:?set BUDGET_ME_URL to the https:// address of your site}"
: "${ANDROID_KEYSTORE_PATH:?set ANDROID_KEYSTORE_PATH (release key)}"

# 1. versionCode + 1 (Android refuses an update with a lower or equal number)
CODE=$(node -e "const v=require('./version.json');if(process.env.KEEP_VERSION_CODE!=='true')v.versionCode+=1;v.versionName=process.argv[1];require('fs').writeFileSync('version.json',JSON.stringify(v,null,2)+'\n');console.log(v.versionCode)" "$VERSION_NAME")
echo "==> Building Masrofy $VERSION_NAME (versionCode $CODE)"

# 2. Build the signed release APK
npm ci --no-audit --no-fund
npx cap sync android
(cd android && chmod +x gradlew && ./gradlew --no-daemon assembleRelease)
APK_IN=android/app/build/outputs/apk/release/app-release.apk
[ -f "$APK_IN" ] || { echo "No signed APK was built (is the keystore set?)"; exit 1; }
mkdir -p dist
APK="dist/masrofy-$VERSION_NAME.apk"
cp "$APK_IN" "$APK"

# 3. Check who signed it
APKSIGNER=$(ls "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -n 1)
if [ -n "$APKSIGNER" ]; then
  CERTS=$("$APKSIGNER" verify --print-certs "$APK")
  echo "$CERTS" | grep -i 'SHA-256'
  if [ -n "${EXPECTED_CERT_SHA256:-}" ]; then
    echo "$CERTS" | tr -d ':' | grep -qi "$(echo "$EXPECTED_CERT_SHA256" | tr -d ':')" || { echo "APK is NOT signed with the expected key. Stopping."; exit 1; }
  fi
fi

# 4. Checksum, size, latest.json
SHA=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(wc -c < "$APK" | tr -d ' ')
node -e "
const [name, code, sha, size] = process.argv.slice(1);
const list = (s) => (s || '').split('|').map((x) => x.trim()).filter(Boolean);
const m = {
  appId: 'com.budgetme.app',
  versionCode: Number(code),
  versionName: name,
  minVersionCode: Number(process.env.MIN_VERSION_CODE || 0),
  mandatory: process.env.MANDATORY === 'true',
  apk: 'masrofy-' + name + '.apk',
  size: Number(size),
  sha256: sha,
  releasedAt: new Date().toISOString(),
  notes: { en: list(process.env.NOTES_EN), ar: list(process.env.NOTES_AR) },
};
require('fs').writeFileSync('dist/latest.json', JSON.stringify(m, null, 2) + '\n');
" "$VERSION_NAME" "$CODE" "$SHA" "$SIZE"
echo "==> dist/latest.json written (sha256 $SHA, $SIZE bytes)"

# 5. Publish: APK first, then latest.json (so the manifest never points at a missing file); keep the last 3 APKs
if [ -n "${VPS:-}" ]; then
  VPS_DIR="${VPS_DIR:-/opt/masrofy/downloads/android}"
  ssh "$VPS" "mkdir -p '$VPS_DIR'"
  scp "$APK" "$VPS:$VPS_DIR/"
  scp dist/latest.json "$VPS:$VPS_DIR/latest.json.part"
  ssh "$VPS" "mv '$VPS_DIR/latest.json.part' '$VPS_DIR/latest.json' && cd '$VPS_DIR' && ls -1t masrofy-*.apk budget-me-*.apk 2>/dev/null | tail -n +4 | xargs -r rm --"
  echo "==> Published to $VPS:$VPS_DIR"
else
  echo "==> Not published (set VPS=user@host to upload). Files are in mobile/dist/."
fi
echo "==> Done. Commit mobile/version.json and tag: git tag android-v$VERSION_NAME"
