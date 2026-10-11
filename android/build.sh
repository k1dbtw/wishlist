#!/usr/bin/env bash
# Builds dist/stash.apk without the Android SDK or Gradle: everything comes from Maven Central.
#   ./android/build.sh                          → asks for the site address on first launch
#   SITE_URL=https://my.netlify.app ./android/build.sh   → opens that site straight away
# Needs Java 17+, curl, unzip. The signing key is created once in android/keystore.p12 (kept out of git):
# keep it, an update must be signed with the same key or Android refuses to install it over the old one.
set -euo pipefail
cd "$(dirname "$0")"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
SITE_URL="${SITE_URL:-}"
KS_PASS="${KS_PASS:-stash-android}"
T=.tools; B=build
mkdir -p "$T" "$B" ../dist

fetch() {  # maven path, file
  [ -s "$T/$2" ] && return 0
  for i in 1 2 3 4 5 6 7 8; do
    code=$(curl -s -m 900 -o "$T/$2" -w "%{http_code}" "https://repo.maven.apache.org/maven2/$1") || true
    [ "$code" = 200 ] && return 0
    sleep $((i * 4))   # Maven Central rate-limits bursts
  done
  echo "could not download $1 ($code)" >&2; rm -f "$T/$2"; exit 1
}
fetch org/apktool/apktool-lib/3.0.3/apktool-lib-3.0.3.jar apktool-lib.jar                     # aapt2 + framework resources
fetch com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar dx.jar           # .class → classes.dex
fetch com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar apksig.jar                          # APK signing v1 + v2
fetch org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar android-all.jar  # Android 14 API to compile against
if [ ! -x "$T/aapt2" ]; then
  unzip -o -q -j "$T/apktool-lib.jar" prebuilt/linux/aapt2 prebuilt/android-framework.jar -d "$T"
  chmod +x "$T/aapt2"
fi

rm -rf "$B" && mkdir -p "$B/gen/uz/k1d/stash" "$B/classes" "$B/res"
cat > "$B/gen/uz/k1d/stash/Config.java" <<JAVA
package uz.k1d.stash;
final class Config { static final String SITE_URL = "${SITE_URL%/}"; }
JAVA

echo "· java"
javac -nowarn --release 8 -cp "$T/android-all.jar" -d "$B/classes" src/uz/k1d/stash/*.java "$B/gen/uz/k1d/stash/Config.java" 2>&1 | grep -v "^warning\|^Note\|warnings\?$" || true
java -cp "$T/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"

echo "· resources"
"$T/aapt2" compile --dir res -o "$B/res.zip"
"$T/aapt2" link -o "$B/res.apk" -I "$T/android-framework.jar" --manifest AndroidManifest.xml -A assets "$B/res.zip" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" --auto-add-overlay

if [ ! -f keystore.p12 ]; then
  echo "· new signing key → android/keystore.p12"
  keytool -genkeypair -keystore keystore.p12 -storetype PKCS12 -storepass "$KS_PASS" -keypass "$KS_PASS" -alias stash \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=stash" >/dev/null 2>&1
fi

echo "· pack + sign"
javac -nowarn -cp "$T/apksig.jar" -d "$B/tools" tools/Pack.java tools/Verify.java
# apksig 2.3.0 (the last release on Maven Central) reaches into JDK internals
OPEN="--add-exports=java.base/sun.security.x509=ALL-UNNAMED --add-exports=java.base/sun.security.pkcs=ALL-UNNAMED --add-exports=java.base/sun.security.util=ALL-UNNAMED"
java $OPEN -cp "$T/apksig.jar:$B/tools" Pack "$B/res.apk" "$B/classes.dex" keystore.p12 "$KS_PASS" ../dist/stash.apk
java $OPEN -cp "$T/apksig.jar:$B/tools" Verify ../dist/stash.apk
ls -lh ../dist/stash.apk
