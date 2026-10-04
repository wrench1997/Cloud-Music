# GitHub 更新

Windows 安装版启动后自动检查本仓库的正式 GitHub Release，下载完成后点击“重启并更新”。关闭到托盘不会安装更新。开发模式不检查更新。

Android 启动后自动检查最新正式 Release，发现新版本后在应用内下载和安装。下载完成会校验 SHA-256、包名、版本号和签名证书；签名必须与已安装应用一致。Android 首次可能要求允许本应用安装 APK，随后由系统安装器确认更新，应用数据保留。

发布流程由 `.github/workflows/release.yml` 定义。更新 `package.json` 版本、`package-lock.json` 根版本，以及 `android/app/build.gradle` 的 `versionName` 和递增的 `versionCode`，推送匹配电脑版版本的 Git tag（例如 `v1.2.0`），GitHub Actions 会测试、构建两端并发布安装包和更新元数据。

Actions 首次配置需要 Repository Actions Secrets：

- `ANDROID_SIGNING_KEYSTORE_BASE64`：**当前 APK 使用的同一签名密钥文件**的 Base64。
- `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`：该密钥的密码和别名。

还需 Repository Actions Variable `GOOGLE_WEB_CLIENT_ID`，值为当前 Google Web OAuth Client ID。它是公开客户端标识，不是客户端密钥。

已发布的 3.1.0 APK 使用本机 Android debug 密钥，证书 SHA-256 为 `84fa131593a6b4d062c7eb672c9595c68dd6fd54571a6932d22f6b85e9804e50`。已有安装必须继续使用这个密钥，避免换签名导致无法覆盖安装及 Google OAuth 失效。密钥只保存在本机或 GitHub 加密 Secrets 中，不能提交到代码仓库。工作流缺少签名配置时明确失败，不生成新的随机 debug 密钥替代。

更新 Release 需要以下文件一起发布：

- `Yungan-Music-Setup-<电脑版版本>.exe`、对应 `.blockmap`、`latest.yml`。
- `Yungan-Music-Android-<Android版本>.apk`、`android-update.json`。
- `SHA256SUMS.txt`。

本地已有 Windows 和 Android 构建时，运行 `node scripts/release-manifest.cjs` 生成上述发布文件，默认读取 `dist/` 与 `android/app/build/outputs/apk/release/app-release.apk`，写入 `.local/release-assets/`。也可将第一个参数设为输出目录，第二个参数指定现有签名的 APK 路径。

旧的 Windows 1.1.0 和 Android 3.1.0 尚未内置本次更新模块，需要手动安装一次新版本，后续版本才会在应用内提示。GitHub Releases 可直接使用，无需额外的更新服务器。
