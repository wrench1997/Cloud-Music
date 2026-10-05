# Windows 本机歌曲缓存

Windows 在第一次播放或选择“保存到本机曲库”时，使用当前 Google 账号读取完整的 Drive 音频，并保留一个本机副本。后续从“本机音乐”播放这份副本，不需要重新下载，也不需要连接 Google。退出应用再打开后，本机曲库仍然保留。

本机副本保存标题、歌手、专辑、时长、来源和封面；封面优先从 MP3 的 ID3 图片读取，否则尝试保存 Drive 缩略图。原本没有封面的歌曲会使用应用的默认封面。

右键移除本机副本只清理 Windows 应用自己的缓存，Google Drive 上的原文件保留。不同 Google 账号下的同一个 Drive 文件分别保存，并记录原账号；切换账号不会把两个账号的云文件混在一起。

开发接线：

- 主进程 `createMusicCache` 保存在 `app.getPath('userData')/music-cache-v1`，通过 `googleAuth.cacheIdentity` 和 `googleAuth.cacheSource` 获取已核验账号及完整音频。
- `electronAPI.musicCache.list()` 返回 `{ songs }`，`cache({ fileId, accountId? })` 返回完整本机歌曲，`remove({ cacheId })` 只删除该本机副本。
- 本机歌曲的 `id` 为 `cache:<SHA256>`，并单独保留 `driveFileId`、`originalAccount`、`localUri` 和 `coverUrl`。播放云曲目时可以保留原 Drive ID，并附加这些缓存字段。
- `localUri` 和 `coverUrl` 是动态端口、随机能力标识的本机 HTTP 地址，支持音频 Range/HEAD。重开后应重新 `list()` 获取地址，不应持久化旧地址。
- 云盘令牌只在主进程向受限 Drive API 发请求时使用，不写入缓存元数据或本机地址。MP3 音频和缓存元数据写完后通过目录重命名提交，失败和未完成文件不会进入曲库。
- 手工下载服务已完成的文件仍在 `Download/Yungan Music`；本缓存接口不接受任意外部路径。已上传到 Drive 的下载文件可按其 Drive ID 建立本机副本。

实现验证覆盖离线重开、封面、进度定位、并发去重、账号隔离、失败重试和本机删除的边界。
