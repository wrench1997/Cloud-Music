package com.music.player;

import android.content.Context;
import android.os.Bundle;
import android.media.MediaMetadataRetriever;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Optional, explicitly invoked final-release smoke. No test entry point is shipped in the app APK. */
@RunWith(AndroidJUnit4.class)
public class NativeDownloadsSmokeTest {
    @Test public void nativeRuntimeInitializesWithoutExternalApps() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        assumeTrue("true".equals(args.getString("nativeSmoke", "false")));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject status = NativeDownloadsManager.get(context).request("/status", "GET", new JSONObject());
        assertTrue(status.getBoolean("ready")); assertTrue(status.getBoolean("native"));
        assertFalse(status.toString().contains("accessToken")); assertFalse(status.toString().contains("sessionUrl"));
    }
    @Test public void oneSelectedSongDownloadsTagsAndOptionallyUploadsThroughNativeService() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        assumeTrue("true".equals(args.getString("downloadSmoke", "false")));
        String url = args.getString("sourceUrl", ""), title = args.getString("title", ""), artist = args.getString("artist", "");
        assertFalse("Explicit sourceUrl/title/artist are required", url.isEmpty() || title.isEmpty() || artist.isEmpty());
        NativeDownloadPolicy.videoId(url);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeDownloadsManager manager = NativeDownloadsManager.get(context);
        JSONObject cloud = new JSONObject().put("enabled", "true".equals(args.getString("uploadSmoke", "false")))
            .put("email", args.getString("email", "")).put("accountId", args.getString("accountId", ""));
        if (cloud.getBoolean("enabled") && cloud.getString("accountId").isEmpty()) {
            assertFalse("Explicit upload email is required", cloud.getString("email").isEmpty());
            JSONObject identity = new NativeDriveUpload(context).identityForEmail(cloud.getString("email"));
            assertEquals(cloud.getString("email").toLowerCase(java.util.Locale.ROOT), identity.getString("emailAddress").toLowerCase(java.util.Locale.ROOT));
            cloud.put("accountId", identity.getString("permissionId"));
        }
        NativeDownloadPolicy.cloud(cloud);
        // The caller opens the final installed app before instrumentation, satisfying Android's FGS launch rules.
        JSONObject created = manager.request("/jobs", "POST", new JSONObject().put("entries", new JSONArray().put(new JSONObject().put("url", url)
            .put("title", title).put("artist", artist).put("metadataProvider", "spotify"))).put("cloud", cloud));
        String id = created.getString("id"); JSONObject job = created;
        long deadline = System.currentTimeMillis() + 12 * 60 * 1000;
        while ("running".equals(job.optString("state")) && System.currentTimeMillis() < deadline) {
            Thread.sleep(1000); job = manager.request("/jobs/" + id, "GET", new JSONObject());
        }
        assertEquals("Native task failed: " + job.optString("error"), "complete", job.optString("state"));
        assertEquals(1, job.getJSONArray("files").length()); JSONObject file = job.getJSONArray("files").getJSONObject(0);
        assertTrue(file.getLong("size") > 128); assertEquals(title, file.getJSONObject("metadata").getString("title")); assertEquals(artist, file.getJSONObject("metadata").getString("artist"));
        String uri = manager.getFile(id, file.getString("name")).getString("uri");
        assertTrue(uri.startsWith("file://")); assertTrue(new File(new java.net.URI(uri)).isFile());
        try (MediaMetadataRetriever tags = new MediaMetadataRetriever()) {
            tags.setDataSource(context, android.net.Uri.parse(uri));
            assertEquals(title, tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            assertEquals(artist, tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            assertTrue(Long.parseLong(tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)) > 0);
            assertNotNull("MP3 must contain real embedded artwork", tags.getEmbeddedPicture());
        }
        boolean found = false; JSONArray songs = manager.library();
        for (int i = 0; i < songs.length(); i++) if (("native:" + id + ":" + file.getString("name")).equals(songs.getJSONObject(i).optString("id"))) found = true;
        assertTrue("Downloaded song must appear in persistent local library", found);
        JSONObject saved = manager.saveFile(id, file.getString("name"));
        assertEquals("Saving an existing MP3 must reuse its exported file", saved.getString("uri"), manager.saveFile(id, file.getString("name")).getString("uri"));
        try (MediaMetadataRetriever exported = new MediaMetadataRetriever()) {
            exported.setDataSource(context, android.net.Uri.parse(saved.getString("uri")));
            assertEquals(title, exported.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            assertEquals(artist, exported.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            assertNotNull("Exported MP3 must preserve its embedded artwork", exported.getEmbeddedPicture());
        }
        exerciseRealLocalPlayback(context, file, uri);
        if (cloud.getBoolean("enabled")) {
            assertEquals("Native upload failed: " + job.getJSONObject("cloud").optString("error"), "complete", job.getJSONObject("cloud").getString("state"));
            assertTrue(file.getJSONObject("cloud").getString("id").matches("[A-Za-z0-9_-]+"));
            assertEquals(cloud.getString("accountId"), file.getJSONObject("cloud").getString("accountId"));
        }
        Bundle result = new Bundle(); result.putString("nativeJobId", id); result.putString("nativeFileName", file.getString("name"));
        if (file.getJSONObject("cloud").has("id")) result.putString("driveFileId", file.getJSONObject("cloud").getString("id"));
        InstrumentationRegistry.getInstrumentation().sendStatus(0, result);
    }
    private void command(Context context, String action, String key, Object value) {
        android.content.Intent intent = new android.content.Intent(context, MusicService.class).setAction(action);
        if (value instanceof String) intent.putExtra(key, (String) value);
        else if (value instanceof Boolean) intent.putExtra(key, (Boolean) value);
        else if (value instanceof Integer) intent.putExtra(key, (Integer) value);
        else if (value instanceof Long) intent.putExtra(key, (Long) value);
        else if (value instanceof Float) intent.putExtra(key, (Float) value);
        context.startService(intent);
    }
    private Bundle playbackState() {
        java.util.concurrent.atomic.AtomicReference<Bundle> value = new java.util.concurrent.atomic.AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            MusicService service = MusicService.getInstance(); value.set(service == null ? new Bundle() : service.getPlaybackStateBundle());
        });
        return value.get();
    }
    private Bundle waitPlayback(java.util.function.Predicate<Bundle> test) throws Exception {
        long deadline = System.currentTimeMillis() + 30000; Bundle value;
        do {
            value = playbackState(); if (test.test(value)) return value;
            assertNull("Native playback error", value.getString("error")); Thread.sleep(100);
        } while (System.currentTimeMillis() < deadline);
        fail("Local Media3 playback did not reach the expected state: " + value); return value;
    }
    private void exerciseRealLocalPlayback(Context context, JSONObject file, String uri) throws Exception {
        Bundle previous = MusicService.getSavedPlaybackMode(context);
        java.util.concurrent.atomic.AtomicReference<Float> volume = new java.util.concurrent.atomic.AtomicReference<>(1f);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            MusicService service = MusicService.getInstance(); if (service != null) volume.set(service.onGetSession(null).getPlayer().getVolume());
        });
        try {
            command(context, MusicService.ACTION_VOLUME, "volume", 0f);
            waitPlayback(value -> MusicService.getInstance() != null);
            JSONObject metadata = file.getJSONObject("metadata");
            String trackId = file.getString("id");
            JSONObject track = new JSONObject().put("id", trackId).put("title", metadata.getString("title"))
                .put("artist", metadata.getString("artist")).put("url", uri).put("duration", metadata.getDouble("duration"));
            // Temporary queue copies point to this test's local file, never to user cloud files.
            JSONArray queue = new JSONArray().put(new JSONObject(track.toString()).put("id", "smoke-before"))
                .put(track).put(new JSONObject(track.toString()).put("id", "smoke-after"));
            context.startService(new android.content.Intent(context, MusicService.class).setAction(MusicService.ACTION_QUEUE)
                .putExtra("tracks", queue.toString()).putExtra("index", 1));
            command(context, MusicService.ACTION_PAUSE, "", null);
            Bundle ready = waitPlayback(value -> value.getInt("index", -1) == 1 && trackId.equals(value.getString("trackId"))
                && value.getLong("duration") > 0 && value.getBoolean("seekable") && !value.getBoolean("buffering"));
            long target = ready.getLong("duration") / 2;
            command(context, MusicService.ACTION_SEEK, "position", target);
            waitPlayback(value -> Math.abs(value.getLong("position") - target) < 2000);
            command(context, MusicService.ACTION_SHUFFLE, "enabled", true);
            waitPlayback(value -> value.getBoolean("shuffleEnabled") && value.getInt("repeatMode") == androidx.media3.common.Player.REPEAT_MODE_ALL);
            command(context, MusicService.ACTION_REPEAT, "mode", androidx.media3.common.Player.REPEAT_MODE_ONE);
            waitPlayback(value -> value.getInt("repeatMode") == androidx.media3.common.Player.REPEAT_MODE_ONE && !value.getBoolean("shuffleEnabled"));
            assertFalse(removeQueueSong("smoke-before"));
            Bundle paused = waitPlayback(value -> value.getInt("index", -1) == 0 && trackId.equals(value.getString("trackId")));
            assertFalse("Deleting another queue item must keep paused playback paused", paused.getBoolean("playWhenReady"));
            assertTrue("Deleting an earlier queue item must retain the current position", Math.abs(paused.getLong("position") - target) < 2000);
            command(context, MusicService.ACTION_PLAY, "", null);
            waitPlayback(value -> value.getBoolean("playing"));
            long playingPosition = playbackState().getLong("position");
            assertFalse(removeQueueSong("smoke-after"));
            Bundle playing = waitPlayback(value -> value.getBoolean("playing") && trackId.equals(value.getString("trackId")));
            assertTrue("Deleting another queue item must keep the current song playing at its position", Math.abs(playing.getLong("position") - playingPosition) < 2000);
            assertTrue(removeQueueSong(trackId));
            waitPlayback(value -> !value.getBoolean("playWhenReady") && !value.getBoolean("playing") && value.getInt("index", -1) == -1);
        } finally {
            command(context, MusicService.ACTION_PAUSE, "", null);
            command(context, MusicService.ACTION_REPEAT, "mode", previous.getInt("repeatMode"));
            command(context, MusicService.ACTION_SHUFFLE, "enabled", previous.getBoolean("shuffleEnabled"));
            command(context, MusicService.ACTION_VOLUME, "volume", volume.get());
        }
    }

    private boolean removeQueueSong(String id) {
        java.util.concurrent.atomic.AtomicBoolean removedCurrent = new java.util.concurrent.atomic.AtomicBoolean();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            MusicService service = MusicService.getInstance();
            assertNotNull(service);
            removedCurrent.set(service.removeFromQueue(id));
        });
        return removedCurrent.get();
    }
}
