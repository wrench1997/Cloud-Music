package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Validation shared by the native bridge, persisted tasks, and device-independent tests. */
final class NativeDownloadPolicy {
    static final int MAX_ENTRIES = 100;
    static final long MAX_JSON_BYTES = 8L * 1024 * 1024;
    private static final Set<String> YOUTUBE_HOSTS = new HashSet<>(Arrays.asList(
        "youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"));
    private static final Set<String> COVER_HOSTS = new HashSet<>(Arrays.asList("i.ytimg.com", "img.youtube.com",
        "i.scdn.co", "image-cdn-ak.spotifycdn.com", "image-cdn-fa.spotifycdn.com", "image-cdn.spotifycdn.com"));

    static String text(Object value, int limit) {
        return value instanceof String ? ((String) value).replaceAll("[\\p{Cntrl}]", " ").trim().substring(0,
            Math.min(limit, ((String) value).replaceAll("[\\p{Cntrl}]", " ").trim().length())) : "";
    }
    static URI officialUri(String value) throws IOException {
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getPort() != -1) throw new IOException("仅支持官方 HTTPS 链接。");
            return uri;
        } catch (Exception error) { throw new IOException("请使用有效的官方 HTTPS 链接。", error); }
    }
    static String query(URI uri, String name) {
        String value = uri.getRawQuery();
        if (value == null) return "";
        for (String part : value.split("&")) {
            String[] pair = part.split("=", 2);
            if (pair[0].equals(name) && pair.length == 2) {
                try { return java.net.URLDecoder.decode(pair[1], "UTF-8"); } catch (Exception ignored) { return ""; }
            }
        }
        return "";
    }
    static String videoId(String value) throws IOException {
        URI uri = officialUri(value);
        if (!YOUTUBE_HOSTS.contains(uri.getHost())) throw new IOException("请为每首歌选择 YouTube 音源。");
        String id = "youtu.be".equals(uri.getHost()) ? uri.getPath().substring(1) : query(uri, "v");
        if (!id.matches("[A-Za-z0-9_-]{11}") || (!"youtu.be".equals(uri.getHost()) && !"/watch".equals(uri.getPath()))) throw new IOException("请选择一个有效的 YouTube 单曲链接。");
        return id;
    }
    static JSONObject source(String value) throws Exception {
        URI uri = officialUri(value);
        if ("open.spotify.com".equals(uri.getHost())) {
            java.util.regex.Matcher match = java.util.regex.Pattern.compile("^/(?:intl-[a-zA-Z-]+/)?(?:embed/)?playlist/([A-Za-z0-9]{22})/?$").matcher(uri.getPath());
            if (!match.matches()) throw new IOException("请使用 Spotify 公开歌单链接。");
            return new JSONObject().put("provider", "spotify").put("url", "https://open.spotify.com/embed/playlist/" + match.group(1));
        }
        if (YOUTUBE_HOSTS.contains(uri.getHost())) {
            String list = query(uri, "list");
            if (list.matches("[A-Za-z0-9_-]{10,200}")) return new JSONObject().put("provider", "youtube").put("url", "https://www.youtube.com/playlist?list=" + list);
            return new JSONObject().put("provider", "youtube").put("url", "https://www.youtube.com/watch?v=" + videoId(value));
        }
        throw new IOException("仅支持 YouTube 和 Spotify 歌单。");
    }
    static int integer(JSONObject data, String key, int fallback, int max) throws IOException {
        Object value = data.opt(key);
        if (value == null) return fallback;
        if (!(value instanceof Number) || ((Number) value).doubleValue() != ((Number) value).intValue()
            || ((Number) value).intValue() < 1 || ((Number) value).intValue() > max) throw new IOException("无效的 " + key + " 参数。");
        return ((Number) value).intValue();
    }
    static JSONObject radio(JSONObject data) throws Exception {
        String id = data.optString("videoId", "");
        String list = data.optString("radioId", "RDAMVM" + id);
        if (!id.matches("[A-Za-z0-9_-]{11}") || (!list.equals("RD" + id) && !list.equals("RDAMVM" + id))) throw new IOException("请选择这首歌对应的 YouTube 歌曲电台。");
        int page = integer(data, "page", 1, 5), limit = integer(data, "limit", 12, 20);
        return new JSONObject().put("videoId", id).put("radioId", list).put("page", page).put("limit", limit)
            .put("url", (list.startsWith("RDAMVM") ? "https://music.youtube.com" : "https://www.youtube.com") + "/watch?v=" + id + "&list=" + list);
    }
    static String cover(Object value) {
        try { URI uri = officialUri(text(value, 2000)); return COVER_HOSTS.contains(uri.getHost()) ? uri.toString() : ""; }
        catch (IOException ignored) { return ""; }
    }
    static String artist(Object value) {
        if (!(value instanceof JSONArray)) return text(value, 300);
        JSONArray values = (JSONArray) value;
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < values.length() && i < 20; i++) {
            Object item = values.opt(i); String name = text(item instanceof JSONObject ? ((JSONObject) item).opt("name") : item, 100);
            if (!name.isEmpty()) { if (result.length() > 0) result.append(", "); result.append(name); }
        }
        return text(result.toString(), 300);
    }
    static JSONObject track(JSONObject entry, String url) throws Exception {
        String spotify = text(entry.opt("spotifyId"), 22);
        if (!spotify.matches("[A-Za-z0-9]{22}")) {
            String uri = entry.optString("uri", "");
            if (uri.matches("spotify:track:[A-Za-z0-9]{22}")) spotify = uri.substring(14); else spotify = "";
        }
        JSONObject result = new JSONObject().put("title", text(entry.opt("title"), 300)).put("artist", artist(entry.has("artist") ? entry.opt("artist") : entry.opt("artists")))
            .put("album", entry.opt("album") instanceof JSONObject ? text(entry.optJSONObject("album").opt("name"), 300) : text(entry.opt("album"), 300))
            .put("duration", Math.max(0, Math.min(86400, entry.optDouble("duration", 0))))
            .put("coverUrl", cover(entry.opt("coverUrl"))).put("metadataProvider", !spotify.isEmpty() || "spotify".equals(entry.optString("metadataProvider")) ? "spotify" : "youtube");
        if (url != null && !url.isEmpty()) result.put("url", url);
        if (!spotify.isEmpty()) result.put("spotifyId", spotify);
        return result;
    }
    static JSONObject downloadMetadata(JSONObject source, JSONObject info, String url) throws Exception {
        boolean preserve = "spotify".equals(source.optString("metadataProvider")) || source.optBoolean("preserveMetadata", false);
        JSONObject result = new JSONObject(source.toString());
        String title = source.optString("title", "");
        String musicTitle = text(info.opt("track"), 300);
        String variants = "\\b(?:slowed|slow|sped|remix|live|acoustic|instrumental|nightcore|super|ultra)\\b";
        if (!preserve && !musicTitle.isEmpty() && !java.util.regex.Pattern.compile(variants, java.util.regex.Pattern.CASE_INSENSITIVE).matcher(title).find()) title = musicTitle;
        if (title.isEmpty()) title = text(info.opt("title"), 300);
        String artist = artist(info.has("artist") ? info.opt("artist") : info.opt("artists"));
        if (preserve && !source.optString("artist").isEmpty()) artist = source.optString("artist");
        if (artist.isEmpty()) artist = source.optString("artist", text(info.opt("uploader"), 300));
        String cover = source.optString("coverUrl", "");
        if (cover.isEmpty()) cover = cover(info.opt("thumbnail"));
        if (cover.isEmpty()) cover = "https://i.ytimg.com/vi/" + videoId(url) + "/hqdefault.jpg";
        double actualDuration = info.optDouble("duration", 0), previousDuration = source.optDouble("duration", 0);
        double duration = Double.isFinite(actualDuration) && actualDuration > 0 ? actualDuration
            : Double.isFinite(previousDuration) && previousDuration > 0 ? previousDuration : 0;
        return result.put("title", title.isEmpty() ? "歌曲" : title).put("artist", artist)
            .put("album", source.optString("album").isEmpty() ? info.optString("album", "") : source.optString("album"))
            .put("duration", duration).put("sourceUrl", url).put("coverUrl", cover);
    }
    static String safeName(String value) {
        String clean = text(value, 240).replaceAll("[<>:\"/\\\\|?*]", "_").replaceAll("[. ]+$", "");
        return truncateUtf8(clean, 150);
    }
    static String truncateUtf8(String value, int maxBytes) {
        StringBuilder result = new StringBuilder(); int bytes = 0;
        for (int at = 0; at < value.length();) {
            int cp = value.codePointAt(at); String item = new String(Character.toChars(cp)); int count = item.getBytes(StandardCharsets.UTF_8).length;
            if (bytes + count > maxBytes) break;
            result.append(item); bytes += count; at += Character.charCount(cp);
        }
        return result.toString();
    }
    static File child(File root, String name) throws IOException {
        if (name == null || name.isEmpty() || name.contains("/") || name.contains("\\") || name.equals(".") || name.equals("..")) throw new IOException("无效的音乐文件路径。");
        File target = new File(root, name).getCanonicalFile();
        if (!target.getParentFile().equals(root.getCanonicalFile())) throw new IOException("音乐文件路径超出保存目录。");
        return target;
    }
    static JSONObject cloud(JSONObject input) throws Exception {
        boolean enabled = input != null && input.optBoolean("enabled", false);
        String account = input == null ? "" : text(input.opt("accountId"), 150);
        String email = input == null ? "" : text(input.opt("email"), 254).toLowerCase(java.util.Locale.ROOT);
        if (enabled && (!account.matches("[A-Za-z0-9_-]{1,150}") || !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))) throw new IOException("请先连接并确认要上传的 Google 账号。");
        return new JSONObject().put("enabled", enabled).put("accountId", account).put("email", email).put("state", enabled ? "pending" : "disabled");
    }
    static void requireRestartIdle(String id, String activeId, boolean cancelled, String state) throws IOException {
        if (id.equals(activeId) && (cancelled || !"running".equals(state))) throw new IOException("任务正在停止，请稍候重试；已下载 MP3 保留。");
    }
    static boolean mustProbeSession(boolean persistedSession, long offset) { return persistedSession || offset > 0; }
}
