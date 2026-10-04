package com.music.player;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Account-bound background Drive transfers. This class never opens a consent UI or stores a token. */
final class NativeDriveUpload implements NativeDownloadRunner.Uploader {
    private static final String API = "https://www.googleapis.com/drive/v3";
    private static final String UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size";
    private static final int CHUNK = 8 * 1024 * 1024;
    private final Context context;
    private volatile HttpURLConnection activeConnection;
    NativeDriveUpload(Context context) { this.context = context.getApplicationContext(); }
    JSONObject identityForEmail(String email) throws Exception {
        JSONObject user = json(API + "/about?fields=user(permissionId,emailAddress)", "GET", new JSONObject().put("email", email), null, () -> false).getJSONObject("user");
        if (!email.equalsIgnoreCase(user.optString("emailAddress")) || !user.optString("permissionId").matches("[A-Za-z0-9_-]+")) throw new NativeDownloadRunner.AccountRequired("请在应用中连接指定 Google 账号后续传。");
        return user;
    }
    @Override public void cancel() { HttpURLConnection value = activeConnection; if (value != null) value.disconnect(); }
    private static final class Response {
        int code; byte[] bytes; String location, range;
        JSONObject json() throws Exception { return bytes.length == 0 ? new JSONObject() : new JSONObject(new String(bytes, StandardCharsets.UTF_8)); }
    }
    private Response request(String address, String method, JSONObject cloud, String contentType, byte[] body,
                             File file, long offset, int length, String range, NativeDownloadRunner.Cancelled cancelled) throws Exception {
        URI uri = new URI(address);
        if (!"https".equals(uri.getScheme()) || !"www.googleapis.com".equals(uri.getHost()) || uri.getUserInfo() != null || uri.getPort() != -1) throw new IOException("Drive 返回了无效上传地址。");
        for (int attempt = 0; attempt < 2; attempt++) {
            if (cancelled.get()) throw new IOException("任务已取消，MP3 已保留。");
            String token = GoogleDriveAuthPlugin.getBackgroundAccessToken(context, cloud.getString("email"), attempt > 0);
            HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection(); activeConnection = connection;
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(30000); connection.setReadTimeout(90000);
            connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + token);
            if (contentType != null) connection.setRequestProperty("Content-Type", contentType);
            if (range != null) connection.setRequestProperty("Content-Range", range);
            if (method.equals("POST") && address.equals(UPLOAD) && file != null) {
                connection.setRequestProperty("X-Upload-Content-Type", "audio/mpeg");
                connection.setRequestProperty("X-Upload-Content-Length", String.valueOf(file.length()));
            }
            try {
                if (body != null || method.equals("PUT")) {
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(body != null ? body.length : length);
                    try (OutputStream output = connection.getOutputStream()) {
                        if (body != null) output.write(body);
                        else if (file != null && length > 0) try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                            input.seek(offset); byte[] buffer = new byte[65536]; int remaining = length;
                            while (remaining > 0) {
                                if (cancelled.get()) throw new IOException("任务已取消，MP3 已保留。");
                                int count = input.read(buffer, 0, Math.min(buffer.length, remaining));
                                if (count < 0) throw new IOException("本地 MP3 读取中断。");
                                output.write(buffer, 0, count); remaining -= count;
                            }
                        }
                    }
                }
                Response result = new Response(); result.code = connection.getResponseCode(); result.location = connection.getHeaderField("Location"); result.range = connection.getHeaderField("Range");
                try (InputStream input = result.code >= 400 ? connection.getErrorStream() : connection.getInputStream(); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                    if (input != null) { byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > 1024 * 1024) throw new IOException("Drive 返回内容过大。"); } }
                    result.bytes = out.toByteArray();
                }
                if (result.code != 401 || attempt == 1) return result;
            } finally { connection.disconnect(); if (activeConnection == connection) activeConnection = null; }
        }
        throw new IOException("Google 连接需要确认，请先连接账号再续传。");
    }
    private JSONObject json(String address, String method, JSONObject cloud, JSONObject body, NativeDownloadRunner.Cancelled cancelled) throws Exception {
        Response response = request(address, method, cloud, body == null ? null : "application/json; charset=UTF-8", body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8), null, 0, 0, null, cancelled);
        check(response); return response.json();
    }
    private static void check(Response response) throws IOException {
        if (response.code >= 200 && response.code < 300) return;
        if (response.code == 401 || response.code == 403) throw new IOException("Google Drive 授权不可用，请连接指定账号后续传；本地 MP3 已保留。");
        throw new IOException("Google Drive 返回 " + response.code + "，本地 MP3 已保留，可稍后续传。");
    }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, "UTF-8"); }
    private String ensureFolder(JSONObject cloud, NativeDownloadRunner.Cancelled cancelled) throws Exception {
        String query = "trashed = false and 'me' in owners and mimeType = 'application/vnd.google-apps.folder' and properties has { key='yunganMusic' and value='library-v1' }";
        JSONArray files = json(API + "/files?q=" + encode(query) + "&pageSize=1000&fields=files(id,name)", "GET", cloud, null, cancelled).optJSONArray("files");
        String smallest = null;
        if (files != null) for (int i = 0; i < files.length(); i++) { String id = files.getJSONObject(i).getString("id"); if (smallest == null || id.compareTo(smallest) < 0) smallest = id; }
        if (smallest != null) return smallest;
        return json(API + "/files?fields=id,name", "POST", cloud, new JSONObject().put("name", "Yungan Music").put("mimeType", "application/vnd.google-apps.folder")
            .put("properties", new JSONObject().put("yunganMusic", "library-v1")), cancelled).getString("id");
    }
    static JSONObject properties(JSONObject metadata) throws Exception {
        JSONObject result = new JSONObject();
        for (String key : new String[]{"title", "artist", "album"}) {
            String value = metadata.optString(key, "").trim(); if (!value.isEmpty()) result.put(key, NativeDownloadPolicy.truncateUtf8(value, 124 - key.getBytes(StandardCharsets.UTF_8).length));
        }
        double duration = metadata.optDouble("duration", 0); if (Double.isFinite(duration) && duration >= 0) result.put("duration", String.valueOf(duration));
        for (String key : new String[]{"coverUrl", "sourceUrl"}) {
            String value = metadata.optString(key, "");
            try { NativeDownloadPolicy.officialUri(value); if ((key + value).getBytes(StandardCharsets.UTF_8).length <= 124) result.put(key, value); } catch (IOException ignored) {}
        }
        if (metadata.optBoolean("hasArtwork")) result.put("hasArtwork", "1");
        return result;
    }
    private static String transferKey(String accountId, String jobId, String name) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest((accountId + "\n" + jobId + "\n" + name).getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(); for (byte b : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return result.toString();
    }
    @Override public void upload(String jobId, File file, JSONObject details, JSONObject cloud, NativeDownloadRunner.Changed changed, NativeDownloadRunner.Cancelled cancelled) throws Exception {
        JSONObject about = json(API + "/about?fields=user(permissionId,emailAddress)", "GET", cloud, null, cancelled).getJSONObject("user");
        if (!cloud.getString("accountId").equals(about.optString("permissionId")) || !cloud.getString("email").equalsIgnoreCase(about.optString("emailAddress"))) throw new NativeDownloadRunner.AccountRequired("当前 Google 账号与任务指定账号不一致，已停止上传并保留 MP3。");
        String key = transferKey(cloud.getString("accountId"), jobId, details.getString("name"));
        // A completed file may have been moved by the user or before its last acknowledgement was saved.
        // The account-bound transfer key remains stable anywhere in Drive; folder membership must not create duplicates.
        String query = "trashed = false and appProperties has { key='nativeTransfer' and value='" + key + "' }";
        JSONArray existing = json(API + "/files?q=" + encode(query) + "&fields=files(id,size)&pageSize=10", "GET", cloud, null, cancelled).optJSONArray("files");
        JSONObject status = details.getJSONObject("cloud");
        if (existing != null && existing.length() > 0) {
            for (int i = 0; i < existing.length(); i++) if (file.length() == existing.getJSONObject(i).optLong("size", -1)) {
                status.put("id", existing.getJSONObject(i).getString("id")).put("state", "complete").put("error", ""); status.remove("sessionUrl"); changed.save(); return;
            }
        }
        String session = status.optString("sessionUrl", "");
        boolean persistedSession = !session.isEmpty();
        if (session.isEmpty()) {
            String folder = ensureFolder(cloud, cancelled);
            JSONObject metadata = new JSONObject().put("name", details.getString("displayName")).put("mimeType", "audio/mpeg").put("parents", new JSONArray().put(folder))
                .put("properties", new JSONObject().put("yunganMusic", "track-v1")).put("appProperties", properties(details.getJSONObject("metadata")).put("nativeTransfer", key));
            Response response = request(UPLOAD, "POST", cloud, "application/json; charset=UTF-8", metadata.toString().getBytes(StandardCharsets.UTF_8), file, 0, 0, null, cancelled);
            check(response); session = response.location;
            if (session == null || session.isEmpty()) throw new IOException("Google Drive 未返回上传会话。");
            URI uri = new URI(session);
            if (!"https".equals(uri.getScheme()) || !"www.googleapis.com".equals(uri.getHost()) || uri.getPort() != -1 || uri.getUserInfo() != null) throw new IOException("Google Drive 返回了无效上传会话。");
            status.put("sessionUrl", session).put("offset", 0); changed.save();
        }
        long offset = status.optLong("offset", 0); int retries = 0; boolean probe = NativeDownloadPolicy.mustProbeSession(persistedSession, offset);
        if (offset < 0 || offset > file.length()) { offset = 0; probe = true; }
        while (offset < file.length() || probe) {
            if (cancelled.get()) throw new IOException("任务已取消，MP3 已保留。");
            int count = (int) Math.min(CHUNK, file.length() - offset); Response result;
            try {
                result = request(session, "PUT", cloud, "audio/mpeg", null, probe ? null : file, offset, probe ? 0 : count,
                    probe ? "bytes */" + file.length() : "bytes " + offset + "-" + (offset + count - 1) + "/" + file.length(), cancelled);
                if (result.code == 429 || result.code >= 500) throw new IOException("Drive 上传暂时不可用。");
            } catch (Exception error) {
                if (cancelled.get() || error instanceof GoogleAuthFailure || ++retries > 3) throw error;
                Thread.sleep(Math.min(1000L << (retries - 1), 4000)); probe = true; continue;
            }
            if (result.code >= 200 && result.code < 300) {
                String id = result.json().optString("id", "");
                if (!id.matches("[A-Za-z0-9_-]+")) throw new IOException("Drive 未返回已上传文件 ID。");
                status.put("id", id).put("state", "complete").put("offset", file.length()).put("error", ""); status.remove("sessionUrl"); changed.save(); return;
            }
            if (result.code >= 400 && result.code < 500 && result.code != 401 && result.code != 403 && result.code != 429) {
                status.remove("sessionUrl"); status.put("offset", 0); changed.save(); throw new IOException("上传会话已失效，请点续传；本地 MP3 已保留。");
            }
            if (result.code != 308) check(result);
            Matcher range = Pattern.compile("bytes=0-(\\d+)").matcher(result.range == null ? "" : result.range);
            long next = range.matches() ? Long.parseLong(range.group(1)) + 1 : 0;
            if (next < 0 || next > file.length() || (!probe && next <= offset) || (probe && next == file.length() && ++retries > 3)) throw new IOException("上传进度异常，请稍后续传。");
            if (next > offset) retries = 0;
            offset = next; status.put("offset", offset); changed.save(); probe = offset == file.length();
        }
        throw new IOException("上传未完成，请稍后续传。");
    }
}
