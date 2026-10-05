package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** A retry may replace missing audio sources, but cannot rewrite song metadata or cloud identity. */
final class NativeDownloadRetryPolicy {
    private NativeDownloadRetryPolicy() {}

    /** Returns new arrays only after every replacement and every remaining failure is validated. */
    static JSONObject prepare(JSONObject job, JSONObject input) throws Exception {
        if (input == null) input = new JSONObject();
        for (Iterator<String> keys = input.keys(); keys.hasNext();) {
            if (!"replacements".equals(keys.next())) throw new IOException("重试只允许更换失败音源，不能更改歌曲信息或上传账号。");
        }
        JSONArray replacements = new JSONArray();
        if (input.has("replacements")) {
            replacements = input.optJSONArray("replacements");
            if (replacements == null) throw new IOException("更换音源参数必须是列表。");
        }
        if (replacements.length() > NativeDownloadPolicy.MAX_ENTRIES) throw new IOException("一次最多更换 100 个失败音源。");
        if (replacements.length() > 0 && "running".equals(job.optString("state"))) throw new IOException("任务正在运行，请等任务停止后再更换失败音源。");

        JSONArray sources = job.getJSONArray("sources"), failures = job.getJSONArray("failures");
        // An empty request for an existing running task is idempotent and does not enqueue work.
        if ("running".equals(job.optString("state"))) return new JSONObject()
            .put("sources", new JSONArray(sources.toString())).put("failures", new JSONArray(failures.toString()));
        if (failures.length() == 0) throw new IOException("没有尚未完成的失败音源。");
        Set<String> completed = new HashSet<>(), existing = new HashSet<>(), pending = new HashSet<>(), failed = new HashSet<>();
        Map<String, Integer> sourceCounts = new HashMap<>();
        JSONArray files = job.getJSONArray("files");
        for (int i = 0; i < files.length(); i++) {
            JSONObject file = files.getJSONObject(i), metadata = file.optJSONObject("metadata");
            if (metadata != null) {
                String url = storedUrl(metadata.optString("sourceUrl"));
                if (!url.isEmpty()) completed.add(url);
            }
            java.util.regex.Matcher name = java.util.regex.Pattern.compile("-([A-Za-z0-9_-]{11})\\.mp3$").matcher(file.optString("name", file.optString("fileName", "")));
            if (name.find()) completed.add("https://www.youtube.com/watch?v=" + name.group(1));
        }
        for (int i = 0; i < sources.length(); i++) {
            String url = canonicalUrl(sources.getJSONObject(i).opt("url"));
            existing.add(url);
            sourceCounts.put(url, sourceCounts.getOrDefault(url, 0) + 1);
            if (!completed.contains(url)) pending.add(url);
        }
        for (int i = 0; i < failures.length(); i++) {
            String url = storedUrl(failures.getJSONObject(i).optString("url"));
            if (!pending.contains(url) || !failed.add(url)) throw new IOException("失败音源与当前尚未完成的曲目不一致，请重新读取任务。");
        }

        Map<String, String> selected = new HashMap<>(); Set<String> newUrls = new HashSet<>();
        for (int i = 0; i < replacements.length(); i++) {
            JSONObject item = replacements.optJSONObject(i);
            if (item == null) throw new IOException("每个更换音源项目必须包含原链接和新链接。");
            for (Iterator<String> keys = item.keys(); keys.hasNext();) {
                String key = keys.next();
                if (!"fromUrl".equals(key) && !"url".equals(key)) throw new IOException("更换音源不能更改歌曲信息或上传账号。");
            }
            String from = canonicalUrl(item.opt("fromUrl")), to = canonicalUrl(item.opt("url"));
            if (!pending.contains(from) || !failed.contains(from)) throw new IOException("只能更换本任务中尚未完成的失败音源，已下载 MP3 保留。");
            if (sourceCounts.getOrDefault(from, 0) != 1) throw new IOException("失败音源在任务中不唯一，请重新读取歌单；已下载 MP3 保留。");
            if (selected.containsKey(from)) throw new IOException("同一失败曲目只能选择一个新音源。");
            if (existing.contains(to) || completed.contains(to) || !newUrls.add(to)) throw new IOException("请选择与任务中其他曲目及原链接不同的新音源。");
            selected.put(from, to);
        }
        for (int i = 0; i < failures.length(); i++) {
            JSONObject failure = failures.getJSONObject(i); String url = storedUrl(failure.optString("url"));
            if (!pending.contains(url) || selected.containsKey(url)) continue;
            String reason = restrictionReason(failure.optString("error"));
            if (!reason.isEmpty()) throw new IOException(reason + " 请为失败曲目选择其他可公开访问的音源后重试，已下载 MP3 保留。");
        }

        JSONArray nextSources = new JSONArray(sources.toString()), nextFailures = new JSONArray(failures.toString());
        for (int i = 0; i < nextSources.length(); i++) {
            JSONObject source = nextSources.getJSONObject(i); String replacement = selected.get(storedUrl(source.optString("url")));
            if (replacement != null) source.put("url", replacement).put("preserveMetadata", true);
        }
        for (int i = 0; i < nextFailures.length(); i++) {
            JSONObject failure = nextFailures.getJSONObject(i); String replacement = selected.get(storedUrl(failure.optString("url")));
            if (replacement != null) failure.put("url", replacement).put("preserveMetadata", true).put("error", "已更换音源，等待重试。");
        }
        return new JSONObject().put("sources", nextSources).put("failures", nextFailures);
    }

    private static String canonicalUrl(Object value) throws IOException {
        if (!(value instanceof String) || ((String) value).length() > 2000) throw new IOException("请选择有效的官方 YouTube HTTPS 单曲链接。");
        try { return "https://www.youtube.com/watch?v=" + NativeDownloadPolicy.videoId((String) value); }
        catch (Exception error) { throw new IOException("请选择有效的官方 YouTube HTTPS 单曲链接。", error); }
    }
    private static String storedUrl(String value) {
        try { return canonicalUrl(value); } catch (IOException ignored) { return ""; }
    }

    /** Only access restrictions require a different source; temporary network/403 errors remain retryable. */
    static String restrictionReason(String error) {
        String text = error == null ? "" : error.toLowerCase(Locale.ROOT).replace('’', '\'');
        if (text.matches("(?s).*(confirm your age|age[- ]restricted|age verification|年龄验证|年龄限制).*")) return "此音源需要年龄验证。";
        if (text.matches("(?s).*(not a bot|confirm you.*not.*bot|机器人验证|人机验证).*")) return "此音源要求网页人机验证。";
        if (text.matches("(?s).*(private video|video is private|members[- ]only|only available to.*members|channel members|join this channel|会员专享|私密视频).*")) return "此音源为私密或会员专享内容。";
        if (text.matches("(?s).*(geo[- ]?restrict|geographic restriction|not available (in|from) your (country|region|location)|not made.*available in your (country|region)|blocked in your (country|region)|地区限制|区域限制).*")) return "此音源在当前地区不可用。";
        if (text.matches("(?s).*(login required|log in required|requires login|authentication required|requires authentication|sign in to|sign in required|log in to|must be logged in|only available for registered users|需要登录|请先登录).*")) return "此音源需要另行登录认证。";
        return "";
    }
}
