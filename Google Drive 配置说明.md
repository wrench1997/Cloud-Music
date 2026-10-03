# Google Drive 曲库配置

云感音乐的入口为 **Google 登录验证 → 打开 Drive 音乐目录 → 选歌播放**。每次启动先显示 Google 登录页，验证 Google 授权和账号成功后才显示目录。可以进入自己云盘里已有的文件夹听音乐，无需重新上传。新上传的歌曲保存在账号下的 `Yungan Music` 文件夹，收藏和最近播放保存在该文件夹里的 `library-state.json`。电脑、Android 和网页端使用同一个 Google Cloud 项目的 OAuth 配置，再登录同一个 Google 账号，就能读取同一份曲库。

## 这台电脑已完成的配置

Google Cloud 项目为 `Yungan Music`，项目 ID 为 `yungan-music`。Drive API 已启用，应用保持外部用户 / 测试状态，指定的 Google 账号已加入测试用户；Windows、Web 和 Android 客户端均已创建。

**这台 PC 直接点击“使用 Google 账号登录”即可，不需要再次导入 JSON。** 桌面客户端配置已加密保存在本机应用数据中。退出登录保留客户端配置，清除账号授权；正常更新不用重新导入。换电脑或清空应用数据后，再导入桌面上的备份文件 `C:\Users\lyr14\Desktop\云感音乐-Google登录配置.json`。项目内另有本机备份 `.local/google-oauth/云感音乐-Windows.json`，不随安装包分发。

网页构建已预设公开的 Web 客户端 ID，来源 `http://localhost:3066` 和 `http://localhost:3000` 已在 Google 登记。重新打开网页可直接登录，无需填写 JSON。Android 根据包名和签名证书识别应用，不需要导入 JSON。

已验证 Windows 的真实 Google 授权与 Drive 账号查询；网页已进入 `Yungan Music` 目录并播放《梦境》，音频时长约 2 分 10 秒，播放进度正常增长。

## 先配置一个 Google Cloud 项目

登录按钮现在可以直接点击：尚未配置时，它会打开 Google 官方设置页面，同时在音乐应用里展开首次连接步骤。可以当场登录 Google 并创建应用配置；已有配置可以直接导入或粘贴。仅登录 Google 网页不会自动授予云感音乐读取 Drive 的权限，Google OAuth 仍要求一个真实的应用客户端 ID，不能用解除按钮禁用来代替它。

