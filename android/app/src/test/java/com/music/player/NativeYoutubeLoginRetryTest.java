package com.music.player;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public class NativeYoutubeLoginRetryTest {
    private JSONObject job(String error) throws Exception {
        JSONObject source = new JSONObject().put("url", "https://www.youtube.com/watch?v=abcdefghijk").put("title", "Fixture song");
        return new JSONObject().put("state", "failed").put("sources", new JSONArray().put(source))
            .put("failures", new JSONArray().put(new JSONObject(source.toString()).put("error", error).put("youtubeAuthRevision", "previous-login")))
            .put("files", new JSONArray());
    }
    @Test public void finishingAccountPageAllowsManualRetryWhenVerificationKeepsCookieBytes() throws Exception {
        JSONObject previous = new JSONObject().put("text", "fixture-cookies").put("revision", "previous-login");
        String revision = NativeYoutubeDownloadSession.nextRevision(previous, "fixture-cookies", "webview");
        assertNotEquals("previous-login", revision);
        assertEquals(1, NativeDownloadRetryPolicy.prepare(job("Sign in to confirm you're not a bot"), new JSONObject(), revision).getJSONArray("failures").length());
    }
    @Test public void importingUnchangedCredentialsDoesNotUnlockAnAuthenticationFailure() throws Exception {
        JSONObject previous = new JSONObject().put("text", "fixture-cookies").put("revision", "previous-login");
        for (String source : new String[]{"import", "preview"}) {
            String revision = NativeYoutubeDownloadSession.nextRevision(previous, "fixture-cookies", source);
            assertEquals("previous-login", revision);
            try { NativeDownloadRetryPolicy.prepare(job("Sign in to confirm you're not a bot"), new JSONObject(), revision); fail("unchanged import must remain blocked"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("验证")); }
        }
        assertNotEquals("previous-login", NativeYoutubeDownloadSession.nextRevision(previous, "changed-fixture-cookies", "import"));
    }
    @Test public void completingLoginDoesNotUnlockPrivateOrAgeRestrictedSources() throws Exception {
        String revision = NativeYoutubeDownloadSession.nextRevision(null, "fixture-cookies", "webview");
        for (String error : new String[]{"Private video", "Sign in to confirm your age", "This video is blocked in your country"}) {
            try { NativeDownloadRetryPolicy.prepare(job(error), new JSONObject(), revision); fail("access restrictions must remain blocked"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("已下载 MP3 保留")); }
        }
    }
}
