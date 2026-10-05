package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public class NativeDownloadRetryPolicyTest {
    private static final String FAILED = "https://www.youtube.com/watch?v=yTLuE57Gvsc";
    private static final String REPLACEMENT = "https://www.youtube.com/watch?v=Zyxwvutsr01";
    private JSONObject partialJob() throws Exception {
        JSONArray sources = new JSONArray(), files = new JSONArray();
        for (int i = 0; i < 11; i++) {
            String url = "https://www.youtube.com/watch?v=" + String.format(java.util.Locale.ROOT, "abcdefgh%03d", i);
            JSONObject source = new JSONObject().put("url", url).put("title", "Song " + i).put("artist", "Artist " + i);
            sources.put(source); files.put(new JSONObject().put("name", "song-" + i + ".mp3")
                .put("metadata", new JSONObject().put("sourceUrl", url)).put("cloud", new JSONObject().put("id", "drive-" + i).put("state", "complete")));
        }
        JSONObject missing = new JSONObject().put("url", FAILED).put("title", "FUK ARI !").put("artist", "FrostBorne")
            .put("album", "Original album").put("duration", 123).put("coverUrl", "https://i.scdn.co/image/original").put("metadataProvider", "spotify");
        sources.put(missing);
        return new JSONObject().put("state", "partial").put("sources", sources).put("files", files)
            .put("failures", new JSONArray().put(new JSONObject(missing.toString()).put("error", "ERROR: Sign in to confirm your age")))
            .put("completed", 11).put("total", 12).put("cloud", new JSONObject().put("enabled", true).put("accountId", "original-account").put("email", "original@example.com"));
    }
    private JSONObject mapping(String from, String to) throws Exception { return new JSONObject().put("fromUrl", from).put("url", to); }
    private JSONObject input(JSONObject... items) throws Exception {
        JSONArray values = new JSONArray(); for (JSONObject item : items) values.put(item);
        return new JSONObject().put("replacements", values);
    }
    private void rejectsWithoutMutation(JSONObject job, JSONObject input, String explanation) throws Exception {
        String before = job.toString();
        try { NativeDownloadRetryPolicy.prepare(job, input); fail("must reject invalid retry"); }
        catch (IOException expected) { if (explanation != null) assertTrue(expected.getMessage(), expected.getMessage().contains(explanation)); }
        assertEquals(before, job.toString());
    }
    @Test public void replacementPreservesElevenFilesMetadataAccountAndTaskCounts() throws Exception {
        JSONObject job = partialJob(); String original = job.toString();
        JSONObject plan = NativeDownloadRetryPolicy.prepare(job, input(mapping(FAILED, "https://youtu.be/Zyxwvutsr01")));
        assertEquals(original, job.toString());
        JSONObject source = plan.getJSONArray("sources").getJSONObject(11), old = job.getJSONArray("sources").getJSONObject(11);
        assertEquals(REPLACEMENT, source.getString("url"));
        assertTrue(source.getBoolean("preserveMetadata"));
        for (String key : new String[]{"title", "artist", "album", "duration", "coverUrl", "metadataProvider"}) assertEquals(old.get(key), source.get(key));
        job.put("sources", plan.getJSONArray("sources")).put("failures", plan.getJSONArray("failures"));
        assertEquals(11, job.getJSONArray("files").length()); assertEquals(11, job.getInt("completed")); assertEquals(12, job.getInt("total"));
        assertEquals("original-account", job.getJSONObject("cloud").getString("accountId"));
        assertEquals(REPLACEMENT, job.getJSONArray("failures").getJSONObject(0).getString("url"));
        assertFalse(job.getJSONArray("failures").getJSONObject(0).getString("error").contains("age"));
        JSONArray pending = NativeDownloadStore.pendingSources(job);
        assertEquals(1, pending.length()); assertEquals(REPLACEMENT, pending.getJSONObject(0).getString("url"));
    }
    @Test public void replacementMetadataDoesNotRenameYoutubeSongUsingAnotherVideosTags() throws Exception {
        JSONObject job = partialJob(); job.getJSONArray("sources").getJSONObject(11).put("metadataProvider", "youtube");
        JSONObject source = NativeDownloadRetryPolicy.prepare(job, input(mapping(FAILED, REPLACEMENT))).getJSONArray("sources").getJSONObject(11);
        JSONObject candidate = new JSONObject().put("track", "Another song").put("title", "Another video title").put("artist", "Another artist")
            .put("album", "Another album").put("duration", 999).put("thumbnail", "https://i.ytimg.com/vi/Zyxwvutsr01/hqdefault.jpg");
        JSONObject metadata = NativeDownloadPolicy.downloadMetadata(source, candidate, source.getString("url"));
        assertEquals("FUK ARI !", metadata.getString("title")); assertEquals("FrostBorne", metadata.getString("artist"));
        assertEquals("Original album", metadata.getString("album")); assertEquals(999, metadata.getDouble("duration"), 0);
        assertEquals("https://i.scdn.co/image/original", metadata.getString("coverUrl"));
        assertEquals("youtube", metadata.getString("metadataProvider")); assertEquals(REPLACEMENT, metadata.getString("sourceUrl"));
        assertFalse(NativeDownloadPolicy.track(new JSONObject().put("title", "Client title").put("preserveMetadata", true), REPLACEMENT).has("preserveMetadata"));
    }
    @Test public void replacementUsesActualDurationAndFallsBackOnlyWhenSourceDurationIsUnavailable() throws Exception {
        JSONObject job = partialJob(); job.getJSONArray("sources").getJSONObject(11).put("duration", 151).put("metadataProvider", "youtube");
        JSONObject source = NativeDownloadRetryPolicy.prepare(job, input(mapping(FAILED, REPLACEMENT))).getJSONArray("sources").getJSONObject(11);
        for (int duration : new int[]{150, 999}) {
            JSONObject metadata = NativeDownloadPolicy.downloadMetadata(source, new JSONObject().put("duration", duration).put("track", "Other title").put("artist", "Other artist"), REPLACEMENT);
            assertEquals(duration, metadata.getDouble("duration"), 0); assertEquals("FUK ARI !", metadata.getString("title")); assertEquals("FrostBorne", metadata.getString("artist"));
            assertEquals("Original album", metadata.getString("album")); assertEquals("https://i.scdn.co/image/original", metadata.getString("coverUrl")); assertEquals(REPLACEMENT, metadata.getString("sourceUrl"));
        }
        assertEquals(151, NativeDownloadPolicy.downloadMetadata(source, new JSONObject(), REPLACEMENT).getDouble("duration"), 0);
        for (int duration : new int[]{0, -1}) assertEquals(151, NativeDownloadPolicy.downloadMetadata(source, new JSONObject().put("duration", duration), REPLACEMENT).getDouble("duration"), 0);
        source.put("duration", 0); assertEquals(0, NativeDownloadPolicy.downloadMetadata(source, new JSONObject(), REPLACEMENT).getDouble("duration"), 0);
    }
    @Test public void ageRestrictedSourceCannotBeRetriedWithoutAnotherSource() throws Exception {
        rejectsWithoutMutation(partialJob(), new JSONObject(), "年龄验证");
        rejectsWithoutMutation(partialJob(), input(), "年龄验证");
    }
    @Test public void restrictionsRequireReplacementButNetworkAnd403RemainRetryable() throws Exception {
        for (String error : new String[]{"Sign in to confirm you’re not a bot", "Private video", "This video is members-only",
            "The uploader has not made this video available in your country", "Authentication required", "Please sign in to view this video", "Video is age-restricted"}) {
            JSONObject job = partialJob(); job.getJSONArray("failures").getJSONObject(0).put("error", error);
            assertFalse(error, NativeDownloadRetryPolicy.restrictionReason(error).isEmpty()); rejectsWithoutMutation(job, new JSONObject(), "已下载 MP3 保留");
        }
        for (String error : new String[]{"HTTP Error 403: Forbidden", "network timeout", "Connection reset by peer", "HTTP Error 429: Too Many Requests"}) {
            JSONObject job = partialJob(); job.getJSONArray("failures").getJSONObject(0).put("error", error);
            assertEquals("", NativeDownloadRetryPolicy.restrictionReason(error));
            assertEquals(FAILED, NativeDownloadRetryPolicy.prepare(job, new JSONObject()).getJSONArray("sources").getJSONObject(11).getString("url"));
        }
    }
    @Test public void unknownCompletedOrNonFailedOriginalsAreRefused() throws Exception {
        JSONObject job = partialJob(); String complete = job.getJSONArray("sources").getJSONObject(0).getString("url");
        rejectsWithoutMutation(job, input(mapping(complete, REPLACEMENT)), "尚未完成");
        rejectsWithoutMutation(job, input(mapping("https://www.youtube.com/watch?v=Unknown0001", REPLACEMENT)), "尚未完成");
        job.getJSONArray("failures").remove(0); rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT)), "尚未完成");
    }
    @Test public void replacementCannotReuseAnExistingCompletedSourceOrOriginalVideo() throws Exception {
        JSONObject job = partialJob(); String complete = job.getJSONArray("sources").getJSONObject(0).getString("url");
        rejectsWithoutMutation(job, input(mapping(FAILED, complete)), "不同的新音源");
        rejectsWithoutMutation(job, input(mapping(FAILED, "https://youtu.be/yTLuE57Gvsc")), "不同的新音源");
    }
    @Test public void duplicateMappingsAndDuplicateTargetsAreRefusedAtomically() throws Exception {
        JSONObject job = partialJob(); rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT), mapping(FAILED, "https://youtu.be/Zyxwvutsr02")), "一个新音源");
        String other = "https://www.youtube.com/watch?v=Missing0001";
        JSONObject missing = new JSONObject().put("url", other).put("title", "Other missing");
        job.getJSONArray("sources").put(missing); job.getJSONArray("failures").put(new JSONObject(missing.toString()).put("error", "network timeout"));
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT), mapping(other, "https://youtu.be/Zyxwvutsr01")), "不同的新音源");
    }
    @Test public void allItemsValidateBeforeAnySourceChanges() throws Exception {
        JSONObject job = partialJob();
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT), mapping("https://www.youtube.com/watch?v=Missing0001", "https://evil.example/watch?v=Zyxwvutsr02")), "官方 YouTube");
        for (String value : new String[]{"http://www.youtube.com/watch?v=Zyxwvutsr01", "https://youtube.com.evil.example/watch?v=Zyxwvutsr01",
            "https://user@www.youtube.com/watch?v=Zyxwvutsr01", "https://www.youtube.com:443/watch?v=Zyxwvutsr01", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/playlist?v=Zyxwvutsr01"})
            rejectsWithoutMutation(job, input(mapping(FAILED, value)), "官方 YouTube");
    }
    @Test public void retryCannotChangeCloudOrSongMetadata() throws Exception {
        JSONObject job = partialJob();
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT)).put("cloud", new JSONObject().put("email", "other@example.com")), "上传账号");
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT).put("title", "Changed title")), "歌曲信息");
        rejectsWithoutMutation(job, new JSONObject().put("entries", new JSONArray()), "歌曲信息");
    }
    @Test public void malformedOversizedAndRunningReplacementsAreRefused() throws Exception {
        JSONObject job = partialJob();
        rejectsWithoutMutation(job, new JSONObject().put("replacements", "not-an-array"), "列表");
        rejectsWithoutMutation(job, new JSONObject().put("replacements", JSONObject.NULL), "列表");
        rejectsWithoutMutation(job, new JSONObject().put("replacements", new JSONArray().put("not-an-object")), "项目");
        rejectsWithoutMutation(job, input(new JSONObject().put("fromUrl", FAILED).put("url", 3)), "官方 YouTube");
        JSONArray excess = new JSONArray(); for (int i = 0; i < 101; i++) excess.put(mapping(FAILED, REPLACEMENT));
        rejectsWithoutMutation(job, new JSONObject().put("replacements", excess), "100");
        job.put("state", "running"); rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT)), "正在运行");
        assertNotNull(NativeDownloadRetryPolicy.prepare(job, new JSONObject()));
        rejectsWithoutMutation(job, new JSONObject().put("cloud", new JSONObject()), "上传账号");
    }
    @Test public void allRestrictedPendingFailuresNeedAChosenReplacement() throws Exception {
        JSONObject job = partialJob(); JSONObject other = new JSONObject().put("url", "https://www.youtube.com/watch?v=Missing0001").put("title", "Other missing");
        job.getJSONArray("sources").put(other); job.getJSONArray("failures").put(new JSONObject(other.toString()).put("error", "Private video"));
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT)), "私密");
    }
    @Test public void ambiguousOriginalSourceCannotRenameMultipleSongs() throws Exception {
        JSONObject job = partialJob(); job.getJSONArray("sources").put(new JSONObject(job.getJSONArray("sources").getJSONObject(11).toString()).put("title", "Another row"));
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT)), "不唯一");
    }
    @Test public void completedAudioFilenameCannotBeReplacedWhenOldMetadataIsMissing() throws Exception {
        JSONObject job = partialJob();
        job.getJSONArray("files").put(new JSONObject().put("name", "Already saved-yTLuE57Gvsc.mp3"));
        rejectsWithoutMutation(job, input(mapping(FAILED, REPLACEMENT)), "尚未完成");
    }
    @Test public void finishedTasksAndInconsistentFailuresAreNotDownloadRetryTargets() throws Exception {
        JSONObject job = partialJob(); job.put("failures", new JSONArray());
        rejectsWithoutMutation(job, new JSONObject(), "尚未完成");
        job = partialJob(); job.getJSONArray("failures").getJSONObject(0).put("url", "https://www.youtube.com/watch?v=Unknown0001");
        rejectsWithoutMutation(job, new JSONObject(), "不一致");
    }
}