1. 打开 [Google Cloud 控制台](https://console.cloud.google.com/)，创建一个项目，例如 `Yungan Music`。
2. 在“API 和服务 → 库”中搜索 **Google Drive API**，启用它。
3. 打开 **Google Auth Platform**，完成应用名称、支持邮箱和开发者联系邮箱的配置。个人 Google 账号选择 External / 外部用户。
4. 在 Audience / 目标对象中，把自己要登录的 Google 邮箱加入测试用户。
5. 在 Data Access / 数据访问中加入两个权限：`https://www.googleapis.com/auth/drive.readonly` 和 `https://www.googleapis.com/auth/drive.file`。
6. 按下面需要使用的平台创建 OAuth 客户端。各平台客户端放在这个相同的项目中。

应用通过 Google 的授权窗口连接账号。`drive.readonly` 用于查看账号中的目录、读取已有音乐；`drive.file` 用于创建和更新应用自己的上传曲库与播放记录。授权界面会说明只读权限可读取 Drive 中的所有文件；应用只展示文件夹和支持的音乐格式，不修改已有目录里的歌曲。请完整授予这两个权限，缺少任何一个时无法完成登录。

Google 将 `drive.readonly` 列为 Restricted / 受限权限。个人使用先保持项目的 Testing / 测试状态，并将自己的账号加入测试用户；对外发布时按照 Google 要求完成相应的权限验证。权限范围见 [Google 官方说明](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## Windows 电脑端：先做这一项就能用

1. 在 Google Auth Platform → Clients / 客户端中，创建 **Desktop app / 桌面应用** 客户端。
2. 下载客户端的 JSON 配置。文件包含一个 `installed` 对象；网页版的 `web` 配置不能替代它。
3. 启动云感音乐，在登录页点击 **已有配置？导入并登录**，选择这个 JSON。也可以打开 **首次连接设置**，粘贴完整的桌面客户端 JSON，点击 **保存配置并登录**。
4. 导入成功后，应用立即打开系统浏览器，选择 Google 账号并完整授权目录读取和应用曲库保存权限。以后直接点击 **使用 Google 账号登录**。
5. 浏览器显示“Google 账号已连接”后，返回云感音乐。
6. 返回后显示 **我的云盘**。点击音乐文件夹进入目录，继续打开子文件夹，在下方歌曲列表点击一首音乐播放。顶部路径可返回上级目录，“播放全部”播放当前筛选出的音乐。
7. 若需要把电脑里的音乐存到云盘，点击 **上传音乐**，可以一次选择多首歌曲，应用会切换到 `Yungan Music` 上传目录。之后直接从 Google Drive 播放。

本机会按已经验证的 Google 账号记住上次浏览的目录，再次登录后恢复；目录删除或失去访问权限时返回“我的云盘”。切换目录不改变正在播放的队列。收藏与最近播放在当前目录中筛选，账号之间的记录与目录互相隔离。旧 NAS 登录缓存不能进入曲库，入口已改为仅 Google 登录。

客户端 JSON 只在首次配置时导入，不是每次登录要填写的账号资料。Google 密码始终在 Google 官方页面输入，JSON 不包含你的 Google 账号密码。

桌面端使用 PKCE 和本机 `127.0.0.1` 回调，长期授权由 Electron `safeStorage` 加密保存，访问令牌自动刷新。配置和授权存放在 Electron 应用用户目录下的 `google-account.bin`，不会写进歌曲文件或 `library-state.json`。退出登录会清除本机授权，保留 Drive 中的歌曲。实现依据见 [Google 桌面授权文档](https://developers.google.com/identity/protocols/oauth2/native-app)。

开发启动命令：

```powershell
Set-Location D:\workspaces\music
. .\use-node22.ps1
npm run electron:dev
```

## Android 端

1. 在同一个项目中创建 **Android** OAuth 客户端。
2. 包名填 `com.music.player`。
3. 填入 APK 实际签名证书的 SHA-1。可以在配置好 JDK 和 Android SDK 后，从项目的 `android` 目录运行：

   ```powershell
   .\gradlew.bat --init-script mirror-init.gradle :app:signingReport
   ```

4. 当前 `app/build.gradle` 的 release 使用 debug 签名；如果改成正式签名或使用 Play App Signing，需要在控制台登记对应证书的 SHA-1。
5. 构建并安装更新后的 APK，在应用里点击 **使用 Google 账号登录**，授权后进入 Drive 音乐目录。手机需要可用的 Google Play 服务。

Android 使用 Google Identity Services 的原生 `AuthorizationClient`，通过设备账号授权；不需要把桌面 JSON 放到手机。访问令牌保留在内存中，由 Google Play 服务续取。ExoPlayer 用 Authorization 请求头读取 Drive 音频，支持后台播放和拖动进度。原生授权接口见 [Android 官方指南](https://developer.android.com/identity/authorization)。

当前 Android 客户端登记的包名为 `com.music.player`，签名 SHA-1 为 `15:53:C1:65:C8:C8:5B:AB:F0:42:F1:BF:B8:5E:72:09:5A:01:C2:0F`。本机签名文件为 `C:\Users\lyr14\.android\debug.keystore`，后续构建继续使用该文件；更换签名后需重新登记 Google Android 客户端。

本机已安装 Android SDK API 36、Build Tools 36.0.0 和 Platform Tools，路径为 `D:\workspaces\music\.local\android-sdk`，JDK 为 `D:\android studio\jbr`。`build-android.ps1` 会检查环境并同步本机 `local.properties`。原有 `release/android` 中的 2.0 / 2.1 APK 是旧版本，不包含新的 Google 入口。

新版安装包为 `release/android/Yungan-Music-Android-3.0.0.apk`，通用文件名 `Yungan-Music-Android-debug.apk` 也已同步到新版。包名、版本号和 APK 签名已验证，与 Google 登记的 Android SHA-1 相符。旧 2.1 APK 使用另一张签名证书，无法直接覆盖安装；如果手机装的是旧 2.1，请先保存需要的本机数据，再卸载旧版安装新版。当前没有连接 Android 手机，真机 Google 登录和后台播放尚未验证。

## 网页端

1. 在同一个项目中创建 **Web application / Web 应用** OAuth 客户端。
2. 在 Authorized JavaScript origins / 已授权 JavaScript 来源中加入当前网页来源。开发服务为 `http://localhost:3000`，当前静态预览为 `http://localhost:3066`；正式部署时加入实际的 HTTPS 网站来源。首次连接设置会显示当前来源。
3. 可以直接在网页的 **首次连接设置** 中粘贴 Web 客户端 ID 或包含 `web` 对象的完整 JSON，点击 **保存配置**，再点击 **使用 Google 账号登录**。网页只记住公开的客户端 ID，不保存 JSON 中的客户端密钥，也不保存 Google 访问令牌。此方法无需重新构建。
4. 如果需要让部署后的网页预设客户端 ID，复制项目中的 `.env.example` 为 `.env.local`，填入：

   ```dotenv
   NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID=你的Web客户端ID.apps.googleusercontent.com
   ```

5. 使用环境变量预设时，重启开发服务或重新构建，再用浏览器打开应用；登录页中手动保存的客户端 ID 优先用于当前浏览器。

当前静态预览地址为 `http://localhost:3066`，需要使用此预览登录时，也将该来源加入已授权 JavaScript 来源。仅设置环境变量不会改变已经导出的网页，必须重新构建。

网页端通过 Google Identity Services 获取短期授权。访问令牌仅存在内存，刷新页面或授权过期后点击“重新连接”。浏览器会先读取当前歌曲的音频，再播放；桌面和 Android 端使用带授权的音频流。网页授权方式见 [Google 官方文档](https://developers.google.com/identity/oauth2/web/guides/use-token-model)。

## 迁移、同步和使用范围

- 已有 Drive 音乐：登录验证后打开原有的音乐文件夹，直接选歌播放。每个目录只列出当前层的歌曲和子文件夹，点击子文件夹继续浏览。
- NAS 音乐：复制到电脑后，通过应用的“上传音乐”保存到 `Yungan Music` 目录。应用不会把上传或播放记录写入你浏览的其他目录。
- 收藏和最近播放在修改时保存到 Drive。另一台设备登录或点击“刷新曲库”可读取最新记录。离线或授权失效时，修改会保留在本机，重新连接后尝试同步。
- 同一账号多台设备同时修改记录时，以最后一次成功保存的内容为准。当前没有并发编辑合并。
- 上传使用分块可续传协议，同一次上传中的网络中断会探测已收到的位置并重试；关闭应用后的上传任务需要重新选择文件。
- 上传和存储保留原始音频，播放能力取决于设备的音频解码器，应用当前不提供转码。
- 空间用量读取 Google Drive 返回的账号用量；容量不足时会显示错误。音乐数量通过分页读取，没有旧 NAS 入口的 500 首限制。
- 每次启动都需要经过 Google 登录入口；长期授权只用于播放期间刷新访问令牌，不从本机保存的会话直接打开目录。

## 常见配置问题

| 现象 | 处理 |
| --- | --- |
| 新电脑要求首次连接配置 | 导入 Desktop app 客户端 JSON 一次，以后直接登录 |
| 网页显示首次连接配置 | 使用已预设客户端 ID 的新构建，或在连接设置保存 Web 客户端 ID 一次 |
| `origin_mismatch` | 检查网页来源的协议、域名和端口是否与控制台完全一致 |
| Google 提示应用无权访问 | 检查当前邮箱是否在测试用户中，以及是否声明并完整授权 `drive.readonly` 和 `drive.file` |
| 上次的目录无法访问 | 应用会返回“我的云盘”，重新选择仍可访问的音乐目录 |
| 只看到当前目录的歌曲 | 点击子文件夹继续浏览；应用不递归展开所有目录 |
| Drive API 未启用 | 在客户端所属的同一个 Google Cloud 项目中启用 Google Drive API |
| Android 授权失败 | 检查 Google Play 服务、包名、实际签名 SHA-1 和网络 |
| 手机与电脑曲库不同 | 检查登录邮箱，以及各端 OAuth 客户端是否在同一个项目中 |
| 收藏同步失败 | 点击“重新连接”，再点击“重试同步” |

## 验证

```powershell
. .\use-node22.ps1
npm test
npm run lint
npm run build
```

自动测试覆盖 Google 账号验证门禁、按账号恢复目录、失效目录回退、目录分页与只读浏览、拒绝部分授权、权限错误、授权刷新、上传中断续传和取消、状态写入顺序、桌面 PKCE / state 校验、凭据加密、账号切换隔离、音频 Range 请求，以及托盘控制和关闭 / 退出流程。Windows 真实授权与 Drive 账号查询、网页目录和实际音频播放已验证；Android 真机登录与后台播放仍需在连接了 Google Play 服务的手机上验证。

## 图标和后台播放

Windows 安装包、桌面快捷方式、任务栏和托盘使用同一套红色音乐图标。关闭 Windows 窗口会收起到托盘，继续保留播放；点击托盘图标恢复窗口，右键可播放 / 暂停、上一首、下一首以及退出应用。

Android 使用对应的桌面图标，包含圆形、自适应和 Android 13 起的主题图标资源；播放通知使用单色音乐图标。图标源文件为 `public/icon.svg`，修改后运行 `npm run icons` 生成各端所需尺寸。

打包命令：

```powershell
. .\use-node22.ps1
npm run electron:build
npm run android:build:ps
```

Windows 安装包输出到 `dist/Yungan-Music-Setup-1.0.0.exe`，Android debug APK 输出到 `android/app/build/outputs/apk/debug/app-debug.apk`。源码中的图标更新只有重新打包并安装后才会出现在设备上。
