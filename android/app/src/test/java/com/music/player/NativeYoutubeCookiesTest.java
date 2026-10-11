package com.music.player;

import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public class NativeYoutubeCookiesTest {
    private static final long NOW = 2000000000000L;
    private static final String HEADER = "# Netscape HTTP Cookie File\n";
    private String row(String domain, String name, String value, String expiry) {
        return domain + "\tTRUE\t/\tTRUE\t" + expiry + "\t" + name + "\t" + value + "\n";
    }
    @Test public void importFiltersOtherSitesAndPreservesValidScopeAndHttpOnly() throws Exception {
        String text = "\uFEFF" + HEADER + "#HttpOnly_" + row(".youtube.com", "SID", "fixture-session", "0")
            + row(".google.com", "SID", "other-site", "0") + row("youtube.com.evil.test", "SID", "other-site", "0")
            + row(".youtube.com", "PREF", "expired", "1") + row("music.youtube.com", "PREF", "fixture-pref", "2000000020");
        String normalized = NativeYoutubeCookies.normalize(text.replace("\n", "\r\n"), NOW);
        assertTrue(normalized.contains("#HttpOnly_.youtube.com")); assertTrue(normalized.contains("music.youtube.com"));
        assertFalse(normalized.contains("other-site")); assertFalse(normalized.contains("expired")); assertFalse(normalized.contains("\r"));
        assertEquals(normalized, NativeYoutubeCookies.normalize(normalized, NOW));
    }
    @Test public void rejectExpiredUnauthenticatedAndInjectedCredentialsWithoutEchoingSecrets() throws Exception {
        for (String text : new String[]{"invalid", HEADER + row(".google.com", "SID", "fixture-secret", "0"),
            HEADER + row(".youtube.com", "PREF", "fixture-secret", "0"), HEADER + row(".youtube.com", "SID", "fixture-secret", "1"),
            HEADER + row(".youtube.com", "SID", "fixture-secret with-space", "0"), HEADER + row(".youtube.com", "SID", "fixture-secret\u0000", "0")}) {
            try { NativeYoutubeCookies.normalize(text, NOW); fail("must reject invalid credentials"); }
            catch (IOException expected) { assertFalse(expected.getMessage().contains("fixture-secret")); }
        }
    }
    @Test public void webViewCookiesBecomeYoutubeOnlySessionRows() throws Exception {
        String text = NativeYoutubeCookies.fromHeader("SID=fixture-session; PREF=fixture-pref");
        assertTrue(text.contains("www.youtube.com\tFALSE\t/\tTRUE\t0\tSID\tfixture-session"));
        try { NativeYoutubeCookies.fromHeader("PREF=fixture-pref"); fail("must require a login cookie"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("没有有效")); }
    }
    @Test public void musicAndMobileLoginHeadersRetainTheirOwnHostScope() throws Exception {
        String text = NativeYoutubeCookies.fromHeaders("PREF=www-pref", "SID=music-session; PREF=music-pref", "SID=mobile-session");
        assertTrue(text.contains("music.youtube.com\tFALSE\t/\tTRUE\t0\tSID\tmusic-session"));
        assertTrue(text.contains("m.youtube.com\tFALSE\t/\tTRUE\t0\tSID\tmobile-session"));
        assertTrue(text.contains("www.youtube.com\tFALSE\t/\tTRUE\t0\tPREF\twww-pref"));
        assertFalse(text.contains("www.youtube.com\tFALSE\t/\tTRUE\t0\tSID"));
        assertFalse(text.contains(".youtube.com\tTRUE"));
    }
    @Test public void collectingLoginHeadersRejectsMissingAuthenticationAndInjectedRows() throws Exception {
        for (String[] headers : new String[][]{{null, null, null}, {"PREF=www", "PREF=music", null},
            {null, "SID=fixture-secret\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture-secret", null},
            {"SID=fixture-secret with-space", null, null}}) {
            try { NativeYoutubeCookies.fromHeaders(headers[0], headers[1], headers[2]); fail("must reject invalid login"); }
            catch (IOException expected) { assertFalse(expected.getMessage().contains("fixture-secret")); }
        }
    }
}
