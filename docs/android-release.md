# OpenAI 分支：APK 打包与发布

[English](android-release.en.md) · [打包入口](https://github.com/brokenvvorld/dsh-Go/actions/workflows/android-release.yml) · [下载 APK](https://github.com/brokenvvorld/dsh-Go/releases)

这里描述本分支的 GitHub Actions 发布方式。`docs/release.md` 保留上游多下载线路的说明，本分支不使用上游的桶、令牌和发布密钥。

## 打测试包

修改主分支的 App、Dart 包、运行时或打包脚本会触发 **Android APK**。也可以打开 Actions → Android APK → Run workflow，保持 `publish` 关闭，直接运行。

成功后在运行页面底部 **Artifacts** 下载 ZIP，解压得到 arm64 APK、`SHA256SUMS` 和 `update.json`。APK 内带 Linux 运行时，适用于 Android 8.0+ 的 arm64 手机。测试版本自动带 `-ci.<运行号>.<重试号>`，不创建 Release，产物保留 14 天。完整构建要下载并打包运行时，首次较慢。

没有发布签名时，测试包使用 runner 的临时 debug key；不同运行之间不保证可覆盖安装。不要为了安装测试包卸载正在使用的版本，卸载会删除应用数据。配置下面的固定签名后，后续构建使用同一把 key。

## 首次设置发布签名

在仓库 Settings → Secrets and variables → Actions 中添加以下 **Repository secrets**：

| 名称 | 内容 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的 base64 文本 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 签名 key 的 alias |
| `ANDROID_KEY_PASSWORD` | key 密码 |

已有自己的发布 key 就继续使用。没有时，在自己电脑上用 JDK 的 `keytool` 生成一次并妥善备份，密码按提示输入，不写进命令历史：

```sh
keytool -genkeypair -v -keystore dsh-go-release.jks -storetype JKS \
  -alias dsh-go -keyalg RSA -keysize 3072 -validity 10000
```

Linux：`base64 -w 0 dsh-go-release.jks`；macOS：`base64 -i dsh-go-release.jks | tr -d '\n'`；PowerShell：`[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\dsh-go-release.jks)))`。将结果填入对应 Secret，不提交 keystore、密码或 base64 到源码。

缺少签名或只配了一部分时，正式发布会立即失败，不会降级成 debug 签名上传。流程会检查 APK 的 v1/v2/v3 签名和证书是否匹配配置的 key，并在结束时删除临时签名文件。

此分支沿用上游 applicationId，但使用你自己的签名；不能直接覆盖上游作者签名的 APK。安装迁移前先备份。自己的后续版本保持同一把 key 即可覆盖升级。

## 发布正式版

最方便的方式：Actions → Android APK → Run workflow，选择 `main`，填写新版本号，例如 `1.0.12`，勾选 `publish`。留空版本号时使用 `app/pubspec.yaml` 的版本。

也可以修改 `app/pubspec.yaml` 的版本和对应说明，提交后推送版本 tag：

```sh
git tag v1.0.12
git push origin v1.0.12
```

tag 的版本号就是 APK 的版本号。版本名带 `-`（如 `1.0.12-beta.1`）会发布成预发布版，不进入 GitHub 的 `latest`。版本名不要重复使用；已有 Release 不覆盖。如果已有同名 tag，它必须指向本次构建的提交。失败留下的草稿会保留供检查；确认原因后删除草稿再重试，或使用新版本号。

打包成功后先创建草稿 Release，上传 APK、`SHA256SUMS`、`update.json`，再从 GitHub 下载回来校验，成功后公开。下载在仓库的 Releases → 对应版本 → Assets。源码压缩包不是 APK。

App 的更新地址在构建时设为当前仓库，关闭上游 `dl.dshtui.com` 更新源；无需 OpenAI API key 或上游运维凭据参与打包。没有正式 Release 时，`releases/latest` 暂不可用。

如果 fork 的 Actions 尚未启用，先在 Actions 页点击启用工作流。若组织策略禁止 Actions 写入 Contents，需要管理员放行发布 job 的 `contents: write` 权限。

## 本地同样打包

工具链准备完成后，在仓库根目录运行；签名配置沿用 `app/android/key.properties`：

```sh
runtime/build-runtime.sh arm64-v8a
tooling/build-apk.sh --build-name 1.0.12 -- \
  --dart-define=DSH_UPDATE_REPO=brokenvvorld/dsh-Go --dart-define=DSH_UPDATE_MIRROR=
DSH_RELEASE_REPO=brokenvvorld/dsh-Go python3 tooling/release_assets.py \
  --version 1.0.12 --delta-from 0
```

自动检查覆盖版本、ABI、签名、运行时是否入包及下载文件校验。安装、PRoot 启动和真实 OpenAI 请求仍需手机验证。
