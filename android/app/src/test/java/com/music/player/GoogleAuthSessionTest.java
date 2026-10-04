package com.music.player;

import static org.junit.Assert.*;
import java.io.IOException;
import org.junit.Test;

public class GoogleAuthSessionTest {
    private static void cache(GoogleAuthSession session, String account, String token) throws Exception {
        GoogleAuthSession.Snapshot saved = session.snapshot();
        session.cache(account, token, 1000, saved.generation, saved.tokenRevision, false);
    }

    @Test public void cancelledAccountSwitchRestoresVerifiedAccountAndRejectsLateAuthorization() throws Exception {
        GoogleAuthSession session = new GoogleAuthSession();
        session.initialize("previous@example.com");
        cache(session, "previous@example.com", "previous-token");
        int attempt = session.beginInteractive();
        GoogleAuthSession.Snapshot started = session.snapshot();
        assertNull(started.account);
        assertNull(started.validToken(0));
        session.cancelInteractive(attempt);
        assertEquals("previous@example.com", session.snapshot().account);
        assertNull(session.snapshot().validToken(0));
        try { session.cache("new@example.com", "late-token", 1000, attempt, started.tokenRevision, false); fail("Cancelled authorization cannot restore a new token"); }
        catch (GoogleAuthFailure expected) { assertEquals("GOOGLE_LOGIN_CANCELLED", expected.code); }
    }

    @Test public void onlyDriveVerifiedAccountReplacesRememberedSelection() throws Exception {
        GoogleAuthSession session = new GoogleAuthSession();
        session.initialize("old@example.com");
        int attempt = session.beginInteractive();
        cache(session, "new@example.com", "new-token");
        try { session.rememberVerifiedAccount("another@example.com"); fail("Wrong identity cannot become remembered"); }
        catch (GoogleAuthFailure expected) { assertEquals("GOOGLE_LOGIN_CANCELLED", expected.code); }
        session.cancelInteractive(attempt);
        assertEquals("old@example.com", session.snapshot().account);
        attempt = session.beginInteractive();
        cache(session, "new@example.com", "new-token");
        session.rememberVerifiedAccount("NEW@example.com");
        session.cancelInteractive(attempt);
        assertEquals("NEW@example.com", session.snapshot().account);
    }

    @Test public void forcedRefreshCannotReuseRejectedTokenOrAcceptLatePlaybackResult() throws Exception {
        GoogleAuthSession session = new GoogleAuthSession();
        session.initialize("saved@example.com");
        cache(session, "saved@example.com", "rejected-token");
        GoogleAuthSession.Snapshot old = session.snapshot();
        GoogleAuthSession.Snapshot refresh = session.beginTokenRefresh(old.token, old.generation);
        assertNull(session.snapshot().validToken(0));
        assertTrue(session.snapshot().refreshPending);
        assertEquals("rejected-token", session.snapshot().tokenToClear);
        try { session.cache(old.account, "late-playback-token", 1000, old.generation, old.tokenRevision, false); fail("Old authorization cannot win the refresh race"); }
        catch (GoogleAuthFailure expected) { assertEquals("GOOGLE_AUTH_TEMPORARY", expected.code); }
        session.endTokenRefresh(refresh.generation, refresh.tokenRevision);
        // If clearToken failed, retry must still know which managed token needs clearing.
        GoogleAuthSession.Snapshot retry = session.beginTokenRefresh(session.snapshot().tokenToClear, old.generation);
        session.cache(old.account, "fresh-token", 1000, retry.generation, retry.tokenRevision, true);
        session.endTokenRefresh(retry.generation, retry.tokenRevision);
        assertEquals("fresh-token", session.snapshot().validToken(0));
        assertFalse(session.snapshot().refreshPending);
        session.invalidateToken("rejected-token", old.generation);
        assertEquals("fresh-token", session.snapshot().validToken(0));
        try { session.beginTokenRefresh("rejected-token", old.generation); fail("An old failed request cannot invalidate a newer token"); }
        catch (GoogleAuthFailure expected) { assertEquals("GOOGLE_AUTH_TEMPORARY", expected.code); }
        assertEquals("fresh-token", session.snapshot().validToken(0));
        try { cache(session, "other@example.com", "other-token"); fail("A silent request cannot replace the active account"); }
        catch (GoogleAuthFailure expected) { assertEquals("GOOGLE_LOGIN_CANCELLED", expected.code); }
    }

    @Test public void explicitLogoutCannotBeUndoneByAPluginReloadOrLateRefresh() throws Exception {
        GoogleAuthSession session = new GoogleAuthSession();
        session.initialize("saved@example.com");
        cache(session, "saved@example.com", "token");
        GoogleAuthSession.Snapshot before = session.snapshot();
        session.clear();
        session.initialize("saved@example.com");
        assertNull(session.snapshot().account);
        assertNull(session.snapshot().validToken(0));
        try { session.cache(before.account, "late", 1000, before.generation, before.tokenRevision, false); fail("Logout must win against pending work"); }
        catch (IOException expected) { assertEquals("GOOGLE_LOGIN_CANCELLED", ((GoogleAuthFailure) expected).code); }
    }
}
