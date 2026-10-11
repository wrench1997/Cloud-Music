package com.music.player;

import org.json.JSONObject;
import org.json.JSONArray;
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
        JSONArray artistRequestUrls = null;
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
                    String artistUrl = "https://www.youtube.com/" + (artist.matches() ? "channel/" + artist.group(1) : "@" + encode(handle.group(1).substring(1)));
                    requestUrl = artistUrl + "/releases";
                    artistRequestUrls = new JSONArray().put(requestUrl).put(artistUrl + "/videos").put(artistUrl);
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
            requestUrl = "https://music.youtube.com/search?q=" + encode(query(value)) + "#" + kind;
        }
        JSONObject options = new JSONObject().put("provider", provider).put("kind", kind).put("requestUrl", requestUrl).put("page", page).put("limit", limit);
        if (artistRequestUrls != null) options.put("artistRequestUrls", artistRequestUrls);
        return options;
    }
    interface CatalogReader { JSONObject read(String url) throws Exception; }
    static JSONObject readArtistProfile(String url, CatalogReader reader) throws Exception {
        String sourceUrl = artistProfileUrl(url);
        JSONObject details = reader.read(sourceUrl);
        JSONObject result = new JSONObject().put("catalogDetails", details);
        // A Topic upload may explicitly credit its associated official channel.
        // Keep the directory unless that exact channel is independently verified.
        String sourceId = details.optString("channel_id");
        if (!isTopic(details) || !("https://www.youtube.com/channel/" + sourceId).equals(sourceUrl)) return result;
        JSONArray entries = details.optJSONArray("entries");
        JSONObject track = entries == null ? null : entries.optJSONObject(0);
        if (track == null || !track.optString("id").matches("[A-Za-z0-9_-]{11}") || !track.optString("channel_id").matches("UC[A-Za-z0-9_-]{22}")) return result;
        try {
            String artistUrl = artistProfileUrl(track.optString("channel_url"));
            String artistId = track.getString("channel_id");
            if (sourceId.equals(artistId) || !("https://www.youtube.com/channel/" + artistId).equals(artistUrl)) return result;
            JSONObject profile = reader.read(artistUrl);
            if (artistId.equals(profile.optString("channel_id")) && Boolean.TRUE.equals(profile.opt("channel_is_verified")))
                result.put("catalogArtist", new JSONObject().put("url", artistUrl).put("details", profile));
        } catch (Exception ignored) { /* The music directory remains available for retry. */ }
        return result;
    }
    private static String artistProfileUrl(String url) throws Exception {
        JSONObject source = options(new JSONObject().put("provider", "youtube").put("kind", "artist").put("url", url));
        return source.getJSONArray("artistRequestUrls").getString(2);
    }
    private static boolean isTopic(JSONObject data) {
        return Pattern.compile(" - Topic$", Pattern.CASE_INSENSITIVE).matcher(data.optString("title").trim()).find()
            || Pattern.compile(" - Topic$", Pattern.CASE_INSENSITIVE).matcher(data.optString("channel").trim()).find();
    }
    static JSONObject readArtistCatalog(JSONObject options, CatalogReader reader) throws Exception {
        JSONArray urls = options.getJSONArray("artistRequestUrls");
        String[] sources = {"releases", "videos", "channel"};
        for (int index = 0; index < urls.length(); index++) {
            boolean last = index == urls.length() - 1;
            JSONObject data;
            try { data = reader.read(urls.getString(index)); }
            catch (Exception error) {
                String message = error.getMessage();
                if (!last && message != null && Pattern.compile("This channel does not have a (?:videos|releases) tab", Pattern.CASE_INSENSITIVE).matcher(message).find()) continue;
                throw error;
            }
            JSONArray entries = data.optJSONArray("entries");
            if (!last && options.getInt("page") == 1 && (entries == null || entries.length() == 0)) continue;
            return data.put("catalogSource", sources[index]);
        }
        throw new IOException("暂未读取到歌手的公开目录，请重试。");
    }
    private static String query(JSONObject value) throws Exception {
        if (!(value.opt("query") instanceof String) || value.getString("query").length() > 300) throw new IOException("请输入 1 至 300 个字符的歌手或专辑名称。");
        String query = NativeDownloadPolicy.text(value.opt("query"), 300);
        if (query.isEmpty()) throw new IOException("请输入歌手或专辑名称。");
        return query;
    }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20"); }
}
