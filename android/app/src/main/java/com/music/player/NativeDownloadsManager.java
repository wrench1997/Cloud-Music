package com.music.player;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.LinkedHashSet;
import java.util.Queue;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The app owns one serial queue; Activities only observe it. No localhost server is required. */
final class NativeDownloadsManager {
    interface Listener { void job(JSONObject job); void library(JSONArray songs); }
    private static NativeDownloadsManager instance;
    static synchronized NativeDownloadsManager get(Context context) throws Exception {
        if (instance == null) instance = new NativeDownloadsManager(context.getApplicationContext());
        return instance;
    }
    private final Context context;
    private final NativeDownloadStore store;
    private final NativeDownloadEngine engine;
    private final NativeDriveUpload uploader;
    private final NativeDownloadRunner runner;
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private final Queue<String> queue = new ArrayDeque<>();
    private final Set<String> queued = new LinkedHashSet<>();
    private final Set<String> uploadsOnly = new LinkedHashSet<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean draining;
    private volatile String activeId;
    private volatile NativeDownloadsService service;
    private NativeDownloadsManager(Context context) throws Exception {
        this.context = context;
        store = new NativeDownloadStore(new File(context.getNoBackupFilesDir(), "native-music"));
        engine = new NativeDownloadsYtdlpEngine(context); uploader = new NativeDriveUpload(context);
        runner = new NativeDownloadRunner(store, engine, uploader, this::changed);
    }
    void addListener(Listener listener) { listeners.addIfAbsent(listener); }
    void removeListener(Listener listener) { listeners.remove(listener); }
    private JSONObject copy(JSONObject value) throws Exception {
        JSONObject result = new JSONObject(value.toString());
        removePrivateTransferDetails(result); return result;
    }
    private static void removePrivateTransferDetails(Object value) {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            object.remove("sessionUrl"); object.remove("accessToken"); object.remove("token");
            java.util.Iterator<String> keys = object.keys();
            while (keys.hasNext()) removePrivateTransferDetails(object.opt(keys.next()));
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value; for (int i = 0; i < array.length(); i++) removePrivateTransferDetails(array.opt(i));
        }
    }
    private void changed(JSONObject job) {
        NativeDownloadsService current = service; if (current != null) current.progress(job);
        for (Listener listener : listeners) {
            try { listener.job(copy(job)); listener.library(library()); } catch (Exception ignored) {}
        }
    }
    JSONObject request(String route, String method, JSONObject data) throws Exception {
        if (data == null) data = new JSONObject();
        if ("/status".equals(route) && "GET".equals(method)) {
            engine.initialize(); JSONArray jobs = new JSONArray();
            synchronized (store) { for (JSONObject job : store.all()) jobs.put(copy(job)); }
            return new JSONObject().put("ready", true).put("native", true).put("remembersTasks", true).put("jobs", jobs);
        }
        if ("POST".equals(method)) {
            if ("/inspect".equals(route)) return engine.inspect(data.optString("url", ""));
            if ("/search".equals(route)) return engine.search(data);
            if ("/radio".equals(route)) return engine.radio(data);
            if ("/match".equals(route)) return engine.match(data);
            if ("/jobs".equals(route)) return create(data);
        }
        java.util.regex.Matcher match = java.util.regex.Pattern.compile("^/jobs/([a-f0-9-]{36})(?:/(retry|upload))?$").matcher(route);
        if (!match.matches()) throw new IOException("不支持的本地下载请求。");
        String id = match.group(1), action = match.group(2);
        if (action == null && "GET".equals(method)) { synchronized (store) { return copy(store.job(id)); } }
        if (action == null && "DELETE".equals(method)) {
            runner.cancel(id); if (id.equals(activeId)) uploader.cancel();
            synchronized (this) { queue.remove(id); queued.remove(id); uploadsOnly.remove(id); }
            synchronized (store) { return copy(store.job(id)); }
        }
        if (!"POST".equals(method)) throw new IOException("不支持的本地下载请求。");
        JSONObject job;
        synchronized (store) {
            job = store.job(id);
            NativeDownloadPolicy.requireRestartIdle(id, activeId, job.optBoolean("cancelled"), job.optString("state"));
            if ("running".equals(job.optString("state"))) {
                if ("retry".equals(action)) return copy(job);
                JSONObject requested = NativeDownloadPolicy.cloud(data.optJSONObject("cloud")), current = job.getJSONObject("cloud");
                if ("upload".equals(action) && requested.optBoolean("enabled") && requested.optString("accountId").equals(current.optString("accountId"))
                    && requested.optString("email").equalsIgnoreCase(current.optString("email"))) return copy(job);
                throw new IOException("此任务正在运行，请等待完成后再更改上传账号。");
            }
            if ("upload".equals(action)) {
                JSONObject cloud = NativeDownloadPolicy.cloud(data.optJSONObject("cloud"));
                if (!cloud.getBoolean("enabled")) throw new IOException("请先连接要上传的 Google 账号。");
                if (job.getJSONArray("files").length() == 0) throw new IOException("任务尚未生成可上传 MP3。");
                job.put("cloud", cloud);
            } else if (!"retry".equals(action)) throw new IOException("不支持的下载任务操作。");
            job.put("cancelled", false).put("state", "running").put("phase", "queued").put("error", ""); store.persist(job);
        }
        enqueue(id, "upload".equals(action));
        synchronized (store) { return copy(job); }
    }
    private JSONObject create(JSONObject data) throws Exception {
        JSONArray entries = data.optJSONArray("entries");
        if (entries == null || entries.length() < 1 || entries.length() > NativeDownloadPolicy.MAX_ENTRIES) throw new IOException("请选择 1 至 100 首音乐。");
        JSONArray sources = new JSONArray(); Set<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i); String video = NativeDownloadPolicy.videoId(entry.optString("url", ""));
            if (ids.add(video)) sources.put(NativeDownloadPolicy.track(entry, "https://www.youtube.com/watch?v=" + video));
        }
        String id = UUID.randomUUID().toString();
        JSONObject job = new JSONObject().put("id", id).put("createdAt", System.currentTimeMillis()).put("state", "running").put("phase", "queued")
            .put("title", sources.getJSONObject(0).optString("title", "音乐下载")).put("sources", sources).put("files", new JSONArray()).put("failures", new JSONArray())
            .put("completed", 0).put("total", sources.length()).put("progress", 0).put("error", "").put("cancelled", false).put("cloud", NativeDownloadPolicy.cloud(data.optJSONObject("cloud")));
        synchronized (store) { store.add(job); }
        enqueue(id, false); synchronized (store) { return copy(job); }
    }
    private void enqueue(String id, boolean uploadOnly) throws Exception {
        synchronized (this) { if (queued.add(id)) queue.add(id); if (uploadOnly) uploadsOnly.add(id); }
        try { ContextCompat.startForegroundService(context, new Intent(context, NativeDownloadsService.class)); }
        catch (Exception error) {
            synchronized (this) { queue.remove(id); queued.remove(id); uploadsOnly.remove(id); }
            synchronized (store) { JSONObject job = store.job(id); job.put("state", job.getJSONArray("files").length() > 0 ? "partial" : "failed").put("phase", "interrupted").put("error", "请打开应用后重试此任务，手机禁止了后台启动。"); store.persist(job); changed(copy(job)); }
            throw new IOException("请打开应用后重试，无法启动手机后台下载。", error);
        }
    }
    synchronized void attach(NativeDownloadsService service) {
        this.service = service;
        if (draining) return;
        draining = true;
        worker.execute(() -> {
            try {
                while (true) {
                    String id; boolean uploadOnly;
                    synchronized (NativeDownloadsManager.this) {
                        id = queue.poll(); if (id == null) break;
                        queued.remove(id); uploadOnly = uploadsOnly.remove(id); activeId = id;
                    }
                    try { runner.run(id, uploadOnly); }
                    catch (Exception error) {
                        synchronized (store) {
                            try {
                                JSONObject job = store.job(id); job.put("state", job.getJSONArray("files").length() > 0 ? "partial" : "failed").put("phase", "interrupted").put("error", NativeDownloadRunner.message(error)); store.persist(job); changed(copy(job));
                            } catch (Exception ignored) {}
                        }
                    } finally { activeId = null; }
                }
            } finally {
                synchronized (NativeDownloadsManager.this) {
                    draining = false; NativeDownloadsService current = NativeDownloadsManager.this.service;
                    if (current != null) { if (queue.isEmpty()) current.complete(); else attach(current); }
                }
            }
        });
    }
    synchronized void detach(NativeDownloadsService value) { if (service == value) service = null; }
    synchronized boolean idleForService(NativeDownloadsService value) { return service == value && !draining && queue.isEmpty() && activeId == null; }
    void timeout() {
        String id = activeId;
        java.util.List<String> waiting;
        synchronized (this) { waiting = new java.util.ArrayList<>(queue); queue.clear(); queued.clear(); uploadsOnly.clear(); }
        for (String pending : waiting) try { runner.cancel(pending); } catch (Exception ignored) {}
        if (id != null) try { runner.cancel(id); uploader.cancel(); } catch (Exception ignored) {}
    }
    JSONObject getFile(String id, String name) throws Exception {
        synchronized (store) { return new JSONObject().put("uri", Uri.fromFile(store.file(id, name)).toString()); }
    }
    JSONArray library() throws Exception {
        JSONArray songs = new JSONArray();
        synchronized (store) {
            for (JSONObject job : store.all()) {
                JSONArray files = job.getJSONArray("files");
                for (int i = 0; i < files.length(); i++) {
                    JSONObject file = files.getJSONObject(i); File path;
                    try { path = store.file(job.getString("id"), file.getString("name")); } catch (Exception ignored) { continue; }
                    JSONObject song = copy(file.optJSONObject("metadata") == null ? new JSONObject() : file.getJSONObject("metadata"));
                    song.put("id", "native:" + job.getString("id") + ":" + file.getString("name")).put("jobId", job.getString("id")).put("fileName", file.getString("name"))
                        .put("localUri", Uri.fromFile(path).toString()).put("size", path.length());
                    if (file.has("coverUri")) song.put("coverUri", file.getString("coverUri"));
                    songs.put(song);
                }
            }
        }
        return songs;
    }
    synchronized JSONObject saveFile(String id, String name) throws Exception {
        JSONObject file; File source;
        synchronized (store) {
            JSONObject job = store.job(id); source = store.file(id, name); file = null;
            JSONArray files = job.getJSONArray("files"); for (int i = 0; i < files.length(); i++) if (name.equals(files.getJSONObject(i).getString("name"))) file = files.getJSONObject(i);
            if (file == null) throw new IOException("本地音乐文件不存在。");
            String saved = file.optString("savedUri", "");
            if (!saved.isEmpty()) {
                try (InputStream input = context.getContentResolver().openInputStream(Uri.parse(saved))) {
                    if (input != null) return new JSONObject().put("uri", saved).put("message", "MP3 已保存到手机下载 / Yungan Music。");
                } catch (Exception ignored) {}
            }
        }
        Uri target = null; File legacy = null;
        try {
            OutputStream output;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, file.getString("displayName"));
                values.put(MediaStore.Downloads.MIME_TYPE, "audio/mpeg"); values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Yungan Music"); values.put(MediaStore.Downloads.IS_PENDING, 1);
                target = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (target == null) throw new IOException("无法创建手机下载文件。");
                output = context.getContentResolver().openOutputStream(target);
            } else {
                File directory = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) throw new IOException("手机下载目录不可用。");
                legacy = NativeDownloadPolicy.child(directory, file.getString("displayName")); output = new FileOutputStream(legacy);
            }
            if (output == null) throw new IOException("无法写入下载文件。");
            try (OutputStream sink = output; FileInputStream input = new FileInputStream(source)) { byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) != -1) sink.write(buffer, 0, count); }
            if (target != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.IS_PENDING, 0); context.getContentResolver().update(target, values, null, null); }
            String uri = (target != null ? target : Uri.fromFile(legacy)).toString();
            synchronized (store) { file.put("savedUri", uri); store.persist(store.job(id)); }
            return new JSONObject().put("uri", uri).put("message", target != null ? "MP3 已保存到手机下载 / Yungan Music。" : "已保存到应用外部音乐目录（卸载应用时会移除）。");
        } catch (Exception error) { if (target != null) context.getContentResolver().delete(target, null, null); if (legacy != null) legacy.delete(); throw error; }
    }
}
