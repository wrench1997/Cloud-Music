package com.music.player;

import static org.junit.Assert.*;
import java.io.IOException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import org.junit.Test;

public class GoogleAuthFailureTest {
    private static final class ServiceFailure extends Exception {
        final int status;
        ServiceFailure(int status) { this.status = status; }
    }

    private static GoogleAuthFailure classify(Throwable error) {
        return GoogleAuthFailure.from(error, cause -> cause instanceof ServiceFailure ? ((ServiceFailure) cause).status : null);
    }

    @Test public void networkTimeoutAndUnknownServiceFailuresKeepLoginRecoverable() {
        for (Throwable error : new Throwable[] {new IOException("offline"), new TimeoutException(), new InterruptedException(), new ServiceFailure(7), new ServiceFailure(8), new ServiceFailure(15), new ServiceFailure(17)}) {
            GoogleAuthFailure result = classify(new ExecutionException(error));
            assertEquals("GOOGLE_AUTH_TEMPORARY", result.code);
            assertTrue(result.getMessage().contains("已保留登录信息"));
        }
    }

    @Test public void explicitConsentCancellationAndConfigurationHaveDifferentActions() {
        assertEquals("GOOGLE_AUTH_REQUIRED", classify(new ServiceFailure(4)).code);
        assertEquals("GOOGLE_LOGIN_CANCELLED", classify(new ServiceFailure(16)).code);
        assertEquals("GOOGLE_CONFIG_REQUIRED", classify(new ServiceFailure(10)).code);
        GoogleAuthFailure consent = GoogleAuthFailure.required();
        assertSame(consent, classify(new ExecutionException(consent)));
    }
}
