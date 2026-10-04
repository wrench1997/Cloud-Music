package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import static org.junit.Assert.*;

public class NativeDownloadRunnerTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private JSONObject job(NativeDownloadStore store, boolean upload) throws Exception {
        JSONArray sources = new JSONArray();
        for (String id : new String[]{"iP6XpLQM2Cs", "HMJPG2I42xg"}) sources.put(new JSONObject().put("url", "https://www.youtube.com/watch?v=" + id).put("title", id).put("artist", "歌手"));
        JSONObject job = new JSONObject().put("id", "12345678-1234-1234-1234-123456789abc").put("createdAt", 1).put("state", "running").put("phase", "queued")
            .put("sources", sources).put("files", new JSONArray()).put("failures", new JSONArray()).put("total", 2).put("completed", 0).put("progress", 0).put("cancelled", false)
            .put("cloud", NativeDownloadPolicy.cloud(new JSONObject().put("enabled", upload).put("email", "x@example.com").put("accountId", "111")));
        store.add(job); return job;
    }
    private static class FakeEngine implements NativeDownloadEngine {
        Set<String> fail = new HashSet<>(); int calls;
        public void initialize() {}
        public JSONObject inspect(String url) { return new JSONObject(); }
        public JSONObject search(JSONObject value) { return new JSONObject(); }
        public JSONObject radio(JSONObject value) { return new JSONObject(); }
        public JSONObject match(JSONObject value) { return new JSONObject(); }
        public void cancel(String id) {}
        public JSONObject download(JSONObject source, File directory, String id, Progress progress, Cancelled cancelled) throws Exception {
            calls++; if (fail.contains(source.getString("title"))) throw new IOException("fake source unavailable");
            if (cancelled.get()) throw new IOException("cancelled");
            String name = source.getString("title") + ".mp3"; File file = new File(directory, name);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(new byte[256]); }
            return new JSONObject().put("name", name).put("displayName", name).put("size", file.length())
                .put("metadata", new JSONObject().put("sourceUrl", source.getString("url")).put("title", source.getString("title"))).put("localUri", file.toURI().toString());
        }
    }
    private static class FakeUploader implements NativeDownloadRunner.Uploader {
        int calls; boolean fail; Set<String> remote = new HashSet<>();
        public void cancel() {}
        public void upload(String id, File file, JSONObject details, JSONObject cloud, NativeDownloadRunner.Changed changed, NativeDownloadRunner.Cancelled cancelled) throws Exception {
            String key = cloud.getString("accountId") + ":" + file.getName();
            if (remote.contains(key)) { details.getJSONObject("cloud").put("state", "complete").put("id", "drive-" + file.getName()); changed.save(); return; }
            calls++; if (fail) throw new IOException("offline");
            remote.add(key);
            details.getJSONObject("cloud").put("state", "complete").put("id", "drive-" + file.getName()).put("accountId", cloud.getString("accountId")); changed.save();
        }
    }
    @Test public void partialDownloadRetriesOnlyMissingAudioAndPreservesSuccessfulFiles() throws Exception {
        NativeDownloadStore store = new NativeDownloadStore(temporary.newFolder()); JSONObject job = job(store, false);
        FakeEngine engine = new FakeEngine(); engine.fail.add("HMJPG2I42xg");
        NativeDownloadRunner runner = new NativeDownloadRunner(store, engine, new FakeUploader(), value -> {});
        runner.run(job.getString("id"), false); assertEquals("partial", job.getString("state")); assertEquals(1, job.getJSONArray("files").length());
        engine.fail.clear(); runner.run(job.getString("id"), false);
        assertEquals("complete", job.getString("state")); assertEquals(2, job.getJSONArray("files").length()); assertEquals(3, engine.calls);
    }
    @Test public void cloudFailureDoesNotLoseMp3AndResumeDoesNotDownloadOrDuplicateUploads() throws Exception {
        NativeDownloadStore store = new NativeDownloadStore(temporary.newFolder()); JSONObject job = job(store, true);
        FakeEngine engine = new FakeEngine(); FakeUploader uploader = new FakeUploader(); uploader.fail = true;
        NativeDownloadRunner runner = new NativeDownloadRunner(store, engine, uploader, value -> {});
        runner.run(job.getString("id"), false);
        assertEquals("complete", job.getString("state")); assertEquals("failed", job.getJSONObject("cloud").getString("state")); assertEquals(2, engine.calls);
        uploader.fail = false; runner.run(job.getString("id"), true); assertEquals("complete", job.getJSONObject("cloud").getString("state")); assertEquals(4, uploader.calls);
        runner.run(job.getString("id"), true); assertEquals(4, uploader.calls); assertEquals(2, engine.calls);
        job.put("cloud", NativeDownloadPolicy.cloud(new JSONObject().put("enabled", true).put("email", "other@example.com").put("accountId", "222")));
        runner.run(job.getString("id"), true); assertEquals(6, uploader.calls); assertEquals("222", job.getJSONArray("files").getJSONObject(0).getJSONObject("cloud").getString("accountId"));
    }
    @Test public void processDeathIsRecoveredAsInterruptedRatherThanFakeSuccess() throws Exception {
        File directory = temporary.newFolder(); NativeDownloadStore store = new NativeDownloadStore(directory); JSONObject job = job(store, true);
        JSONObject file = new FakeEngine().download(job.getJSONArray("sources").getJSONObject(0), store.directory(job.getString("id")), "fake", (phase, percent) -> {}, () -> false);
        file.put("cloud", new JSONObject().put("state", "uploading").put("accountId", "111")); job.getJSONArray("files").put(file); job.getJSONObject("cloud").put("state", "uploading"); store.persist(job);
        NativeDownloadStore restarted = new NativeDownloadStore(directory); JSONObject recovered = restarted.job(job.getString("id"));
        assertEquals("partial", recovered.getString("state")); assertEquals(1, recovered.getJSONArray("files").length()); assertEquals(1, recovered.getJSONArray("failures").length());
        assertEquals("failed", recovered.getJSONObject("cloud").getString("state")); assertFalse(recovered.toString().contains("accessToken"));
    }
    @Test public void cancelledQueuedTaskNeverStartsExtractorOrUpload() throws Exception {
        NativeDownloadStore store = new NativeDownloadStore(temporary.newFolder()); JSONObject job = job(store, true);
        FakeEngine engine = new FakeEngine(); FakeUploader uploader = new FakeUploader();
        NativeDownloadRunner runner = new NativeDownloadRunner(store, engine, uploader, value -> {});
        runner.cancel(job.getString("id")); runner.run(job.getString("id"), false);
        assertEquals("cancelled", job.getString("state")); assertEquals(0, engine.calls); assertEquals(0, uploader.calls);
    }
    @Test public void aUserDeletedCloudFileIsRestoredWithoutDownloadingAgain() throws Exception {
        NativeDownloadStore store = new NativeDownloadStore(temporary.newFolder()); JSONObject job = job(store, true);
        FakeEngine engine = new FakeEngine(); FakeUploader uploader = new FakeUploader();
        NativeDownloadRunner runner = new NativeDownloadRunner(store, engine, uploader, value -> {});
        runner.run(job.getString("id"), false); assertEquals(2, uploader.calls);
        uploader.remote.remove("111:iP6XpLQM2Cs.mp3"); runner.run(job.getString("id"), true);
        assertEquals(3, uploader.calls); assertEquals(2, engine.calls); assertEquals("complete", job.getJSONObject("cloud").getString("state"));
    }
}
