# 云感音乐 · Cloud Music

基于 Electron、Next.js 和 Capacitor 的音乐播放器，支持 Windows 桌面、网页和 Android。通过 Google 账号访问 Google Drive 中的音乐目录，支持音乐上传、收藏和最近播放记录同步。

## 开发运行

安装 Node.js 22，在项目目录运行：

```sh
npm ci
npm run electron:dev
```

启动完整网页版（前端和下载后端由同一个进程提供）：

```sh
npm run web
```

已有构建可直接使用 `npm start` 或 `npm run preview`，地址固定为 `http://localhost:3000`。网页自动连接同源下载接口，无需另开下载服务或填写配对链接。`npm run dev` 仅用于 Next.js 前端热更新。Google Web OAuth 的已授权 JavaScript 来源必须包含完整来源（协议、主机和端口）；换成其他端口或 `127.0.0.1` 都属于不同来源，可能出现 `origin_mismatch`。

首次使用需要配置自己的 Google OAuth 客户端。网页端将 `.env.example` 复制为 `.env.local` 并填写 Web 客户端 ID；桌面端在应用登录页导入 Desktop app OAuth JSON。详细步骤见 [Google Drive 配置说明](Google%20Drive%20配置说明.md)。本地凭据不包含在仓库中。

Windows 首次授权后用系统加密保存会话，重开应用自动恢复。Android 保存已选账号并通过 Google Play 服务静默恢复授权；首次安装本次新版需要登录一次。主动退出会清除保存状态，授权被撤销时需重新登录。网页刷新可恢复同一标签页尚未过期的短期授权。

Windows 和 Android 已接入 GitHub Release 更新：启动检查，Windows 下载完成后点击重启安装，Android 由系统确认安装。旧版本需手动安装一次本次新版，后续可在应用内更新。发布流程及签名说明见 [GitHub 更新](docs/github-updates.md)。

## 播放与发现音乐

底部和全屏播放器均支持点击或拖动进度条跳转，也可用方向键微调。播放模式菜单可直接选择顺序播放、列表循环、单曲循环和随机播放，重启后保留选择。Android 使用原生音频服务，支持后台播放和通知栏控制。全屏播放器显示完整专辑封面，手机布局为进度条和按钮保留独立触摸区域。

手机底部固定“曲库、发现、下载、我的”四个入口，账号、同步、更新和软件许可集中在“我的”。迷你播放器显示歌曲、播放和进度，完整播放页提供播放模式、队列和电台。切换页面保留播放和下载任务。

Windows、网页与 Android 的“发现”默认打开“新歌 · 歌手 · 专辑”：读取 Spotify 官方 New Music Friday 当期新歌，显示实际封面、发行日期，点进其他歌手可查看最新发行、专辑和曲目。YouTube 提供最近一个月的最新上传、歌手频道及 YouTube Music 专辑 / 歌曲搜索；上传时间与歌曲首发日期分别标示。Spotify 关键词搜索在原平台打开，也可粘贴 Spotify 歌手、专辑、单曲或 YouTube Music 分享链接在应用查看。曲库和完整播放页的歌手、专辑名称可以直接跳转搜索，手机歌曲“⋯”菜单也提供入口。Spotify 试听使用官方播放器，下载前仍需选择并核对 YouTube 音源。无需 Google Drive 登录，也不局限于本机已有的歌手。公开页面可见的发行与曲目可能不完整。

从播放器点击“从这首歌开启电台”会自动读取对应电台。“歌曲电台”以正在播放、最近播放和收藏中的 YouTube 音源为起点，读取真实 YouTube Mix，保留平台顺序，提供跨歌手推荐、试听和下载。没有可用音源时，可从 Spotify 榜单或手动找歌选择起点。

“Spotify 榜单”实时读取全球、香港和台湾官方 Top 50，可为单曲明确选择 YouTube 音源后继续开启电台或下载；“手动找歌”保留关键词搜索。可隐藏已经入库的音源。这里使用平台电台和榜单，尚未内置分析本机音频的 AI 模型，也不读取 Spotify 私人账号的推荐。下载后可直接点击“立即播放”，无需先连接或上传 Google Drive。

