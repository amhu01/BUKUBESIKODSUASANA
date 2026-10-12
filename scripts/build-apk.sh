#!/usr/bin/env bash
# Builds an installable arm64 release APK locally (no Expo account / EAS needed).
# Tuned for a 2-core / 8 GB GitHub Codespace: single-ABI, capped Gradle memory,
# swapfile, and the two heavy C++ compiles run as separate Gradle invocations
# so the daemon doesn't get OOM-killed. Output: ./buku-besi.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# Always prefer sdkman's JDK 21: the Codespace shell presets JAVA_HOME to sdkman's
# "current" (JDK 25), and AGP's CMake configure step fails on JDK 24+'s
# restricted-native-access warning.
JDK21="$(ls -d /usr/local/sdkman/candidates/java/21* 2>/dev/null | head -1 || true)"
if [ -n "$JDK21" ]; then
  export JAVA_HOME="$JDK21"
fi
[ -n "${JAVA_HOME:-}" ] || { echo "Need a JDK 17-21 in JAVA_HOME"; exit 1; }
echo "==> Using JDK at $JAVA_HOME"

# --- one-time: Android SDK ---------------------------------------------------
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKM" ]; then
  echo "==> Installing Android command-line tools into $ANDROID_HOME"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  curl -sSL -o /tmp/cmdline-tools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm /tmp/cmdline-tools.zip
fi
if [ ! -d "$ANDROID_HOME/platforms/android-36" ] || [ ! -d "$ANDROID_HOME/ndk/27.1.12297006" ]; then
  echo "==> Installing SDK platform 36, build-tools 36, NDK 27.1, CMake 3.22 (~2.5 GB)"
  yes | "$SDKM" --licenses >/dev/null 2>&1 || true
  "$SDKM" --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
    "ndk;27.1.12297006" "cmake;3.22.1"
fi

# --- swap: the native compile OOM-kills the Gradle daemon on 8 GB without it --
if ! swapon --show 2>/dev/null | grep -q swapfile && sudo -n true 2>/dev/null; then
  echo "==> Adding 8 GB swapfile at /tmp/swapfile"
  sudo fallocate -l 8G /tmp/swapfile && sudo chmod 600 /tmp/swapfile \
    && sudo mkswap /tmp/swapfile >/dev/null && sudo swapon /tmp/swapfile
fi

# --- native project (android/ is gitignored; regenerate if missing) ----------
if [ ! -f android/gradlew ]; then
  echo "==> expo prebuild"
  cp package.json /tmp/package.json.pre-prebuild
  CI=1 npx expo prebuild --platform android --no-install
  cp /tmp/package.json.pre-prebuild package.json   # prebuild rewrites scripts; keep ours
fi
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

GP=android/gradle.properties
# prebuild writes the file without a trailing newline; appending would glue onto the last line
[ -n "$(tail -c1 "$GP")" ] && echo >> "$GP"
sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' "$GP"
sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m/' "$GP"
sed -i 's/^org.gradle.parallel=.*/org.gradle.parallel=false/' "$GP"
grep -q '^org.gradle.workers.max=' "$GP" || echo 'org.gradle.workers.max=1' >> "$GP"
grep -q '^kotlin.compiler.execution.strategy=' "$GP" || echo 'kotlin.compiler.execution.strategy=in-process' >> "$GP"

# --- build in stages -----------------------------------------------------------
cd android
for task in ':expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a]' \
            ':app:buildCMakeRelWithDebInfo[arm64-v8a]' \
            'assembleRelease'; do
  echo "==> gradlew $task"
  ./gradlew "$task" --no-daemon --console=plain
done
cd "$ROOT"

cp android/app/build/outputs/apk/release/app-release.apk buku-besi.apk
echo "==> Done: $ROOT/buku-besi.apk ($(du -h buku-besi.apk | cut -f1))"
