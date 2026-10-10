package com.music.player;

import org.json.JSONObject;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Only public platform pages may be fetched. Kept in sync with music-catalog.js. */
final class NativeMusicCatalog {
    static JSONObject options(JSONObject value) throws Exception {
        String provider = value.optString("provider"), kind = value.optString("kind");
        if (!"spotify".equals(provider) && !"youtube".equals(provider)) throw new IOException("请选择 Spotify 或 YouTube Music。");
        int page = NativeDownloadPolicy.integer(value, "page", 1, 5), limit = 12;
        String requestUrl;
        if (value.has("url")) {
            URI url = new URI(value.getString("url"));
            if (!"https".equals(url.getScheme()) || url.getUserInfo() != null || url.getPort() != -1) throw new IOException("请使用官方 HTTPS 分享链接。");
            String host = url.getHost(), path = url.getPath();
            if ("spotify".equals(provider)) {
                if (!"open.spotify.com".equals(host)) throw new IOException("请使用 Spotify 分享链接。");
                Matcher match = Pattern.compile("^/(?:intl-[a-zA-Z-]+/)?(?:embed/)?(artist|album|track)/([A-Za-z0-9]{22})/?$").matcher(path);
                if (!match.matches() || (!kind.isEmpty() && !kind.equals(match.group(1)))) throw new IOException("请使用 Spotify 歌手、专辑或单曲链接。");
                kind = match.group(1);
                requestUrl = "https://open.spotify.com/" + ("artist".equals(kind) ? "" : "embed/") + kind + "/" + match.group(2);
            } else {
                if (!"music.youtube.com".equals(host) && !"www.youtube.com".equals(host) && !"youtube.com".equals(host) && !"m.youtube.com".equals(host)) throw new IOException("请使用 YouTube Music 分享链接。");
                Matcher artist = Pattern.compile("^/(?:channel/|browse/)(UC[A-Za-z0-9_-]{22})(?:/(?:videos|releases))?/?$").matcher(path);
                Matcher handle = Pattern.compile("^/(@[\\p{L}\\p{N}_.-]{1,100})(?:/(?:videos|releases))?/?$").matcher(path);
                Matcher album = Pattern.compile("^/browse/(MPREb_[A-Za-z0-9_-]{5,200})/?$").matcher(path);
                if (artist.matches() || handle.matches()) {
                    if (!kind.isEmpty() && !"artist".equals(kind)) throw new IOException("链接与内容类型不一致。");
                    kind = "artist";
                    requestUrl = "https://www.youtube.com/" + (artist.matches() ? "channel/" + artist.group(1) : handle.group(1)) + "/videos";
                } else if (album.matches()) {
                    if (!kind.isEmpty() && !"album".equals(kind)) throw new IOException("链接与内容类型不一致。");
                    kind = "album"; requestUrl = "https://music.youtube.com/browse/" + album.group(1);
                } else if ("/playlist".equals(path) || "/watch".equals(path)) {
                    String list = NativeDownloadPolicy.query(url, "list");
                    if (list == null || !list.matches("[A-Za-z0-9_-]{10,200}") || (!kind.isEmpty() && !"album".equals(kind))) throw new IOException("请使用 YouTube Music 专辑链接。");
                    kind = "album"; requestUrl = "https://music.youtube.com/playlist?list=" + list;
                } else throw new IOException("请使用 YouTube Music 歌手或专辑链接。");
            }
            if ("album".equals(kind)) limit = 100;
        } else if ("new".equals(kind)) {
            String query = value.has("query") ? query(value) : "new music official audio";
            requestUrl = "spotify".equals(provider) ? "https://open.spotify.com/embed/playlist/37i9dQZF1DX4JAvHpjipBk"
                : "https://www.youtube.com/results?search_query=" + encode(query) + "&sp=CAISBAgDEAE%3D";
        } else {
            if (!"youtube".equals(provider) || (!"artists".equals(kind) && !"albums".equals(kind) && !"songs".equals(kind))) throw new IOException("请粘贴 Spotify 分享链接，或使用 YouTube Music 搜索。");
            requestUrl = "artists".equals(kind) ? "https://www.youtube.com/results?search_query=" + encode(query(value)) + "&sp=EgIQAg%3D%3D"
                : "https://music.youtube.com/search?q=" + encode(query(value)) + "#" + kind;
        }
        return new JSONObject().put("provider", provider).put("kind", kind).put("requestUrl", requestUrl).put("page", page).put("limit", limit);
    }
    private static String query(JSONObject value) throws Exception {
        if (!(value.opt("query") instanceof String) || value.getString("query").length() > 300) throw new IOException("请输入 1 至 300 个字符的歌手或专辑名称。");
        String query = NativeDownloadPolicy.text(value.opt("query"), 300);
        if (query.isEmpty()) throw new IOException("请输入歌手或专辑名称。");
        return query;
    }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20"); }
}