## Spotify / YouTube Music 歌单

打开“下载”，粘贴 Spotify 或 YouTube Music 分享链接并导入，再选择曲目与音源。可自定义名称、保存多个歌单、移除或重新加载；链接保存在本机，无需 Google Drive 登录或认证 JSON。次级入口“原平台试听”可打开官方嵌入播放器。

Spotify 的完整播放能力由平台、账号、地区和设备决定，可能仅提供试听。YouTube Music 使用 YouTube 可见播放器，私密或不允许嵌入的内容可能无法播放，Android 锁屏及后台播放不保证可用。Drive 授权不会自动登录这两个平台；可使用“在原平台打开”访问对应歌单。

### 下载 MP3 与上传云端

打包的 Windows 版内置转换工具。源码运行时，首次安装转换工具：`npm run media:install`。安装脚本从 yt-dlp 官方 GitHub 和 FFmpeg 官网列出的 Gyan 构建源下载，校验 SHA-256。

- 电脑版 Electron 自动启动本地下载服务，MP3 保存在系统下载目录下的 `Yungan Music`。
- 网页：页面与下载后端一起启动，MP3 保存在 `.local/downloads`，可在页面保存到浏览器下载目录。后端自动连接，不显示启动命令或配对框。目前服务仅监听本机，尚未部署到公网。
- Android 3.3.0 起：内置 yt-dlp、Python、QuickJS 和 FFmpeg，在手机直接导入、找歌、下载、转换 MP3、写入歌名/歌手/封面，后台任务由原生服务继续。无需电脑、配对、Termux 或另一个下载应用。下载首先进入“本机音乐”，Android 10+ 可保存至系统 `Download/Yungan Music`；旧版保存至应用外部音乐目录。当前安装包支持 ARM64、Android 7.0+、4 KB 内存页的设备；16 KB 内存页设备会提示组件不支持，不会冒报转换成功。
- YouTube：读取歌单（每次最多 100 首）、选择曲目、下载并转成 MP3。
- Spotify：读取公开歌单元数据，按歌曲、歌手和时长查找 YouTube 候选，核对版本后下载。界面明确显示下载来源，Spotify 原始加密音源不导出为 MP3，公开页面不一定展示全部曲目。
- 登录 Google Drive 后，可勾选“完成后自动上传 Drive”，MP3 会上传到已验证账号自己的 `Yungan Music` 文件夹。Android 原生服务使用同一 Google 账号静默获取短期授权和续传；需要确认授权时，在任务中点击“确认 Google 授权并续传”。上传失败保留本机 MP3，可手动重试，也可下载完成后再连接账号上传。
- 下载任务及 MP3 记录会保留，重新打开仍可继续上传；下载失败可只重试失败曲目。全部失败不会再显示绿色 100% 成功进度。

网页下载接口限制为本机同源访问，电脑端共享服务使用随机配对码；网页下载后端不接收 Google 凭据。未实现私密平台歌单授权或受保护音源解密。联网找歌和下载需要设备能够访问相应平台，已下载的本机音乐可离线播放。音源可用性仍依赖平台和 yt-dlp 支持状态。

## 构建命令

```sh
# Windows 桌面安装包
npm run electron:build

# 静态网页（输出到 out）
npm run build

# Android（需要 JDK 21+ 和 Android SDK API 36）
npm run android:build
```

Android 包名为 `com.music.player`，Google Cloud 中的 Android OAuth 客户端需要登记实际签名证书的 SHA-1。当前 Android release 配置使用 debug 签名，正式发行前需配置正式签名。

Android 构建命令自动从 yt-dlp 官方稳定发行版下载 Unix 资源并校验 SHA-256，生成 `android/app/src/main/res/raw/ytdlp`；该文件不提交 Git。GitHub 发布工作流执行同一准备步骤。第三方原生组件、对应源码和许可证见 [软件许可](THIRD_PARTY_NOTICES.md)。

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
