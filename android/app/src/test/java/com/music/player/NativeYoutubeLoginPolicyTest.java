package com.music.player;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeYoutubeLoginPolicyTest {
    @Test public void allowOfficialHttpsYoutubeAndGoogleAccountNavigation() {
        for (String url : new String[]{"https://www.youtube.com/", "https://music.youtube.com/", "https://m.youtube.com/watch?v=abcdefghijk",
            "https://accounts.youtube.com/accounts/SetSID", "https://accounts.google.com/ServiceLogin", "https://myaccount.google.com/", "https://www.google.com/"}) {
            assertTrue(url, NativeYoutubeLoginPolicy.canLoad(url));
            assertFalse(NativeYoutubeLoginPolicy.host(url).isEmpty());
        }
    }
    @Test public void rejectImpersonatedOriginsNativeSchemesAndCredentialBearingUrls() {
        for (String url : new String[]{null, "", "not-a-url", "http://www.youtube.com/", "https://youtube.com.evil.test/",
            "https://evilyoutube.com/", "https://accounts.google.com.evil.test/", "https://evil.test/", "https://www.youtube.com:444/",
            "https://user:secret@www.youtube.com/", "file:///private/account.bin", "content://private/account", "javascript:alert(1)",
            "intent://youtube.com/#Intent;scheme=https;end", "https://www.youtube.com\\@evil.test/"}) {
            assertFalse(String.valueOf(url), NativeYoutubeLoginPolicy.canLoad(url));
            assertEquals("", NativeYoutubeLoginPolicy.host(url));
        }
    }
}
