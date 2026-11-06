# OpenAI fork: APK builds and releases

[简体中文](android-release.md) · [Build APK](https://github.com/brokenvvorld/dsh-Go/actions/workflows/android-release.yml) · [Download releases](https://github.com/brokenvvorld/dsh-Go/releases)

This fork uses GitHub Actions and GitHub Releases. `docs/release.md` describes upstream's separate multi-mirror deployment; this workflow does not use upstream buckets, tokens, or signing keys.

## Test builds

Changes to the app, Dart packages, runtime, or tooling on `main` trigger **Android APK**. To run it manually, open Actions → Android APK → Run workflow and leave `publish` unchecked.

Download the ZIP under **Artifacts** on the completed run. It contains an arm64 APK with the bundled Linux runtime, `SHA256SUMS`, and `update.json`. Android 8.0+ is required. Test versions include `-ci.<run>.<attempt>`, do not create Releases, and are retained for 14 days. The first complete runtime build takes longer.

Without signing secrets, test APKs use the runner's temporary debug key and may not install over a build from another run. Do not uninstall an app containing important data just to install a test build: uninstalling deletes its data. Configure a fixed key for subsequent builds to share a signature.

## Configure signing once

Add these **Repository secrets** under Settings → Secrets and variables → Actions:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Signing key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Keep using your existing release key if you have one. Otherwise generate one on your own computer using the JDK and back it up. Enter passwords at the prompts:

```sh
keytool -genkeypair -v -keystore dsh-go-release.jks -storetype JKS \
  -alias dsh-go -keyalg RSA -keysize 3072 -validity 10000
```

Encode with `base64 -w 0 dsh-go-release.jks` on Linux, `base64 -i dsh-go-release.jks | tr -d '\n'` on macOS, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\dsh-go-release.jks)))` in PowerShell. Paste into the Secret, never into source control.

Publishing fails immediately when signing is missing or incomplete. It never publishes a debug-signed APK. The workflow verifies v1/v2/v3 signatures and compares the certificate to the configured key. Temporary signing files are removed afterwards.

The fork retains upstream's applicationId but uses your own key, so it cannot install over an upstream-signed APK. Back up before migrating. Keep the same key for future upgrades of your own builds.

## Publish a version

Open Actions → Android APK → Run workflow, select `main`, enter a new version such as `1.0.12`, and check `publish`. Leaving the version blank uses `app/pubspec.yaml`.

Alternatively, update the version in `app/pubspec.yaml` and the related documentation, commit, then push a version tag:

```sh
git tag v1.0.12
git push origin v1.0.12
```

The tag determines the APK version. Versions containing `-`, such as `1.0.12-beta.1`, become prereleases and do not enter `latest`. Existing Releases are never overwritten. An existing tag must resolve to the exact commit being built. A failed publication leaves a draft for inspection; resolve the cause and remove the draft before retrying, or choose a new version.

The workflow creates a draft, uploads the APK, `SHA256SUMS`, and `update.json`, downloads the files back and verifies them, then publishes. Download the APK under Releases → version → Assets; the source archives are not installable apps.

The compiled app checks this repository for updates with upstream's `dl.dshtui.com` feed disabled. No OpenAI API key or upstream deployment credentials are needed to build. `releases/latest` is unavailable until a stable release exists.

If Actions is disabled for the fork, enable workflows from its Actions page. Organization policies must permit the publishing job's `contents: write` permission.

## Local builds

After installing the toolchain, run from the repository root. Local signing uses `app/android/key.properties`:

```sh
runtime/build-runtime.sh arm64-v8a
tooling/build-apk.sh --build-name 1.0.12 -- \
  --dart-define=DSH_UPDATE_REPO=brokenvvorld/dsh-Go --dart-define=DSH_UPDATE_MIRROR=
DSH_RELEASE_REPO=brokenvvorld/dsh-Go python3 tooling/release_assets.py \
  --version 1.0.12 --delta-from 0
```

Automated checks cover version, ABI, signature, bundled runtime, and downloaded file checksums. Installation, PRoot startup, and live OpenAI requests still need a real phone.
