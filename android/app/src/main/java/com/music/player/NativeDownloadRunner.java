package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;

/** Serial work engine, kept independent of Activities and Android framework for restart/retry tests. */
final class NativeDownloadRunner {
    static final class AccountRequired extends IOException { AccountRequired(String message) { super(message); } }
    interface Changed { void save() throws Exception; }
    interface Cancelled { boolean get(); }
    interface Events { void changed(JSONObject job); }
    interface Uploader {
        void upload(String jobId, File file, JSONObject details, JSONObject cloud, Changed changed, Cancelled cancelled) throws Exception;
        void cancel();
    }
    private final NativeDownloadStore store;
    private final NativeDownloadEngine engine;
    private final Uploader uploader;
    private final Events events;
    NativeDownloadRunner(NativeDownloadStore store, NativeDownloadEngine engine, Uploader uploader, Events events) {
        this.store = store; this.engine = engine; this.uploader = uploader; this.events = events;
    }
    private void save(JSONObject job) throws Exception {
        store.persist(job); events.changed(new JSONObject(job.toString()));
    }
    private boolean cancelled(JSONObject job) { synchronized (store) { return job.optBoolean("cancelled") || Thread.currentThread().isInterrupted(); } }
    void run(String id, boolean uploadOnly) throws Exception {
        JSONObject job;
        synchronized (store) {
            job = store.job(id);
            if (job.optBoolean("cancelled")) return;
            job.put("state", "running").put("phase", uploadOnly ? "upload" : "download").put("error", ""); save(job);
        }
        JSONArray pending;
        synchronized (store) { pending = uploadOnly ? new JSONArray() : NativeDownloadStore.pendingSources(job); if (!uploadOnly) job.put("failures", new JSONArray()); save(job); }
        for (int i = 0; i < pending.length() && !cancelled(job); i++) {
            JSONObject source = pending.getJSONObject(i);
            long[] lastProgress = {0}; String[] lastPhase = {""};
            try {
                JSONObject file = engine.download(source, store.directory(id), id, (phase, percent) -> {
                    if (System.currentTimeMillis() - lastProgress[0] < 500 && phase.equals(lastPhase[0])) return;
                    lastProgress[0] = System.currentTimeMillis(); lastPhase[0] = phase;
                    synchronized (store) {
                        try {
                            job.put("title", source.optString("title", "歌曲")).put("phase", phase);
                            job.put("progress", Math.min(99, (job.getJSONArray("files").length() * 100 + percent) / Math.max(1, job.optInt("total", 1))));
                            save(job);
                        } catch (Exception ignored) { /* A progress callback cannot convert failure into success. */ }
                    }
                }, () -> cancelled(job));
                synchronized (store) {
                    file.put("jobId", id).put("fileName", file.getString("name")).put("id", "native:" + id + ":" + file.getString("name"));
                    file.put("cloud", new JSONObject().put("state", job.getJSONObject("cloud").optBoolean("enabled") ? "pending" : "disabled"));
                    job.getJSONArray("files").put(file); job.put("completed", job.getJSONArray("files").length()); save(job);
                }
            } catch (Exception error) {
                synchronized (store) {
                    if (!cancelled(job)) job.getJSONArray("failures").put(new JSONObject(source.toString()).put("error", message(error)));
                    save(job);
                }
            }
        }
        synchronized (store) {
            if (cancelled(job)) {
                job.put("state", "cancelled").put("phase", "finished").put("failures", NativeDownloadStore.pendingSources(job)); save(job); return;
            }
        }
        upload(job);
        synchronized (store) {
            int count = job.getJSONArray("files").length(), total = job.optInt("total", count);
            boolean done = count >= total;
            job.put("state", cancelled(job) ? "cancelled" : done ? "complete" : count > 0 ? "partial" : "failed").put("phase", "finished")
                .put("completed", count).put("progress", total > 0 ? count * 100 / total : 0);
            JSONArray failures = job.optJSONArray("failures"); StringBuilder error = new StringBuilder();
            if (failures != null) for (int i = 0; i < failures.length(); i++) {
                JSONObject value = failures.getJSONObject(i); error.append(value.optString("title")).append(": ").append(value.optString("error")).append('\n');
            }
            job.put("error", NativeDownloadPolicy.text(error.toString(), 3000)); save(job);
        }
    }
    private void upload(JSONObject job) throws Exception {
        JSONObject cloud;
        synchronized (store) {
            cloud = new JSONObject(job.getJSONObject("cloud").toString());
            if (!cloud.optBoolean("enabled") || cancelled(job)) return;
            job.put("phase", "upload"); job.getJSONObject("cloud").put("state", "uploading").put("error", ""); save(job);
        }
        String accountId = cloud.getString("accountId"); JSONArray files;
        synchronized (store) { files = job.getJSONArray("files"); }
        int complete = 0, failed = 0; boolean waitingLogin = false;
        for (int i = 0; i < files.length() && !cancelled(job); i++) {
            JSONObject actual, working;
            synchronized (store) {
                actual = files.getJSONObject(i); JSONObject history = actual.optJSONObject("cloudAccounts");
                if (history == null) { history = new JSONObject(); actual.put("cloudAccounts", history); }
                JSONObject previous = history.optJSONObject(accountId);
                if (previous == null && accountId.equals(actual.getJSONObject("cloud").optString("accountId"))) previous = actual.getJSONObject("cloud");
                // A completed ID is a persistent hint. The uploader verifies the remote file again,
                // so a user-deleted Drive MP3 can be restored without downloading the audio twice.
                JSONObject status = previous != null ? new JSONObject(previous.toString()) : new JSONObject();
                status.put("accountId", accountId).put("email", cloud.getString("email")).put("state", "uploading").put("error", ""); actual.put("cloud", status); save(job);
                working = new JSONObject(actual.toString());
            }
            Changed changed = () -> {
                synchronized (store) {
                    JSONObject status = new JSONObject(working.getJSONObject("cloud").toString());
                    actual.put("cloud", status); actual.getJSONObject("cloudAccounts").put(accountId, new JSONObject(status.toString())); save(job);
                }
            };
            try {
                uploader.upload(job.getString("id"), store.file(job.getString("id"), actual.getString("name")), working, cloud, changed, () -> cancelled(job));
                changed.save(); complete++;
            } catch (Exception error) {
                boolean auth = error instanceof AccountRequired || error instanceof GoogleAuthFailure && "GOOGLE_AUTH_REQUIRED".equals(((GoogleAuthFailure) error).code);
                working.getJSONObject("cloud").put("state", auth ? "waiting-login" : "failed").put("error", message(error)); changed.save(); failed++; waitingLogin |= auth;
                if (auth || failed >= 3) break;
            }
        }
        synchronized (store) {
            JSONObject status = job.getJSONObject("cloud");
            status.put("uploaded", complete).put("total", files.length()).put("state", complete == files.length() && files.length() > 0 ? "complete" : waitingLogin ? "waiting-login" : failed > 0 ? "failed" : "pending");
            if (failed > 0) status.put("error", "部分 MP3 尚未上传，请确认账号或网络后续传；手机本地文件已保留。");
            save(job);
        }
    }
    static String message(Throwable error) {
        String value = error.getMessage(); return NativeDownloadPolicy.text(value == null ? "任务暂时失败，请重试。" : value, 1500);
    }
    void cancel(String id) throws Exception {
        synchronized (store) {
            JSONObject job = store.job(id); job.put("cancelled", true).put("state", "cancelled").put("phase", "finished"); save(job);
        }
        engine.cancel(id);
    }
}
