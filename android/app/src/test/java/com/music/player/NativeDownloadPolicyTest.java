package com.music.player;

import org.json.JSONObject;
import org.junit.Test;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public class NativeDownloadPolicyTest {
    @Test public void singleSongNeverAcceptsOtherHostsOrCredentials() throws Exception {
        assertEquals("iP6XpLQM2Cs", NativeDownloadPolicy.videoId("https://www.youtube.com/watch?v=iP6XpLQM2Cs&list=PLdemo"));
        assertEquals("iP6XpLQM2Cs", NativeDownloadPolicy.videoId("https://youtu.be/iP6XpLQM2Cs"));
        for (String value : new String[]{"http://youtube.com/watch?v=iP6XpLQM2Cs", "https://youtube.com.evil.com/watch?v=iP6XpLQM2Cs", "https://username@youtube.com/watch?v=iP6XpLQM2Cs", "https://youtube.com:443/watch?v=iP6XpLQM2Cs", "https://youtube.com/playlist?v=iP6XpLQM2Cs"}) {
            try { NativeDownloadPolicy.videoId(value); fail(value); } catch (IOException expected) {}
        }
    }
    @Test public void mixesCannotBeUnboundedOrUseAnotherSongsRadio() throws Exception {
        JSONObject input = new JSONObject().put("videoId", "iP6XpLQM2Cs");
        assertEquals("RDAMVMiP6XpLQM2Cs", NativeDownloadPolicy.radio(input).getString("radioId"));
        for (String radio : new String[]{"RDanythingElse", "PLajX1VL9dSWQ", "https://evil.com"}) {
            try { NativeDownloadPolicy.radio(new JSONObject(input.toString()).put("radioId", radio)); fail(radio); } catch (IOException expected) {}
        }
        try { NativeDownloadPolicy.radio(new JSONObject(input.toString()).put("page", 6)); fail(); } catch (IOException expected) {}
        try { NativeDownloadPolicy.radio(new JSONObject(input.toString()).put("limit", 1.5)); fail(); } catch (IOException expected) {}
    }
    @Test public void cloudRequiresVerifiedIdentityAndDoesNotCopyTokens() throws Exception {
        JSONObject cloud = NativeDownloadPolicy.cloud(new JSONObject().put("enabled", true).put("accountId", "1234").put("email", "Ljl260435988@gmail.com").put("accessToken", "must-not-persist"));
        assertEquals("ljl260435988@gmail.com", cloud.getString("email")); assertFalse(cloud.has("accessToken"));
        try { NativeDownloadPolicy.cloud(new JSONObject().put("enabled", true).put("email", "x@example.com")); fail(); } catch (IOException expected) {}
    }
    @Test public void utf8PropertiesAndPathsRemainBounded() throws Exception {
        String text = "歌曲🎵".repeat(100);
        String bounded = NativeDownloadPolicy.truncateUtf8(text, 117);
        assertTrue(bounded.getBytes(StandardCharsets.UTF_8).length <= 117);
        assertFalse(Character.isHighSurrogate(bounded.charAt(bounded.length() - 1)));
        File root = new File(System.getProperty("java.io.tmpdir"), "native-tests");
        for (String name : new String[]{"../secret", "..", "C:\\secret", "a/b.mp3"}) {
            try { NativeDownloadPolicy.child(root, name); fail(name); } catch (IOException expected) {}
        }
        assertEquals(root.getCanonicalFile(), NativeDownloadPolicy.child(root, "歌手 - 歌曲.mp3").getParentFile());
    }
    @Test public void cancellationCannotRetargetOrRestartUntilOldWorkerExits() throws Exception {
        try { NativeDownloadPolicy.requireRestartIdle("task", "task", true, "cancelled"); fail(); } catch (IOException expected) { assertTrue(expected.getMessage().contains("正在停止")); }
        try { NativeDownloadPolicy.requireRestartIdle("task", "task", false, "partial"); fail(); } catch (IOException expected) {}
        NativeDownloadPolicy.requireRestartIdle("task", null, true, "cancelled");
        NativeDownloadPolicy.requireRestartIdle("queued", "other", true, "cancelled");
    }
    @Test public void aPersistedSessionIsProbedEvenWhenLastSavedOffsetIsZero() {
        assertTrue(NativeDownloadPolicy.mustProbeSession(true, 0));
        assertTrue(NativeDownloadPolicy.mustProbeSession(true, 8192));
        assertFalse(NativeDownloadPolicy.mustProbeSession(false, 0));
    }
}
