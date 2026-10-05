package com.music.player;

import android.content.Context;
import android.system.Os;
import android.system.OsConstants;
import org.json.JSONArray;
import org.json.JSONObject;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import com.yausername.ffmpeg.FFmpeg;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Native programs are executed from APK-installed nativeLibraryDir, never writable assets. */
final class NativeDownloadsYtdlpEngine implements NativeDownloadEngine {
    private final Context context;
    private boolean ready;
    private final Map<String, Process> conversions = Collections.synchronizedMap(new HashMap<>());
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, JSONObject> radioCache = Collections.synchronizedMap(new java.util.LinkedHashMap<>());
    private final Map<String, Long> radioExpiry = Collections.synchronizedMap(new HashMap<>());
    NativeDownloadsYtdlpEngine(Context context) { this.context = context.getApplicationContext(); }
    @Override public synchronized void initialize() throws Exception {
        if (ready) return;
        if (Os.sysconf(OsConstants._SC_PAGESIZE) > 4096) throw new IOException("当前内置转换组件暂不支持此设备的 16 KB 内存页；已保留原有音乐。");
        YoutubeDL.getInstance().init(context);
        FFmpeg.getInstance().init(context);
        synchronizeBundledExtractor();
        File programs = new File(context.getApplicationInfo().nativeLibraryDir);
        for (String name : new String[]{"libpython.so", "libffmpeg.so", "libqjs.so"}) {
            if (!new File(programs, name).isFile()) throw new IOException("内置下载组件不完整，请更新应用。");
        }
        ready = true;
    }
    private void synchronizeBundledExtractor() throws Exception {
        int resource = context.getResources().getIdentifier("ytdlp", "raw", context.getPackageName());
        if (resource == 0) throw new IOException("应用缺少内置音源提取器，请重新安装正式更新包。");
        File directory = new File(context.getNoBackupFilesDir(), "youtubedl-android/yt-dlp");
        File target = NativeDownloadPolicy.child(directory, "yt-dlp"), temporary = NativeDownloadPolicy.child(directory, "yt-dlp.bundled.tmp");
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        try (InputStream input = context.getResources().openRawResource(resource); FileOutputStream out = new FileOutputStream(temporary)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) { out.write(buffer, 0, count); digest.update(buffer, 0, count); }
            out.getFD().sync();
        }
        StringBuilder hash = new StringBuilder(); for (byte b : digest.digest()) hash.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        android.content.SharedPreferences versions = context.getSharedPreferences("native-media-engine", Context.MODE_PRIVATE);
        if (!hash.toString().equals(versions.getString("bundledSha256", "")) || !target.isFile()) {
            if (!temporary.renameTo(target)) { temporary.delete(); throw new IOException("无法更新应用内置音源提取器。"); }
            versions.edit().putString("bundledSha256", hash.toString()).apply();
        } else temporary.delete();
    }
    private YoutubeDLRequest request(String url) {
        return new YoutubeDLRequest(url).addOption("--ignore-config").addOption("--no-warnings")
            .addOption("--socket-timeout", "30").addOption("--retries", "2").addOption("--fragment-retries", "2")
            .addOption("--encoding", "utf-8");
    }
    private String execute(YoutubeDLRequest request, String id, long timeout, Progress progress) throws Exception {
        initialize();
        ScheduledFuture<?> deadline = timers.schedule(() -> cancel(id), timeout, TimeUnit.MILLISECONDS);
        try {
            YoutubeDLResponse result = YoutubeDL.getInstance().execute(request, id, false, (percent, remaining, line) -> {
                if (progress != null) progress.update("download", Math.max(0, Math.min(95, Math.round(percent))));
                return kotlin.Unit.INSTANCE;
            });
            String output = result.getOut();
            if (output.getBytes(StandardCharsets.UTF_8).length > NativeDownloadPolicy.MAX_JSON_BYTES) throw new IOException("歌单返回内容过大。");
            return output;
        } finally { deadline.cancel(false); }
    }
    private JSONObject data(YoutubeDLRequest request) throws Exception {
        return new JSONObject(execute(request, "query-" + UUID.randomUUID(), 180000, null));
    }
    private JSONArray entries(JSONObject data) throws Exception {
        JSONArray rows = data.optJSONArray("entries"), result = new JSONArray();
        if (rows == null) rows = new JSONArray().put(data);
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < rows.length() && i < 101; i++) {
            JSONObject item = rows.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("id", "");
            if (!id.matches("[A-Za-z0-9_-]{11}") || !ids.add(id)) continue;
            String artist = NativeDownloadPolicy.artist(item.has("artist") ? item.opt("artist") : item.opt("artists"));
            boolean isChannel = artist.isEmpty();
            if (artist.isEmpty()) artist = NativeDownloadPolicy.text(item.opt("uploader"), 300);
            if (artist.isEmpty()) artist = NativeDownloadPolicy.text(item.opt("channel"), 300);
            String cover = NativeDownloadPolicy.cover(item.opt("thumbnail"));
            JSONArray thumbnails = item.optJSONArray("thumbnails");
            if (cover.isEmpty() && thumbnails != null) for (int n = thumbnails.length() - 1; n >= 0; n--) {
                JSONObject thumb = thumbnails.optJSONObject(n);
                if (thumb != null) cover = NativeDownloadPolicy.cover(thumb.opt("url"));
                if (!cover.isEmpty()) break;
            }
            if (cover.isEmpty()) cover = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
            JSONObject track = NativeDownloadPolicy.track(new JSONObject().put("title", item.optString("track", item.optString("title", id)))
                .put("artist", artist).put("album", item.optString("album", "")).put("duration", item.optDouble("duration", 0)).put("coverUrl", cover), "https://www.youtube.com/watch?v=" + id);
            track.put("artistIsChannel", isChannel); result.put(track);
        }
        return result;
    }
    private JSONObject spotifyEntity(String html) throws Exception {
        Matcher match = Pattern.compile("<script[^>]*id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>", Pattern.DOTALL).matcher(html);
        if (!match.find()) throw new IOException("Spotify 没有返回公开曲目信息，请确认分享链接。");
        JSONObject value = new JSONObject(match.group(1));
        for (String key : new String[]{"props", "pageProps", "state", "data", "entity"}) {
            value = value.optJSONObject(key); if (value == null) throw new IOException("Spotify 公开页面格式已变化，请稍后更新应用。");
        }
        return value;
    }
    private byte[] fetch(String address, long max) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) YunganMusic");
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IOException("公开音源服务返回 " + status + "，请检查网络或换一个音源。");
            if (connection.getContentLengthLong() > max) throw new IOException("返回文件过大。");
            try (InputStream input = connection.getInputStream(); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > max) throw new IOException("返回文件过大。"); }
                return out.toByteArray();
            }
        } finally { connection.disconnect(); }
    }
    @Override public JSONObject inspect(String url) throws Exception {
        JSONObject source = NativeDownloadPolicy.source(url);
        if ("spotify".equals(source.getString("provider"))) {
            JSONObject entity = spotifyEntity(new String(fetch(source.getString("url"), NativeDownloadPolicy.MAX_JSON_BYTES), StandardCharsets.UTF_8));
            JSONArray rows = entity.optJSONArray("trackList"), tracks = new JSONArray();
            if (rows != null) for (int i = 0; i < rows.length() && i < 100; i++) {
                JSONObject item = rows.optJSONObject(i);
                if (item == null || item.optString("title").isEmpty() || item.optString("subtitle").isEmpty()) continue;
                JSONObject track = NativeDownloadPolicy.track(new JSONObject(item.toString()).put("artist", item.optString("subtitle")).put("duration", item.optDouble("duration", 0) / 1000), null);
                track.put("search", track.getString("artist") + " " + track.getString("title") + " official audio"); tracks.put(track);
            }
            if (tracks.length() == 0) throw new IOException("此 Spotify 歌单没有可读取曲目，可能是私密歌单。");
            return new JSONObject().put("provider", "spotify").put("title", entity.optString("name", entity.optString("title", "Spotify 歌单"))).put("entries", tracks)
                .put("notice", "读取公开页面可见曲目（最多 100 首），下载时使用你选中的 YouTube 音源。");
        }
        JSONObject data = data(request(source.getString("url")).addOption("--flat-playlist").addOption("--dump-single-json").addOption("--skip-download").addOption("--playlist-end", "100"));
        return new JSONObject().put("provider", "youtube").put("title", data.optString("title", "YouTube 歌单")).put("entries", entries(data));
    }
    @Override public JSONObject search(JSONObject value) throws Exception {
        String query = NativeDownloadPolicy.text(value.opt("query"), 301);
        if (query.isEmpty() || query.length() > 300) throw new IOException("请输入 1 至 300 个字符的歌曲或歌手名称。");
        int page = NativeDownloadPolicy.integer(value, "page", 1, 5), limit = NativeDownloadPolicy.integer(value, "limit", 12, 20);
        int end = page * limit + 1, start = (page - 1) * limit + 1;
        JSONObject data = data(request("ytsearch" + end + ":" + query).addOption("--flat-playlist").addOption("--dump-single-json").addOption("--skip-download")
            .addOption("--playlist-start", String.valueOf(start)).addOption("--playlist-end", String.valueOf(end)));
        JSONArray tracks = entries(data), visible = new JSONArray();
        for (int i = 0; i < tracks.length() && i < limit; i++) visible.put(tracks.get(i));
        return new JSONObject().put("provider", "youtube").put("query", query).put("page", page).put("hasMore", page < 5 && tracks.length() > limit).put("entries", visible);
    }
    @Override public JSONObject match(JSONObject value) throws Exception {
        String query = NativeDownloadPolicy.text(value.opt("search"), 301);
        if (query.isEmpty() || query.length() > 300) throw new IOException("无效的歌曲搜索。");
        JSONObject result = search(new JSONObject().put("query", query).put("limit", 3));
        return new JSONObject().put("entries", result.getJSONArray("entries"));
    }
    @Override public JSONObject radio(JSONObject value) throws Exception {
        JSONObject options = NativeDownloadPolicy.radio(value);
        String key = options.getString("radioId") + ":" + options.getInt("page") + ":" + options.getInt("limit");
        if (radioExpiry.getOrDefault(key, 0L) > System.currentTimeMillis() && radioCache.containsKey(key)) return new JSONObject(radioCache.get(key).toString());
        int page = options.getInt("page"), limit = options.getInt("limit");
        JSONObject data = data(request(options.getString("url")).addOption("--yes-playlist").addOption("--flat-playlist").addOption("--dump-single-json").addOption("--skip-download")
            .addOption("--playlist-start", String.valueOf((page - 1) * limit + 1)).addOption("--playlist-end", String.valueOf(page * limit + 1)));
        JSONArray tracks = entries(data), visible = new JSONArray();
        for (int i = 0; i < tracks.length() && i < limit; i++) visible.put(tracks.get(i));
        if (visible.length() == 0) throw new IOException("YouTube 暂未返回电台曲目，请换一首起点或重试。");
        JSONObject result = new JSONObject().put("provider", "youtube").put("recommendationProvider", "youtube-mix").put("radioId", options.getString("radioId"))
            .put("seedVideoId", options.getString("videoId")).put("title", data.optString("title", "YouTube 歌曲电台")).put("url", options.getString("url"))
            .put("page", page).put("hasMore", page < 5 && tracks.length() > limit).put("entries", visible).put("notice", "来自 YouTube 公开歌曲电台，可能与已登录账号的电台不同。");
        synchronized (radioCache) {
            radioCache.put(key, result); radioExpiry.put(key, System.currentTimeMillis() + 300000);
            while (radioCache.size() > 30) { String oldest = radioCache.keySet().iterator().next(); radioCache.remove(oldest); radioExpiry.remove(oldest); }
        }
        return new JSONObject(result.toString());
    }
    private JSONObject enrichSpotify(JSONObject source) {
        if (!"spotify".equals(source.optString("metadataProvider")) || !source.optString("spotifyId").matches("[A-Za-z0-9]{22}")) return source;
        try {
            JSONObject entity = spotifyEntity(new String(fetch("https://open.spotify.com/embed/track/" + source.getString("spotifyId"), NativeDownloadPolicy.MAX_JSON_BYTES), StandardCharsets.UTF_8));
            if (!("spotify:track:" + source.getString("spotifyId")).equals(entity.optString("uri"))) return source;
            JSONObject result = new JSONObject(source.toString());
            if (result.optString("artist").isEmpty()) result.put("artist", NativeDownloadPolicy.artist(entity.has("artists") ? entity.opt("artists") : entity.opt("authors")));
            if (result.optString("album").isEmpty()) result.put("album", entity.opt("album") instanceof JSONObject ? entity.getJSONObject("album").optString("name", "") : entity.optString("album", ""));
            JSONArray images = entity.optJSONObject("coverArt") == null ? null : entity.getJSONObject("coverArt").optJSONArray("sources");
            int width = -1; String best = "";
            if (images != null) for (int i = 0; i < images.length(); i++) {
                JSONObject image = images.optJSONObject(i); if (image == null) continue;
                String url = NativeDownloadPolicy.cover(image.opt("url"));
                if (!url.isEmpty() && image.optInt("width", 0) > width) { width = image.optInt("width", 0); best = url; }
            }
            if (result.optString("coverUrl").isEmpty() && !best.isEmpty()) result.put("coverUrl", best);
            return result;
        } catch (Exception ignored) { return source; }
    }
    private void ffmpeg(File input, File output, File cover, JSONObject metadata, String id, Cancelled cancelled) throws Exception {
        List<String> args = new ArrayList<>();
        args.add(new File(context.getApplicationInfo().nativeLibraryDir, "libffmpeg.so").getAbsolutePath());
        Collections.addAll(args, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input.getAbsolutePath());
        if (cover != null) Collections.addAll(args, "-i", cover.getAbsolutePath());
        Collections.addAll(args, "-map", "0:a:0", "-c:a", "libmp3lame", "-q:a", "0");
        if (cover != null) Collections.addAll(args, "-map", "1:v:0", "-c:v", "mjpeg", "-frames:v", "1", "-disposition:v", "attached_pic", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
        Collections.addAll(args, "-id3v2_version", "3", "-write_id3v1", "1");
        for (String key : new String[]{"title", "artist", "album"}) if (!metadata.optString(key).isEmpty()) Collections.addAll(args, "-metadata", key + "=" + metadata.optString(key));
        Collections.addAll(args, "-metadata", "comment=" + metadata.optString("sourceUrl"), output.getAbsolutePath());
        ProcessBuilder builder = new ProcessBuilder(args).redirectErrorStream(true);
        builder.environment().put("LD_LIBRARY_PATH", new File(context.getNoBackupFilesDir(), "youtubedl-android/packages/ffmpeg/usr/lib").getAbsolutePath());
        Process child = builder.start(); conversions.put(id, child);
        ScheduledFuture<?> deadline = timers.schedule(child::destroy, 180, TimeUnit.SECONDS);
        StringBuilder error = new StringBuilder();
        try (InputStream log = child.getInputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = log.read(buffer)) != -1) {
                error.append(new String(buffer, 0, count, StandardCharsets.UTF_8)); if (error.length() > 3000) error.delete(0, error.length() - 3000);
                if (cancelled.get()) { child.destroy(); throw new IOException("下载已取消。"); }
            }
            if (child.waitFor() != 0 || !output.isFile() || output.length() < 128) throw new IOException("MP3 转换失败：" + error);
            if (cancelled.get()) throw new IOException("下载已取消。");
        } finally { deadline.cancel(false); conversions.remove(id); child.destroy(); }
    }
    @Override public JSONObject download(JSONObject source, File directory, String processId, Progress progress, Cancelled cancelled) throws Exception {
        initialize(); String id = NativeDownloadPolicy.videoId(source.getString("url"));
        if (directory.getUsableSpace() < 64L * 1024 * 1024) throw new IOException("手机剩余空间不足，请至少保留 64 MB 空间。");
        YoutubeDLRequest request = request(source.getString("url")).addOption("--no-playlist").addOption("--write-info-json").addOption("--no-overwrites")
            .addOption("--format", "bestaudio[ext=m4a]/bestaudio/best").addOption("--hls-prefer-native").addOption("--max-filesize", "150M")
            .addOption("--match-filter", "!is_live & duration <= 3600").addOption("--output", new File(directory, "source-" + id + ".%(ext)s").getAbsolutePath());
        execute(request, processId, 20 * 60 * 1000L, progress);
        if (cancelled.get()) throw new IOException("下载已取消。");
        File infoFile = new File(directory, "source-" + id + ".info.json");
        JSONObject info = NativeDownloadStore.read(infoFile), metadata = NativeDownloadPolicy.downloadMetadata(enrichSpotify(source), info, source.getString("url"));
        File[] media = directory.listFiles(file -> file.isFile() && file.getName().startsWith("source-" + id + ".") && !file.getName().endsWith(".info.json") && !file.getName().endsWith(".part") && !file.getName().endsWith(".ytdl"));
        if (media == null || media.length != 1 || media[0].length() == 0) throw new IOException("音源未生成音频文件；直播、超过一小时或超过 150 MB 的音源请换一个版本。");
        File artwork = null; JSONArray warnings = new JSONArray();
        try {
            byte[] picture = fetch(metadata.getString("coverUrl"), 8 * 1024 * 1024);
            boolean jpeg = picture.length > 3 && (picture[0] & 255) == 255 && (picture[1] & 255) == 216;
            boolean png = picture.length > 8 && picture[0] == (byte) 137 && picture[1] == 80;
            boolean webp = picture.length > 12 && new String(picture, 0, 4, StandardCharsets.US_ASCII).equals("RIFF") && new String(picture, 8, 4, StandardCharsets.US_ASCII).equals("WEBP");
            if (!jpeg && !png && !webp) throw new IOException("封面不是有效图片。");
            artwork = NativeDownloadPolicy.child(directory, "art-" + id + (jpeg ? ".jpg" : png ? ".png" : ".webp"));
            try (FileOutputStream out = new FileOutputStream(artwork)) { out.write(picture); }
        } catch (Exception error) { artwork = null; warnings.put("封面暂未保存，可稍后重试。"); }
        progress.update("convert", 95);
        String display = NativeDownloadPolicy.safeName((metadata.optString("artist").isEmpty() ? "" : metadata.getString("artist") + " - ") + metadata.getString("title"));
        if (display.isEmpty()) display = "歌曲";
        String name = display + "-" + id + ".mp3";
        File output = NativeDownloadPolicy.child(directory, "convert-" + id + ".mp3"), complete = NativeDownloadPolicy.child(directory, name);
        try {
            try { ffmpeg(media[0], output, artwork, metadata, processId, cancelled); }
            catch (Exception error) {
                if (artwork == null || cancelled.get()) throw error;
                warnings.put("封面暂未嵌入，歌曲信息和音频已保留。"); artwork = null;
                ffmpeg(media[0], output, null, metadata, processId, cancelled);
            }
            if (cancelled.get()) throw new IOException("下载已取消。");
            if (complete.exists() && !complete.delete()) throw new IOException("无法更新本地音乐文件。");
            if (!output.renameTo(complete)) throw new IOException("无法保存已转换 MP3。");
            media[0].delete(); metadata.put("hasArtwork", artwork != null);
            JSONObject result = new JSONObject().put("name", name).put("displayName", display + ".mp3").put("size", complete.length()).put("metadata", metadata)
                .put("localUri", android.net.Uri.fromFile(complete).toString()).put("metadataWarnings", warnings);
            if (artwork != null) result.put("coverUri", android.net.Uri.fromFile(artwork).toString());
            return result;
        } finally { if (output.isFile()) output.delete(); }
    }
    @Override public void cancel(String processId) {
        YoutubeDL.getInstance().destroyProcessById(processId);
        Process conversion = conversions.get(processId); if (conversion != null) conversion.destroy();
    }
}
