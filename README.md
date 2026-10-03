# 云感音乐 · Cloud Music

基于 Electron、Next.js 和 Capacitor 的音乐播放器，支持 Windows 桌面、网页和 Android。通过 Google 账号访问 Google Drive 中的音乐目录，支持音乐上传、收藏和最近播放记录同步。

## 开发运行

安装 Node.js 22，在项目目录运行：

```sh
npm ci
npm run electron:dev
```

仅启动网页：

```sh
npm run dev
```

首次使用需要配置自己的 Google OAuth 客户端。网页端将 `.env.example` 复制为 `.env.local` 并填写 Web 客户端 ID；桌面端在应用登录页导入 Desktop app OAuth JSON。详细步骤见 [Google Drive 配置说明](Google%20Drive%20配置说明.md)。本地凭据不包含在仓库中。

## 构建

```sh
# Windows 桌面安装包
npm run electron:build

# 静态网页（输出到 out）
npm run build

# Android（需要 JDK 21+ 和 Android SDK API 36）
npm run android:build
```

Android 包名为 `com.music.player`，Google Cloud 中的 Android OAuth 客户端需要登记实际签名证书的 SHA-1。当前 Android release 配置使用 debug 签名，正式发行前需配置正式签名。

项目中的 PowerShell 辅助脚本可用于本地打包；`use-node22.ps1` 依赖本地 `.local/nodejs` 目录，标准 Node.js 安装可直接运行上述 npm 命令。

## 验证

```sh
npm test
npx eslint src electron tests scripts
```

## 项目目录

- `src/`：网页界面、Google 授权与 Drive 曲库逻辑。
- `electron/`：桌面窗口、托盘及原生授权。
- `android/`：Android 工程与原生音频、授权插件。
- `tests/`：自动化测试。
- `deploy/fnos/`：飞牛 NAS 上的 Navidrome 部署示例。

构建产物、本地音乐、依赖和开发机配置由 `.gitignore` 排除。
