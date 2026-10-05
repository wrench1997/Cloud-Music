package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

/** Tokens are deliberately absent from task manifests. Files survive view unmounts and process death. */
final class NativeDownloadStore {
    private final File root;
    private final LinkedHashMap<String, JSONObject> jobs = new LinkedHashMap<>();
    NativeDownloadStore(File root) throws Exception {
        this.root = root.getCanonicalFile();
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("无法创建本地音乐目录。");
        File[] directories = root.listFiles(file -> file.isDirectory() && file.getName().matches("[a-f0-9-]{36}"));
        if (directories == null) return;
        java.util.Arrays.sort(directories, java.util.Comparator.comparingLong(File::lastModified));
        for (File directory : directories) {
            if (jobs.size() >= 100) break;
            try {
                File manifest = NativeDownloadPolicy.child(directory, "task.json");
                File backup = NativeDownloadPolicy.child(directory, "task.json.bak");
                if (!manifest.isFile() && backup.isFile()) backup.renameTo(manifest);
                JSONObject saved = read(manifest);
                if (!directory.getName().equals(saved.optString("id"))) continue;
                JSONArray files = saved.optJSONArray("files");
                if (files == null) files = new JSONArray();
                JSONArray valid = new JSONArray();
                for (int i = 0; i < files.length(); i++) {
                    JSONObject file = files.optJSONObject(i);
                    if (file != null && file.optString("name").endsWith(".mp3") && NativeDownloadPolicy.child(directory, file.optString("name")).isFile()
                        && NativeDownloadPolicy.child(directory, file.optString("name")).length() > 0) valid.put(file);
                }
                saved.put("files", valid).put("completed", valid.length());
                if ("running".equals(saved.optString("state"))) {
                    saved.put("state", valid.length() > 0 ? "partial" : "failed").put("phase", "interrupted").put("error", "上次任务被中断；本地 MP3 已保留，可重试未完成曲目或续传。");
                    saved.put("failures", pendingSources(saved));
                }
                JSONObject cloud = saved.optJSONObject("cloud");
                if (cloud != null && "uploading".equals(cloud.optString("state"))) cloud.put("state", "failed").put("error", "上次上传被中断，请点续传；本地 MP3 已保留。");
                for (int i = 0; i < valid.length(); i++) {
                    JSONObject fileCloud = valid.getJSONObject(i).optJSONObject("cloud");
                    if (fileCloud != null && "uploading".equals(fileCloud.optString("state"))) fileCloud.put("state", "failed").put("error", "上次上传被中断，可续传。");
                }
                jobs.put(saved.getString("id"), saved);
                persist(saved);
            } catch (Exception ignored) { /* A damaged task never hides unrelated local music. */ }
        }
    }
    static JSONArray pendingSources(JSONObject job) throws Exception {
        JSONArray pending = new JSONArray(), sources = job.optJSONArray("sources"), files = job.optJSONArray("files");
        if (sources == null) return pending;
        for (int i = 0; i < sources.length(); i++) {
            JSONObject source = sources.getJSONObject(i); boolean complete = false;
            if (files != null) for (int j = 0; j < files.length(); j++) {
                JSONObject metadata = files.getJSONObject(j).optJSONObject("metadata");
                if (metadata != null && source.optString("url").equals(metadata.optString("sourceUrl"))) { complete = true; break; }
            }
            if (!complete) pending.put(new JSONObject(source.toString()).put("error", "下载未完成，可重试。"));
        }
        return pending;
    }
    static JSONObject read(File file) throws Exception {
        if (!file.isFile() || file.length() > NativeDownloadPolicy.MAX_JSON_BYTES) throw new IOException("任务文件无效。");
        try (FileInputStream input = new FileInputStream(file); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > NativeDownloadPolicy.MAX_JSON_BYTES) throw new IOException("任务文件过大。"); }
            return new JSONObject(out.toString("UTF-8"));
        }
    }
    synchronized File directory(String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IOException("无效的下载任务。");
        File directory = NativeDownloadPolicy.child(root, id);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("本地音乐目录不可用。");
        return directory;
    }
    synchronized JSONObject job(String id) throws IOException {
        JSONObject value = jobs.get(id);
        if (value == null) throw new IOException("下载任务不存在。");
        return value;
    }
    synchronized List<JSONObject> all() { return new ArrayList<>(jobs.values()); }
    synchronized void add(JSONObject job) throws Exception {
        if (jobs.size() >= 100) throw new IOException("本地下载任务达到 100 个，请整理已下载文件后重试。");
        jobs.put(job.getString("id"), job); persist(job);
    }
    synchronized void persist(JSONObject job) throws Exception {
        job.put("updatedAt", Math.max(System.currentTimeMillis(), job.optLong("updatedAt", 0) + 1));
        File directory = directory(job.getString("id"));
        File manifest = NativeDownloadPolicy.child(directory, "task.json"), temporary = NativeDownloadPolicy.child(directory, "task.json.tmp"), backup = NativeDownloadPolicy.child(directory, "task.json.bak");
        byte[] data = job.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > NativeDownloadPolicy.MAX_JSON_BYTES) throw new IOException("下载任务记录过大。");
        try (FileOutputStream out = new FileOutputStream(temporary)) { out.write(data); out.getFD().sync(); }
        if (backup.exists() && !backup.delete()) throw new IOException("无法更新任务记录。");
        if (manifest.exists() && !manifest.renameTo(backup)) throw new IOException("无法保存任务记录。");
        if (!temporary.renameTo(manifest)) { if (backup.exists()) backup.renameTo(manifest); throw new IOException("无法写入任务记录。"); }
        if (backup.exists()) backup.delete();
    }
    synchronized File file(String id, String name) throws Exception {
        JSONObject job = job(id); boolean known = false;
        JSONArray files = job.optJSONArray("files");
        if (files != null) for (int i = 0; i < files.length(); i++) if (name.equals(files.getJSONObject(i).optString("name"))) known = true;
        if (!known) throw new IOException("文件尚未下载完成。");
        File value = NativeDownloadPolicy.child(directory(id), name);
        if (!value.isFile() || value.length() < 1) throw new IOException("本地 MP3 已移除，请重新下载。");
        return value;
    }
}
